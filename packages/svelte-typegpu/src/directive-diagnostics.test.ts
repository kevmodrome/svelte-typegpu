import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { createServer } from 'vite';
import { describe, expect, it, vi } from 'vitest';
import { adaptViewportClient, compileTypeGpu, prepareTypeGpuSource } from '../compiler/index';
import { typegpuSvelte } from '../compiler/vite';

const filename = 'Directives.typegpu.svelte';
const directives = [
  { syntax: 'use:setup', replacement: 'attachment' },
  { syntax: 'class:active={active}', replacement: 'material or transform props' },
  { syntax: 'style:color={color}', replacement: 'material or transform props' }
];

function captureError(run: () => unknown) {
  try { run(); } catch (error) { return error; }
  throw new Error('Expected a compiler error');
}

describe('unsupported TypeGPU directive diagnostics', () => {
  it.each(directives)('reports the original range and an alternative for $syntax', ({ syntax, replacement }) => {
    const source = `<canvas>\n  <scene>\n    <mesh ${syntax} />\n  </scene>\n</canvas>`;
    const start = source.indexOf(syntax);
    const error = captureError(() => prepareTypeGpuSource(source, filename));
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      name: 'TypeGpuCompileError', code: 'typegpu_unsupported_directive', filename,
      start: { line: 3, column: 10, character: start },
      end: { line: 3, column: 10 + syntax.length, character: start + syntax.length },
      position: [start, start + syntax.length],
      message: expect.stringContaining(replacement),
      frame: `1: <canvas>\n2:   <scene>\n3:     <mesh ${syntax} />\n             ^\n4:   </scene>\n5: </canvas>`
    });
    expect((error as Error).message).toContain('<mesh>');
  });

  it.each(directives)('rejects $syntax in every host scope without evaluating expressions', ({ syntax }) => {
    const hosts = [`<mesh ${syntax} />`, `<custom-particle ${syntax} />`,
      `<svelte:element this={tag} ${syntax} />`, `<svelte:element this={'mesh'} ${syntax} />`];
    const scopes = [
      (host: string) => `<scene>${host}</scene>`,
      (host: string) => `<canvas><scene>${host}</scene></canvas>`,
      (host: string) => `<Component>${host}</Component>`,
      (host: string) => `{#snippet item()}${host}{/snippet}<scene>{@render item()}</scene>`,
      (host: string) => `{#snippet unused()}${host}{/snippet}<canvas><scene /></canvas>`,
      (host: string) => `<canvas>{#snippet item()}${host}{/snippet}<scene>{@render item()}</scene></canvas>`,
      (host: string) => `<scene>{#if false}${host}{/if}</scene>`,
      (host: string) => `<scene>{#if true}<group />{:else}${host}{/if}</scene>`,
      (host: string) => `<scene>{#each [] as item}${host}{/each}</scene>`,
      (host: string) => `<scene>{#each [] as item}<group />{:else}${host}{/each}</scene>`,
      (host: string) => `<scene>{#await promise}${host}{/await}</scene>`,
      (host: string) => `<scene>{#await promise then item}${host}{/await}</scene>`,
      (host: string) => `<scene>{#await promise}<group />{:then item}<group />{:catch error}${host}{/await}</scene>`,
      (host: string) => `<scene>{#key value}${host}{/key}</scene>`,
      (host: string) => `<svelte:boundary>${host}</svelte:boundary>`,
      (host: string) => `<!-- svelte-ignore typegpu_unsupported_directive -->${host}`
    ];
    for (const host of hosts) for (const scope of scopes) {
      expect(captureError(() => prepareTypeGpuSource(scope(host), filename))).toMatchObject({
        code: 'typegpu_unsupported_directive', filename
      });
    }
  });

  it.each(directives)('uses native-canvas migration guidance for $syntax', ({ syntax }) => {
    const error = captureError(() => prepareTypeGpuSource(`<canvas ${syntax}><scene /></canvas>`, filename));
    expect(error).toMatchObject({ code: 'typegpu_unsupported_directive', filename });
    expect((error as Error).message).toContain('<canvas>');
    expect((error as Error).message).toContain(syntax.startsWith('use:') ? 'attachment' : 'attribute');
    expect((error as Error).message).not.toContain('material or transform props');
  });

  it('preserves original CRLF/tab positions before value or canvas adaptation', () => {
    const source = '<canvas>\r\n\t<mesh position={value} class:active />\r\n</canvas>';
    const start = source.indexOf('class:active');
    const error = captureError(() => prepareTypeGpuSource(source, filename));
    expect(error).toMatchObject({
      position: [start, start + 'class:active'.length],
      start: { line: 2, column: 24, character: start },
      frame: expect.stringContaining('2:   <mesh position={value} class:active />')
    });
    expect((error as { frame: string }).frame).not.toContain('\r');
  });

  it.each(['client', 'server'].flatMap(generate => [false, true].map(dev => ({ generate: generate as 'client' | 'server', dev }))))
    ('fails before SSR omission or warning suppression ($generate, dev: $dev)', ({ generate, dev }) => {
    const filter = vi.fn(() => false);
    for (const { syntax } of directives) for (const viewport of [false, true]) {
      const scene = `<scene><mesh ${syntax} /></scene>`;
      const source = viewport ? `<canvas>${scene}</canvas>` : scene;
      expect(captureError(() => compileTypeGpu(source, { filename, generate, dev, warningFilter: filter })))
        .toMatchObject({ code: 'typegpu_unsupported_directive' });
    }
    expect(filter).not.toHaveBeenCalled();
  });

  it('leaves supported attachments, component props and native canvas attributes unchanged', () => {
    const scene = `<script>let { setup, properties, Component, color } = $props();</script>
      {#snippet item()}<mesh name="use:setup class:active style:color" {@attach setup} position={[1, 0, 0]}><boxGeometry /><standardMaterial {color} /></mesh>{/snippet}
      <scene><Component {...properties} class="consumer-prop" style={{ color }}>{@render item()}</Component>
        <svelte:element this={'mesh'} {...properties} {@attach setup} />
      </scene>`;
    const prepared = prepareTypeGpuSource(scene, filename);
    const plain = compile(prepared.code, { filename, hmr: false,
      experimental: { customRenderer: 'svelte-typegpu/svelte-renderer' } });
    expect(compileTypeGpu(scene, { filename }).js.code).toBe(plain.js.code);
    const viewport = '<script>let { setup, active, color } = $props();</script>' +
      '<canvas class={{ active }} style={`color: ${color}`} {@attach setup}><scene /></canvas>';
    const host = prepareTypeGpuSource(viewport, filename);
    const compiled = compile(host.code, { filename, hmr: false,
      experimental: { customRenderer: 'svelte-typegpu/svelte-renderer' } });
    expect(compileTypeGpu(viewport, { filename }).js.code).toBe(adaptViewportClient(compiled.js.code).code);
    expect(host.code).toContain('class={{ active }}');
    expect(host.code).toContain('{@attach setup}');
  });

  it('applies errors in the Vite path without disabling ordinary DOM directives', async () => {
    const root = fileURLToPath(new URL('../../../apps/example/', import.meta.url));
    const transport = createHttpServer();
    const cacheDir = await mkdtemp(join(tmpdir(), 'typegpu-directives-vite-'));
    const onwarn = vi.fn();
    const sources = new Map<string, string>();
    const server = await createServer({
      root, cacheDir, configFile: false, logLevel: 'silent',
      plugins: [{
        name: 'directive-test-sources', enforce: 'pre',
        resolveId(id) {
          if (sources.has(id)) return id;
          const path = join(root, id.replace(/^\//, ''));
          if (sources.has(path)) return path;
        },
        load(id) { return sources.get(id); }
      }, typegpuSvelte({ configFile: false, onwarn, compilerOptions: { warningFilter: () => false } })],
      server: { middlewareMode: true, hmr: { server: transport }, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] }
    });
    try {
      for (const { syntax } of directives) for (const ssr of [false, true]) {
        const source = `<canvas><scene><mesh ${syntax} /></scene></canvas>`;
        const url = `/src/Invalid-${syntax.split(':')[0]}.typegpu.svelte`;
        const id = join(root, url.slice(1));
        sources.set(id, source);
        await expect(server.transformRequest(url, { ssr }))
          .rejects.toMatchObject({
            name: 'TypeGpuCompileError', code: 'typegpu_unsupported_directive', id,
            loc: { file: id, line: 1, column: source.indexOf(syntax) },
            frame: expect.stringContaining(syntax)
          });
      }
      const source = '<script>let active = true; function setup() {}</script><div use:setup class:active style:color={"red"}></div>';
      sources.set(join(root, 'src/DomDirectives.svelte'), source);
      const dom = await server.transformRequest('/src/DomDirectives.svelte');
      expect(dom!.code).toContain('$.action(');
      expect(dom!.code).toContain('$.set_class(');
      expect(dom!.code).toContain('$.set_style(');
      expect(dom!.code).not.toContain('svelte-typegpu/svelte-renderer');
      expect(onwarn).not.toHaveBeenCalled();
    } finally { await server.close(); transport.close(); await rm(cacheDir, { recursive: true, force: true }); }
  }, 15_000);
});
