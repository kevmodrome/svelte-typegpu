import type { Component } from 'svelte';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { compileTypeGpu } from '../compiler/index';
import renderer from './svelte-renderer';
import ViewportCanvas from './ViewportCanvas.svelte';

export function compileViewportSource<Exports extends Record<string, unknown> = Record<string, never>>(
  source: string, dependencies: Record<string, unknown> = {}
): Component<any, Exports> {
  const compiled = compileTypeGpu(source, {
    filename: 'Viewport.typegpu.svelte', generate: 'client', runes: true
  });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  return new Function('$', '$renderer', 'TypeGpuViewportCanvas', ...Object.keys(dependencies), `${code}\nreturn ${name};`)(
    client, renderer, ViewportCanvas, ...Object.values(dependencies)
  );
}
