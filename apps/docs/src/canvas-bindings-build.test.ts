import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('tree-shakes the private canvas bindings with the docs bundler', () => {
  const entry = fileURLToPath(new URL('../../../packages/svelte-typegpu/src/canvas-bindings.ts', import.meta.url));
  const code = execFileSync('bun', ['build', entry, '--target=browser', '--minify'], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  });
  expect(code).toContain('bind_element_size');
  expect(code).toContain('bind_resize_observer');
  expect(code).not.toContain('bind_current_time');
  // The pinned runtime plus bindings is ~44 KB. Namespace destructuring retains
  // every Svelte helper and grows this isolated entry to ~113 KB.
  expect(Buffer.byteLength(code)).toBeLessThan(64_000);
});
