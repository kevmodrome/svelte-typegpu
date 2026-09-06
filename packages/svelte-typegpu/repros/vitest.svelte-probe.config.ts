import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import base from '../vitest.config';

const directory = process.env.SVELTE_PROBE_DIR;
if (!directory) throw new Error('Set SVELTE_PROBE_DIR to an isolated copy of the pinned Svelte package.');
const { exports } = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
const alias = Object.entries(exports).flatMap(([name, entry]) => {
  const path = typeof entry === 'string' ? entry :
    (entry as { browser?: string; default?: string }).browser ??
    (entry as { default?: string }).default;
  if (!path) return [];
  const specifier = name === '.' ? 'svelte' : `svelte${name.slice(1)}`;
  return [{ find: new RegExp(`^${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`), replacement: resolve(directory, path) }];
});

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    alias,
    include: [
      'repros/async-boundary-unmount.test.ts',
      'repros/probes/*.test.ts',
      'src/async-expressions.test.ts'
    ]
  }
});
