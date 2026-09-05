import { compile } from 'svelte/compiler';
import type { Component } from 'svelte';
import * as svelteClient from 'svelte/internal/client';
import renderer from './svelte-renderer';
import { typeGpuRendererPath } from './test-paths';

export function compileTypeGpuSource<
  Exports extends Record<string, unknown> = Record<string, never>
>(source: string) {
  return compileSource<Exports>(source, false);
}

export async function compileAsyncTypeGpuSource<
  Exports extends Record<string, unknown> = Record<string, never>
>(source: string) {
  await import('svelte/internal/flags/async');
  return compileSource<Exports>(source, true);
}

function compileSource<Exports extends Record<string, unknown>>(source: string, async: boolean) {
  const result = compile(source, {
    filename: 'Inline.typegpu.svelte',
    generate: 'client',
    runes: true,
    experimental: { async, customRenderer: typeGpuRendererPath }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error('Unable to find compiled component name');

  const executableCode = result.js.code
    .replace(`import $renderer from '${typeGpuRendererPath}';`, '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import 'svelte/internal/flags/async';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);

  return new Function('$', '$renderer', `${executableCode}\nreturn ${componentName};`)(
    svelteClient,
    renderer
  ) as Component<any, Exports>;
}
