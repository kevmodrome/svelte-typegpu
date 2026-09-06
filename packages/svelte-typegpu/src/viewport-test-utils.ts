import type { Component } from 'svelte';
import { parse } from 'acorn';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { compileTypeGpu } from '../compiler/index';
import renderer from './svelte-renderer';
import ViewportCanvas from './ViewportCanvas.svelte';
import * as canvasBindings from './canvas-bindings';
import * as attributeValues from './attribute-values';

export function compileViewportSource<Exports extends Record<string, unknown> = Record<string, never>>(
  source: string, dependencies: Record<string, unknown> = {}
): Component<any, Exports> {
  return compileSource<Exports>(source, dependencies, false, false);
}

export async function compileAsyncViewportSource<Exports extends Record<string, unknown> = Record<string, never>>(
  source: string, dependencies: Record<string, unknown> = {}, dev = false
): Promise<Component<any, Exports>> {
  await import('svelte/internal/flags/async');
  return compileSource<Exports>(source, dependencies, true, dev);
}

function compileSource<Exports extends Record<string, unknown>>(
  source: string, dependencies: Record<string, unknown>, async: boolean, dev: boolean
): Component<any, Exports> {
  const compiled = compileTypeGpu(source, {
    filename: 'Viewport.typegpu.svelte', generate: 'client', runes: true, dev, experimental: { async }
  });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  let code = compiled.js.code;
  const imports = { ...dependencies };
  const modules: Record<string, unknown> = {
    'svelte-typegpu/internal/viewport-canvas': ViewportCanvas,
    'svelte-typegpu/internal/canvas-bindings': canvasBindings,
    'svelte-typegpu/internal/attribute-values': attributeValues
  };
  for (const statement of parse(compiled.js.code, { ecmaVersion: 'latest', sourceType: 'module' }).body.reverse()) {
    if (statement.type !== 'ImportDeclaration') continue;
    code = code.slice(0, statement.start) + code.slice(statement.end);
    const value = modules[String(statement.source.value)];
    if (value) for (const specifier of statement.specifiers) imports[specifier.local.name] = value;
  }
  code = code.replace(`export default function ${name}`, `function ${name}`);
  return new Function('$', '$renderer', ...Object.keys(imports), `${code}\nreturn ${name};`)(
    client, renderer, ...Object.values(imports)
  );
}
