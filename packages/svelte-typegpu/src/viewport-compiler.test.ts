import { describe, expect, it } from 'vitest';
import { adaptViewportClient, compileTypeGpu, prepareTypeGpuSource } from '../compiler/index';

const filename = 'Viewport.typegpu.svelte';
describe('viewport compiler boundary', () => {
  it('leaves GPU-only files unchanged', () => {
    const source = '<scene><mesh><boxGeometry /></mesh></scene>';
    expect(prepareTypeGpuSource(source, filename)).toEqual({ code: source, viewport: false });
    expect(compileTypeGpu(source, { filename }).js.code).toContain('$.push_renderer($renderer)');
  });
  it.each([false, true])('keeps the entry DOM-owned and snippets scene-owned (dev %s)', (dev) => {
    const compiled = compileTypeGpu('<canvas><scene><mesh /></scene></canvas>', { filename, dev });
    expect(compiled.js.code).toContain('$.push_renderer(null)');
    expect(compiled.js.code).toContain('$.renderer_snippet($renderer');
    expect(compiled.js.map).toBeDefined();
  });
  it('supports native refs, attachments and scoped CSS without changing the consumer script', () => {
    const source = `<script>let ref; let { setup } = $props();</script>
      <canvas bind:this={ref} {@attach setup} aria-label="Preview"><scene /></canvas>
      <style>canvas:hover { opacity: 0.8; } @media (max-width: 600px) { canvas { height: 300px; } }</style>`;
    const prepared = prepareTypeGpuSource(source, filename);
    expect(prepared.code).toContain('bind:canvas={ref}');
    expect(prepared.code).toContain('let ref; let { setup } = $props();');
    const result = compileTypeGpu(source, { filename });
    expect(result.css?.code).toContain('canvas.typegpu-');
    expect(result.js.code).toContain('typegpu-');
    expect(result.warnings.filter((warning) => warning.code === 'css_unused_selector')).toEqual([]);
  });
  it('server-compiles a DOM host rather than a custom-renderer no-op', () => {
    const compiled = compileTypeGpu('<canvas aria-label="Preview"><scene /></canvas>', { filename, generate: 'server' });
    expect(compiled.js.code).toContain('TypeGpuViewportCanvas');
    expect(compiled.js.code).not.toContain('svelte-typegpu/svelte-renderer');
  });
  it.each([false, true])('keeps top-level and exported snippets renderer-owned (dev %s)', (dev) => {
    const source = `<script module>export { cube };</script>
      {#snippet cube(x)}<mesh position={[x, 0, 0]}><boxGeometry /></mesh>{/snippet}
      <canvas><scene>{@render cube(1)}</scene></canvas>
      {#snippet unused()}<mesh onclick={() => {}} />{/snippet}
      <style>canvas { height: 420px; }</style>`;
    const client = compileTypeGpu(source, { filename, dev });
    expect(client.js.code).toContain('$.push_renderer(null)');
    expect(client.js.code).toContain('$.renderer_snippet($renderer');
    expect(client.css?.code).toContain('canvas.typegpu-');
    const server = compileTypeGpu(source, { filename, generate: 'server', dev });
    expect(server.js.code).toContain('export { cube }');
    expect(server.js.code).not.toContain('<mesh');
    expect(server.js.code).not.toContain('<boxGeometry');
    expect(server.warnings.filter((warning) => warning.code.startsWith('a11y_'))).toEqual([]);
  });
  it.each([
    '{#if true}<canvas />{/if}', '<canvas /><canvas />', '<canvas><canvas /></canvas>',
    '<div /><canvas />', '<canvas bind:clientWidth={width} />', '<canvas width={300} />',
    '<canvas transition:fade />', '<canvas class:active={true} />'
  ])('rejects unsupported canvas contracts: %s', (source) => {
    expect(() => prepareTypeGpuSource(source, filename)).toThrow(/viewport|<canvas/);
  });
  it('fails closed on incompatible compiler output', () => {
    expect(() => adaptViewportClient('export default () => {};')).toThrow(/Unsupported Svelte/);
    expect(() => adaptViewportClient('export default function Viewport() {}')).toThrow(/Unsupported Svelte/);
    expect(() => compileTypeGpu('<!-- preserved --><canvas><scene /></canvas>', {
      filename, preserveComments: true
    })).toThrow(/Unsupported Svelte/);
  });
});
