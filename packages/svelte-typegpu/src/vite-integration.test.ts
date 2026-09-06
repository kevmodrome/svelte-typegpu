import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, type InlineConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import { typegpuSvelte } from '../compiler/vite';

describe('Vite renderer boundary', () => {
  it.each([false, true].flatMap(dynamic => [false, true].map(ssrFirst => ({ dynamic, ssrFirst }))))
    ('preserves async opt-in through viewport preparation (dynamic: $dynamic, SSR first: $ssrFirst)', async ({ dynamic, ssrFirst }) => {
    const root = fileURLToPath(new URL('../../../apps/example/', import.meta.url));
    const transport = createHttpServer();
    const cacheDir = await mkdtemp(join(tmpdir(), 'typegpu-vite-async-test-'));
    const server = await createServer({
      root, cacheDir, configFile: false, logLevel: 'silent',
      plugins: [typegpuSvelte({
        configFile: false,
        ...(dynamic ? { dynamicCompileOptions: () => ({ experimental: { async: true } }) } :
          { compilerOptions: { experimental: { async: true } } })
      })],
      server: { middlewareMode: true, hmr: { server: transport }, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
    try {
      const viewportPath = '/@fs/' + fileURLToPath(new URL('./test-fixtures/AsyncViewport.typegpu.svelte', import.meta.url));
      for (const ssr of [ssrFirst, !ssrFirst]) {
        const code = (await server.transformRequest(viewportPath, { ssr }))!.code;
        expect(code).toContain('ViewportCanvas.svelte');
        if (ssr) {
          expect(code).not.toContain('svelte-typegpu/svelte-renderer');
          expect(code).not.toContain('<mesh');
        } else {
          expect(code).toContain('$.push_renderer(null)');
          expect(code).toContain('$.async(');
          expect(code).toContain('$.renderer_snippet($renderer');
          expect(code).toContain('typegpu-');
        }
      }
    } finally { await server.close(); transport.close(); await rm(cacheDir, { recursive: true, force: true }); }
  }, 15_000);

  it.each([false, true].flatMap(override => [false, true].map(ssrFirst => ({ override, ssrFirst }))))
    ('keeps real development output renderer-owned with HMR disabled (override: $override, SSR first: $ssrFirst)', async ({ override, ssrFirst }) => {
    const root = fileURLToPath(new URL('../../../apps/example/', import.meta.url));
    const transport = createHttpServer();
    const cacheDir = await mkdtemp(join(tmpdir(), 'typegpu-vite-test-'));
    const config: InlineConfig = {
      root, cacheDir, configFile: false, logLevel: 'silent',
      plugins: [typegpuSvelte({
        configFile: false,
        ...(override ? { compilerOptions: { hmr: true }, dynamicCompileOptions: () => ({ hmr: true }) } : {})
      })],
      server: { middlewareMode: true, hmr: { server: transport }, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] }
    };
    const server = await createServer(config);
    try {
      const viewportPath = '/@fs/' + fileURLToPath(new URL('../../../apps/docs/src/examples/native-events/NativeEvents.typegpu.svelte', import.meta.url));
      const checkServer = async () => {
        const ssr = (await server.transformRequest(viewportPath, { ssr: true }))!.code;
        expect(ssr).not.toContain('svelte-typegpu/svelte-renderer');
        expect(ssr).not.toContain('<mesh');
      };
      if (ssrFirst) await checkServer();
      const scene = (await server.transformRequest('/src/Scene.typegpu.svelte'))!.code;
      expect(scene).toContain('$.push_renderer($renderer)');
      expect(scene).not.toContain('$.hmr(');
      const canvas = (await server.transformRequest('/@fs/' + fileURLToPath(new URL('./Canvas.svelte', import.meta.url))))!.code;
      expect(canvas).toContain('$.push_renderer(null)');
      expect(canvas).not.toContain('$.hmr(');
      const host = (await server.transformRequest('/@fs/' + fileURLToPath(new URL('./SceneHost.typegpu.svelte', import.meta.url))))!.code;
      expect(host).toContain('$.push_renderer($renderer)');
      expect(host).not.toContain('$.push_renderer(null)');
      expect(host).not.toContain('$.hmr(');
      const viewport = (await server.transformRequest(viewportPath))!.code;
      expect(viewport).toContain('$.push_renderer(null)');
      expect(viewport).toContain('$.renderer_snippet($renderer');
      expect(viewport).not.toContain('$.hmr(');
      if (!ssrFirst) await checkServer();
    } finally { await server.close(); transport.close(); await rm(cacheDir, { recursive: true, force: true }); }
  }, 15_000);
});
