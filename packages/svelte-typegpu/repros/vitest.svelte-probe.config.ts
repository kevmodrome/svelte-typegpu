import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

const directory = process.env.SVELTE_PROBE_DIR;
if (!directory) throw new Error('Set SVELTE_PROBE_DIR to an isolated copy of the pinned Svelte package.');
const suite = process.env.SVELTE_PROBE_SUITE ?? 'focused';
if (!['focused', 'regression', 'boundary-snippets'].includes(suite)) throw new Error(`Unknown Svelte probe suite: ${suite}`);
const { exports } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alias = Object.entries(exports).flatMap(([name, entry]) => {
  const path = typeof entry === 'string' ? entry :
    (entry as { browser?: string; default?: string }).browser ??
    (entry as { default?: string }).default;
  if (!path) return [];
  const specifier = name === '.' ? 'svelte' : `svelte${name.slice(1)}`;
  return [{ find: new RegExp(`^${escapeRegex(specifier)}$`), replacement: resolve(directory, path) }];
});
alias.push({
  find: /^svelte-test\/server$/,
  replacement: resolve(directory, 'src/index-server.js')
});

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    alias,
    setupFiles: suite === 'regression' ? ['repros/enable-async.ts'] : [],
    include: suite === 'boundary-snippets' ? ['repros/boundary-snippets/*.test.ts'] : [
      'repros/async-boundary-unmount.test.ts',
      'repros/probes/*.test.ts',
      ...(suite === 'regression' ? base.test!.include! : ['src/async-expressions.test.ts'])
    ]
  }
});
