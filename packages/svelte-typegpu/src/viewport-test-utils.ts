import type { Component } from 'svelte';
import { parse } from 'acorn';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { compileTypeGpu } from '../compiler/index';
import renderer from './svelte-renderer';
import ViewportCanvas from './ViewportCanvas.svelte';
import * as canvasBindings from './canvas-bindings';

export function compileViewportSource<Exports extends Record<string, unknown> = Record<string, never>>(
  source: string, dependencies: Record<string, unknown> = {}
): Component<any, Exports> {
  const compiled = compileTypeGpu(source, {
    filename: 'Viewport.typegpu.svelte', generate: 'client', runes: true
  });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  const imports = { ...dependencies };
  const modules: Record<string, unknown> = {
    'svelte-typegpu/internal/viewport-canvas': ViewportCanvas,
    'svelte-typegpu/internal/canvas-bindings': canvasBindings
  };
  for (const statement of parse(compiled.js.code, { ecmaVersion: 'latest', sourceType: 'module' }).body) {
    if (statement.type !== 'ImportDeclaration') continue;
    const value = modules[String(statement.source.value)];
    if (value) for (const specifier of statement.specifiers) imports[specifier.local.name] = value;
  }
  return new Function('$', '$renderer', ...Object.keys(imports), `${code}\nreturn ${name};`)(
    client, renderer, ...Object.values(imports)
  );
}
