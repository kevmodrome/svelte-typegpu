import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

export async function patchCommonJsCompiler(directory) {
  const root = await realpath(directory);
  assert(basename(dirname(root)).startsWith('typegpu-svelte-probe-'), 'Only a runner-owned temporary copy may be patched');
  const path = resolve(root, 'compiler/index.js');
  assert.equal(await realpath(path), path, 'The temporary compiler must not be a symlink');
  const source = await readFile(path, 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'),
    'd765a1335ed4135713cf281de7e538c2f5007cd88505d9aa3b2562bf6b868da0',
    'Unrecognized Svelte compiler bundle; re-inspect before updating this candidate');
  const before = 'const s=e[0],i=be?s.declarations[0].init.arguments[1]:s.declarations[0].init;';
  assert.equal(source.split(before).length, 2, 'Expected one boundary snippet lookup');
  assert(!source.includes('__boundary_snippet_initializer'), 'Candidate identifier must be unused');
  // xe is the pinned bundle's custom_renderer flag, be its compiler dev flag.
  const after = 'const s=e[0],__boundary_snippet_initializer=xe?s.declarations[0].init.arguments[1]:s.declarations[0].init,' +
    'i=be?__boundary_snippet_initializer.arguments[1]:__boundary_snippet_initializer;';
  await writeFile(path, source.replace(before, after));
}
