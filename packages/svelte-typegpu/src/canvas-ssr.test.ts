import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { expect, it, vi } from 'vitest';

it('server-renders the canvas shell without initializing WebGPU or mounting a scene', async () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Canvas.svelte'),
    'utf8'
  );
  const compiled = compile(source, { filename: 'Canvas.svelte', generate: 'server', runes: true });
  const serverEntry = join(
    dirname(fileURLToPath(import.meta.resolve('svelte/package.json'))),
    'src/index-server.js'
  );
  const svelte = await vi.importActual<Record<string, unknown>>(serverEntry);
  const server = await vi.importActual<Record<string, unknown>>('svelte/internal/server');
  const initialize = vi.fn();
  const scene = vi.fn();
  const executable = compiled.js.code
    .replace(/^import .*;\n/gm, '')
    .replace('export default function Canvas', 'function Canvas');
  const Canvas = new Function(
    '$',
    'getAllContexts',
    'mount',
    'onMount',
    'unmount',
    'renderer',
    'createTypeGpuRoot',
    'SceneHost',
    `${executable}\nreturn Canvas;`
  )(
    server,
    svelte.getAllContexts,
    svelte.mount,
    svelte.onMount,
    svelte.unmount,
    {},
    initialize,
    scene
  );

  const output = render(Canvas, {
    props: { scene, sceneProps: {}, 'aria-label': 'Server canvas' },
    context: new Map([['theme', 'dark']])
  });
  expect(output.body).toContain('<canvas');
  expect(output.body).toContain('aria-label="Server canvas"');
  expect(initialize).not.toHaveBeenCalled();
  expect(scene).not.toHaveBeenCalled();
});
