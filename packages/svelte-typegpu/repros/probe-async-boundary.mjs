import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { patchCommonJsCompiler } from './boundary-snippets/patch-commonjs.mjs';

const mode = process.argv[2];
const suite = process.env.SVELTE_PROBE_SUITE ?? (mode === 'boundary-snippets' ? 'boundary-snippets' : 'focused');
const browser = process.argv[3] === '--browser';
const candidates = {
  baseline: [],
  candidate: ['async-boundary-destroyed.patch'],
  'nested-effects': ['async-boundary-destroyed.patch', 'async-pending-ancestor.patch'],
  'derived-errors': ['async-boundary-destroyed.patch', 'async-pending-ancestor.patch', 'async-derived-errors.patch'],
  'boundary-snippets': ['boundary-snippets.patch']
};
if (!Object.hasOwn(candidates, mode)) {
  throw new Error('Usage: node repros/probe-async-boundary.mjs baseline|candidate|nested-effects|derived-errors|boundary-snippets [vitest filters]');
}
if (browser && mode !== 'boundary-snippets') throw new Error('The browser probe currently targets boundary-snippets only.');

const directory = fileURLToPath(new URL('..', import.meta.url));
const source = dirname(await realpath(fileURLToPath(import.meta.resolve('svelte/package.json'))));
const temporary = await mkdtemp(join(tmpdir(), 'typegpu-svelte-probe-'));
const copy = join(temporary, 'svelte');
const cli = fileURLToPath(new URL('./vitest.mjs', import.meta.resolve('vitest/package.json')));

try {
  await cp(source, copy, { recursive: true, filter: (path) => path !== join(source, 'node_modules') });
  // Resolve dependencies beside the installed package, but never load its Svelte runtime.
  await symlink(dirname(source), join(copy, 'node_modules'), 'dir');
  for (const filename of candidates[mode]) {
    const patch = fileURLToPath(new URL(`./probes/${filename}`, import.meta.url));
    const result = spawnSync('git', ['apply', patch], { cwd: copy, encoding: 'utf8', timeout: 10000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Candidate no longer applies:\n${result.stderr}`);
  }
  if (mode === 'boundary-snippets') await patchCommonJsCompiler(copy);
  const command = browser ? [fileURLToPath(new URL('./boundary-snippets/browser.mjs', import.meta.url))] : [
    cli, 'run', '--config', 'repros/vitest.svelte-probe.config.ts', ...process.argv.slice(3)
  ];
  const result = spawnSync(process.execPath, command, {
    cwd: directory, env: { ...process.env, SVELTE_PROBE_DIR: copy, SVELTE_PROBE_SUITE: suite }, stdio: 'inherit',
    timeout: browser ? 180000 : suite === 'regression' ? 120000 : 30000
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  await rm(temporary, { recursive: true, force: true });
}
