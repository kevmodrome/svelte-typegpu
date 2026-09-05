import { compile } from 'svelte/compiler';
import type { Component } from 'svelte';
import * as svelteClient from 'svelte/internal/client';
import renderer from './svelte-renderer';
import { typeGpuRendererPath } from './test-paths';

export function compileTypeGpuSource<
  Exports extends Record<string, unknown> = Record<string, never>
>(source: string) {
  const result = compile(source, {
    filename: 'Inline.typegpu.svelte',
    generate: 'client',
    runes: true,
    experimental: { customRenderer: typeGpuRendererPath }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error('Unable to find compiled component name');

  const executableCode = result.js.code
    .replace(`import $renderer from '${typeGpuRendererPath}';`, '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);

  return new Function('$', '$renderer', `${executableCode}\nreturn ${componentName};`)(
    svelteClient,
    renderer
  ) as Component<any, Exports>;
}
