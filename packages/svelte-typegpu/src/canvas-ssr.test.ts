import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import * as svelte from 'svelte-test/server';
import { expect, it, vi } from 'vitest';

it('server-renders the canvas shell without initializing WebGPU or mounting a scene', async () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'Canvas.svelte'),
    'utf8'
  );
  const compiled = compile(source, { filename: 'Canvas.svelte', generate: 'server', runes: true });
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
    props: {
      scene,
      sceneProps: {},
      'aria-label': 'Server host',
      canvasProps: {
        'aria-label': 'Server canvas',
        tabindex: 0,
        class: ['preview', { selected: true }],
        width: 5,
        height: 7,
        children: 'ignored',
        onkeydown: () => {}
      }
    },
    context: new Map([['theme', 'dark']])
  });
  expect(output.body).toContain('aria-label="Server host"');
  expect(output.body).toMatch(/<canvas[^>]*aria-label="Server canvas"/);
  expect(output.body).toContain('tabindex="0"');
  expect(output.body).toContain('renderer-root-canvas preview selected');
  expect(output.body).not.toContain('width="5"');
  expect(output.body).not.toContain('height="7"');
  expect(output.body).not.toContain('ignored');
  expect(output.body).not.toContain('onkeydown');
  expect(initialize).not.toHaveBeenCalled();
  expect(scene).not.toHaveBeenCalled();
});
