import { fileURLToPath } from 'node:url';
import { build, createLogger, createServer } from 'vite';
import { expect, it, vi } from 'vitest';
import { typegpuSvelte } from 'svelte-typegpu/vite';
import type { Options } from '@sveltejs/vite-plugin-svelte';
import type { Warning } from 'svelte/compiler';

it.each([false, true])('builds the viewport through Vite (SSR: %s)', async (ssr) => {
  const entry = fileURLToPath(new URL('./test-fixtures/Viewport.typegpu.svelte', import.meta.url));
  const logger = createLogger('silent');
  const warn = vi.spyOn(logger, 'warn');
  const result = await build({
    configFile: false, customLogger: logger, plugins: [typegpuSvelte({ configFile: false })],
    ssr: { noExternal: ['svelte-typegpu'] },
    build: {
      write: false, minify: false, ssr: ssr ? entry : false,
      lib: { entry, formats: ['es'], fileName: 'viewport' }
    }
  });
  expect(warn.mock.calls.flat().join('\n')).not.toContain('Sourcemap');
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => 'output' in item ? item.output : []);
  const code = outputs.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n');
  expect(code).toContain('canvas');
  expect(code).toContain('Build test');
  if (!ssr) {
    const css = outputs.filter((item) => item.type === 'asset').map((item) => String(item.source)).join('\n');
    expect(css).toContain('420px');
    expect(css).toContain('typegpu-');
  }
}, 30_000);

it.each([false, true])('reports original-source diagnostics once through Vite (SSR: %s)', async (ssr) => {
  const { warnings, entry } = await buildInvalidScene(ssr);
  expect(warnings.filter((warning) => warning.includes('Unknown TypeGPU primitive'))).toHaveLength(1);
  expect(warnings.filter((warning) => warning.includes('must be a direct child'))).toHaveLength(1);
  const output = warnings.join('\n');
  expect(output).toContain('InvalidScene.typegpu.svelte');
  expect(output).toContain('3:     <boxGeomtry />');
  expect(output).toContain('Did you mean <boxGeometry>?');
  expect(output).not.toContain('Sourcemap');
  expect(entry).toContain('InvalidScene.typegpu.svelte');
}, 30_000);

it.each([false, true])('lets onwarn handle or forward renderer warnings (SSR: %s)', async (ssr) => {
  const received: Warning[] = [];
  const { warnings, entry } = await buildInvalidScene(ssr, {
    onwarn(warning, defaultHandler) {
      received.push(warning);
      if (warning.code === 'typegpu_invalid_parent') defaultHandler(warning);
    }
  });
  expect(received.map((warning) => warning.code)).toEqual(['typegpu_unknown_primitive', 'typegpu_invalid_parent']);
  expect(received[0]).toMatchObject({ filename: entry, start: { line: 3, column: 5 } });
  expect(received[0].frame).toContain('3:     <boxGeomtry />');
  expect(warnings.filter((warning) => warning.includes('Unknown TypeGPU primitive'))).toHaveLength(0);
  expect(warnings.filter((warning) => warning.includes('must be a direct child'))).toHaveLength(1);
}, 30_000);

it.each([false, true])('honors static and async dynamic warning filters (SSR: %s)', async (ssr) => {
  const staticFilter = vi.fn(() => false);
  const dynamicFilter = vi.fn((warning: Warning) => warning.code !== 'typegpu_unknown_primitive');
  const onwarn = vi.fn();
  await buildInvalidScene(ssr, { compilerOptions: { warningFilter: staticFilter }, onwarn });
  expect(staticFilter.mock.calls).toHaveLength(2);
  expect(onwarn).not.toHaveBeenCalled();
  await buildInvalidScene(ssr, {
    compilerOptions: { warningFilter: staticFilter },
    async dynamicCompileOptions({ filename }) {
      return filename.endsWith('InvalidScene.typegpu.svelte') ? { warningFilter: dynamicFilter } : {};
    },
    onwarn
  });
  expect(staticFilter.mock.calls).toHaveLength(2);
  expect(dynamicFilter.mock.calls).toHaveLength(2);
  expect(onwarn).toHaveBeenCalledTimes(1);
  expect(onwarn.mock.calls[0][0].code).toBe('typegpu_invalid_parent');
}, 30_000);

async function buildInvalidScene(ssr: boolean, options: Options = {}) {
  const entry = fileURLToPath(new URL('./test-fixtures/InvalidScene.typegpu.svelte', import.meta.url));
  const logger = createLogger('silent');
  const warn = vi.spyOn(logger, 'warn');
  await build({
    configFile: false, customLogger: logger,
    plugins: [typegpuSvelte({ configFile: false, ...options })],
    ssr: { noExternal: ['svelte-typegpu'] },
    build: {
      write: false, minify: false, ssr: ssr ? entry : false,
      lib: { entry, formats: ['es'], fileName: 'invalid-scene' }
    }
  });
  return { entry, warnings: warn.mock.calls.map(([message]) => message) };
}

it('refreshes diagnostics in development without duplicates or stale warnings', async () => {
  const onwarn = vi.fn();
  let source = '<boxGeomtry /><group><boxGeometry /></group>';
  const server = await createServer({
    configFile: false, customLogger: createLogger('silent'),
    server: { middlewareMode: true, watch: null, ws: false },
    optimizeDeps: { noDiscovery: true, exclude: ['svelte'] },
    plugins: [typegpuSvelte({ configFile: false, onwarn, prebundleSvelteLibraries: false, preprocess: {
      markup({ content, filename }) {
        return { code: filename?.endsWith('InvalidScene.typegpu.svelte') ? source : content };
      }
    } })]
  });
  const url = '/src/test-fixtures/InvalidScene.typegpu.svelte';
  try {
    await server.transformRequest(url);
    expect(onwarn.mock.calls.map(([warning]) => warning.code)).toEqual(['typegpu_unknown_primitive', 'typegpu_invalid_parent']);
    await server.transformRequest(url);
    expect(onwarn).toHaveBeenCalledTimes(2);
    await server.transformRequest(url, { ssr: true });
    expect(onwarn).toHaveBeenCalledTimes(4);
    source = '<mesh><boxGeometry /></mesh>';
    const module = await server.moduleGraph.getModuleByUrl(url);
    expect(module).toBeDefined();
    server.moduleGraph.invalidateModule(module!);
    await server.transformRequest(url);
    expect(onwarn).toHaveBeenCalledTimes(4);
    source = '<scene><boxGeometry /></scene>';
    server.moduleGraph.invalidateModule(module!);
    await server.transformRequest(url);
    expect(onwarn).toHaveBeenCalledTimes(5);
    expect(onwarn.mock.calls[4][0].code).toBe('typegpu_invalid_parent');
  } finally {
    await server.close();
  }
}, 30_000);
