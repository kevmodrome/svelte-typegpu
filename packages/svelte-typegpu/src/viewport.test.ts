// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import { flushSync, getContext, hydrate, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTypeGpuRoot, type TypeGpuRoot } from './svelte-renderer';
import { createFragment, walk, type TypeGpuNode } from './core';
import { compileViewportSource } from './viewport-test-utils';
import { compileTypeGpu } from '../compiler/index';
import * as canvasBindings from './canvas-bindings';

vi.mock('./svelte-renderer', async (original) => ({
  ...await original<typeof import('./svelte-renderer')>(), createTypeGpuRoot: vi.fn()
}));
const mounted: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0).reverse()) await unmount(instance);
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.mocked(createTypeGpuRoot).mockReset();
});
function root(events: string[] = []) {
  return Object.assign(createFragment(), { dispose: vi.fn(() => events.push('dispose')) }) as unknown as TypeGpuRoot;
}
function nodes(root: TypeGpuNode, name: string) {
  const found: TypeGpuNode[] = [];
  walk(root, (node) => { if (node.name === name) found.push(node); });
  return found;
}
const source = `<script>
  let { setup, nativeSetup, measure, onready, onrenderererror, keydown, get } = $props();
  let canvas = $state();
  let editing = $state(true);
  let items = $state([1, 2]);
  let label = $state('Preview');
  const theme = get?.('theme');
  export function reference() { return canvas; }
  export function toggle() { editing = !editing; }
  export function reorder() { items = [2, 1]; }
  export function rename() { label = 'Renamed'; }
</script>
{#snippet itemMesh(item)}<mesh name={item} color={theme?.color} {@attach setup} />{/snippet}
<canvas frameloop="demand" bind:this={canvas} aria-label={label} tabindex={0}
  bind:clientWidth={null, value => measure?.(value)}
  onkeydown={keydown} {@attach nativeSetup} {onready} {onrenderererror}>
  {#if editing}
    <scene>{#each items as item (item)}{@render itemMesh(item)}{/each}</scene>
  {:else}<scene><mesh name="preview" /></scene>{/if}
</canvas>
<style>canvas { height: 420px; } canvas:focus { outline: 2px solid red; }</style>`;
type Exports = { reference(): HTMLCanvasElement | null | undefined; toggle(): void; reorder(): void; rename(): void };

describe('declarative canvas', () => {
  it('owns one native canvas while snippet branches, keys, props and events change', async () => {
    const events: string[] = [];
    const gpu = root(events);
    vi.mocked(createTypeGpuRoot).mockResolvedValue(gpu);
    const cleanup = vi.fn(() => events.push('unmount'));
    const setup = vi.fn(() => cleanup);
    const nativeCleanup = vi.fn();
    const nativeSetup = vi.fn(() => nativeCleanup);
    const onready = vi.fn();
    const keydown = vi.fn();
    const instance = mount(compileViewportSource<Exports>(source), {
      target: document.body, context: new Map([['theme', { color: [1, 0, 0] }]]),
      props: { setup, nativeSetup, onready, keydown, get: getContext }
    });
    mounted.push(instance);
    await tick(); await tick();
    const canvas = document.querySelector('canvas')!;
    expect(document.querySelector('div')).toBeNull();
    expect(instance.reference()).toBe(canvas);
    expect(nativeSetup).toHaveBeenCalledExactlyOnceWith(canvas);
    expect([...canvas.classList].some((name) => name.startsWith('typegpu-'))).toBe(true);
    const meshes = nodes(gpu, 'mesh');
    expect(meshes[0].attributes.color).toEqual([1, 0, 0]);
    const input = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    canvas.dispatchEvent(input);
    expect(keydown).toHaveBeenCalledExactlyOnceWith(input);
    flushSync(() => { instance.reorder(); instance.rename(); });
    expect(nodes(gpu, 'mesh')).toEqual([meshes[1], meshes[0]]);
    expect(canvas.getAttribute('aria-label')).toBe('Renamed');
    expect(cleanup).not.toHaveBeenCalled();
    flushSync(() => instance.toggle());
    expect(nodes(gpu, 'mesh')[0].attributes.name).toBe('preview');
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(instance.reference()).toBe(canvas);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(onready).toHaveBeenCalledOnce();
    await unmount(instance); mounted.pop();
    expect(nativeCleanup).toHaveBeenCalledOnce();
    expect(instance.reference()).toBeNull();
    expect(events).toEqual(['unmount', 'unmount', 'dispose']);
    expect(nodes(gpu, 'scene')).toEqual([]);
  });

  it.each([false, true])('handles delayed startup (removed before ready: %s)', async (removed) => {
    let resolve!: (value: TypeGpuRoot) => void;
    vi.mocked(createTypeGpuRoot).mockReturnValue(new Promise((yes) => { resolve = yes; }));
    const gpu = root();
    const onready = vi.fn();
    const instance = mount(compileViewportSource<Exports>(source), { target: document.body, props: { onready } });
    mounted.push(instance);
    await tick();
    flushSync(() => instance.toggle());
    if (removed) { await unmount(instance); mounted.pop(); }
    resolve(gpu);
    await tick(); await tick();
    if (removed) {
      expect(gpu.dispose).toHaveBeenCalledOnce();
      expect(onready).not.toHaveBeenCalled();
      expect(nodes(gpu, 'mesh')).toEqual([]);
    } else {
      expect(nodes(gpu, 'mesh')[0].attributes.name).toBe('preview');
      expect(onready).toHaveBeenCalledOnce();
    }
  });

  it('reports startup errors separately from native canvas errors', async () => {
    const error = new Error('WebGPU unavailable');
    vi.mocked(createTypeGpuRoot).mockRejectedValue(error);
    const rendererError = vi.fn();
    const nativeError = vi.fn();
    const Viewport = compileViewportSource('<script>let { rendererError, nativeError } = $props();</script><canvas onrenderererror={rendererError} onerror={nativeError} />');
    mounted.push(mount(Viewport, { target: document.body, props: { rendererError, nativeError } }));
    await tick(); await tick();
    expect(rendererError).toHaveBeenCalledExactlyOnceWith(error);
    expect(nativeError).not.toHaveBeenCalled();
    const canvas = document.querySelector('canvas')!;
    expect(canvas.dataset.typegpuStatus).toBe('error');
    canvas.dispatchEvent(new Event('error'));
    expect(nativeError).toHaveBeenCalledOnce();
  });

  it('hydrates the actual server host and retains its canvas identity', async () => {
    const serverPath = join(dirname(fileURLToPath(import.meta.resolve('svelte/package.json'))), 'src/index-server.js');
    const svelte = await vi.importActual<Record<string, unknown>>(serverPath);
    const server = await vi.importActual<Record<string, unknown>>('svelte/internal/server');
    function evaluate(code: string, dependencies: Record<string, unknown>) {
      const name = code.match(/export default function (\w+)/)![1];
      return new Function('$', ...Object.keys(dependencies), code.replace(/^import .*;\n/gm, '')
        .replace(`export default function ${name}`, `function ${name}`) + `\nreturn ${name};`)(server, ...Object.values(dependencies));
    }
    const initialize = vi.fn();
    const hostSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ViewportCanvas.svelte'), 'utf8');
    const Host = evaluate(compile(hostSource, { filename: 'ViewportCanvas.svelte', generate: 'server', runes: true }).js.code,
      { getAllContexts: svelte.getAllContexts, onMount: svelte.onMount, startCanvasScene: initialize });
    const ServerViewport = evaluate(compileTypeGpu(source, { filename: 'Viewport.typegpu.svelte', generate: 'server', runes: true }).js.code,
      { TypeGpuViewportCanvas: Host, TypeGpuCanvasBindings: canvasBindings });
    const measure = vi.fn();
    const html = render(ServerViewport, { props: { measure } }).body;
    expect(html).not.toContain('<scene');
    expect(html).not.toContain('<mesh');
    expect(initialize).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    document.body.innerHTML = html;
    const canvas = document.querySelector('canvas');
    const gpu = root();
    vi.mocked(createTypeGpuRoot).mockResolvedValue(gpu);
    Object.defineProperty(canvas, 'clientWidth', { value: 640 });
    const instance = hydrate(compileViewportSource<Exports>(source), { target: document.body, props: { measure }, recover: false });
    mounted.push(instance);
    await tick(); await tick();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(instance.reference()).toBe(canvas);
    expect(measure).toHaveBeenCalledExactlyOnceWith(640);
    expect(nodes(gpu, 'mesh')).toHaveLength(2);
    flushSync(() => instance.toggle());
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(nodes(gpu, 'mesh')).toHaveLength(1);
  });
});
