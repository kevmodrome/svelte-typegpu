// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, onDestroy, unmount, untrack } from 'svelte';
import { Tween, Spring } from 'svelte/motion';
import { innerWidth } from 'svelte/reactivity/window';
import * as svelteClient from 'svelte/internal/client';
import tgpu from 'typegpu';
import { createFragment } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';

await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(`${process.cwd()}/package.json`);
  const env = createRequire(require.resolve('svelte/package.json')).resolve('esm-env');
  vi.doMock(env, async importOriginal => ({ ...await importOriginal<object>(), BROWSER: true }));
});
const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[] }));
vi.mock('typegpu', async importOriginal => {
  const actual = await importOriginal<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});
vi.mock('@typegpu/noise', () => ({
  perlin3d: { staticCache: () => ({ inject: () => (root: unknown) => root, destroy() {} }) }
}));
vi.mock('./typegpu-pipeline', async () => {
  const { createFakePipeline } = await import('./gpu-test-utils');
  return {
    createMeshPipeline: vi.fn(() => createFakePipeline(captured)),
    createShadowPipeline: vi.fn(() => createFakePipeline(captured)),
    createShaderPassPipeline: vi.fn(() => createFakePipeline(captured))
  };
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  captured.bindings.length = 0; captured.counts.length = 0;
});

describe('native window values driving scene motion', () => {
  it.each([60, 120, 144].flatMap(hz => ['Tween', 'Spring'].flatMap(kind => [false, true].flatMap(factory => [
    { hz, kind, factory, frameloop: 'demand' as const, rendererFirst: false },
    { hz, kind, factory, frameloop: 'demand' as const, rendererFirst: true },
    { hz, kind, factory, frameloop: 'manual' as const, rendererFirst: false }
  ]))))('delivers resize-driven $kind at $hz Hz ($frameloop, renderer first: $rendererFirst, factory: $factory)',
    async ({ hz, kind, factory, frameloop, rendererFirst }) => {
    let width = 1000, now = 0, id = 0;
    vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => width);
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    expect(innerWidth.current).toBe(1000);
    const pending = new Map<number, FrameRequestCallback>();
    const producers = new WeakSet<FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
    const raf = (svelteClient as unknown as {
      raf: { now(): number; tick(callback: FrameRequestCallback): void };
    }).raf;
    vi.spyOn(raf, 'now').mockImplementation(() => now);
    vi.spyOn(raf, 'tick').mockImplementation(callback => { producers.add(callback); requestAnimationFrame(callback); });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
    vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const canvas = Object.assign(new EventTarget(), { width: 800, height: 500, clientWidth: 800, clientHeight: 500 }) as HTMLCanvasElement;
    const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop });
    const changed = vi.spyOn(gpuRenderer, 'setScene');
    const root = createFragment();
    const runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer);
    root.runtime = runtime;
    const motionOptions = kind === 'Tween' ? '{ duration: (from, to) => from === to ? 0 : 1800 }' :
      '{ stiffness: 0.03, damping: 0.7, precision: 1e-5 }';
    const Scene = compileViewportSource<{ current(): number }>(`<script>
      import { innerWidth } from 'svelte/reactivity/window';
      import { ${kind} } from 'svelte/motion';
      import { onDestroy, untrack } from 'svelte';
      let { setup } = $props();
      const target = $derived(((innerWidth.current ?? 1000) - 1000) / 100);
      ${factory ? `const motion = ${kind}.of(() => target, ${motionOptions});` : `
        const motion = new ${kind}(0, ${motionOptions});
        $effect(() => { if (target !== untrack(() => motion.target)) motion.target = target; });
      `}
      onDestroy(() => { void motion.set(motion.current, ${kind === 'Tween' ? '{ duration: 0 }' : '{ instant: true }'}); });
      export function current() { return motion.current; }
    </script><scene>
      {#each Array.from({ length: 300 }, (_, i) => i) as id (id)}
        <mesh position={[id + 10, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
      {/each}
      {#snippet marker(x)}
        <mesh position={[x, 0, 0]} {@attach setup}><boxGeometry /><standardMaterial /></mesh>
      {/snippet}
      {@render marker(motion.current)}
    </scene>`, { innerWidth, Tween, Spring, onDestroy, untrack });
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const instance = mount(Scene, { renderer, target: root, props: { setup } });
    const order: string[] = [];
    async function step() {
      now += 1000 / hz; order.length = 0;
      for (const [key, callback] of [...pending]) {
        if (!pending.delete(key)) continue;
        order.push(producers.has(callback) ? 'motion' : 'render');
        callback(now); flushSync(); await Promise.resolve();
      }
    }
    const resize = async (value: number) => {
      width = value; window.dispatchEvent(new Event('resize')); await settleComponentUpdates();
    };
    let disposed = false;
    try {
      await settleComponentUpdates();
      for (let i = 0; i < 3; i++) await step();
      if (frameloop === 'manual') gpuRenderer.renderFrame(now);
      expect(pending.size).toBe(0);
      expect(request.mock.calls.filter(([callback]) => producers.has(callback))).toHaveLength(factory ? 1 : 0);
      if (frameloop === 'manual') expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
      expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
      const buffer = buffers.find(buffer => buffer.label.endsWith('instances'))!;
      const storage = changed.mock.lastCall![0].drawBatches[0].instances;
      const staticInstances = buffer.data.slice(0, 300 * 24);
      const scene = root.children.find(node => node.name === 'scene')!;
      const original = scene.children.filter(node => node.name === 'mesh');
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear(); vi.mocked(createMeshPipeline).mockClear();
      changed.mockClear(); buffer.write.mockClear(); request.mockClear();
      await resize(1000);
      expect(pending.size).toBe(0);
      expect(changed).not.toHaveBeenCalled(); expect(buffer.write).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      if (frameloop === 'demand' && rendererFirst) { gpuRenderer.invalidate(); gpuRenderer.invalidate(); }
      await resize(2000);
      if (frameloop === 'demand' && !rendererFirst) { gpuRenderer.invalidate(); gpuRenderer.invalidate(); }
      for (let frame = 0; frame < hz; frame++) {
        changed.mockClear(); buffer.write.mockClear();
        const before = submissions.length, previous = instance.current();
        await step();
        if (frameloop === 'manual') gpuRenderer.renderFrame(now);
        expect(submissions.length - before).toBe(1);
        expect(order).toEqual(frameloop === 'manual' ? ['motion'] :
          rendererFirst ? ['render', 'motion'] : ['motion', 'render']);
        if (instance.current() !== previous) {
          expect(changed).toHaveBeenCalledOnce();
          const state = changed.mock.lastCall![0];
          expect(state.drawBatchesChanged).toBe(false);
          expect(state.drawBatches[0].instances).toBe(storage);
          expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 300, count: 1 }]);
          expect(buffer.write).toHaveBeenCalledOnce();
          expect(buffer.write.mock.lastCall![1]).toEqual({ startOffset: 300 * 96, endOffset: 301 * 96 });
        } else { expect(changed).not.toHaveBeenCalled(); expect(buffer.write).not.toHaveBeenCalled(); }
        expect(buffer.data[300 * 24]).toBeCloseTo(instance.current());
      }
      expect(instance.current()).toBeGreaterThan(0);
      expect(instance.current()).toBeLessThan(10);
      for (let i = 0; pending.size && i < hz * 20; i++) await step();
      expect(instance.current()).toBe(10);
      expect(pending.size).toBe(0);
      if (frameloop === 'manual') {
        expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
        gpuRenderer.renderFrame(now);
      }
      const settledFrames = submissions.length;
      changed.mockClear(); buffer.write.mockClear(); request.mockClear();
      await resize(2000);
      for (let i = 0; i < 4; i++) await step();
      expect(submissions).toHaveLength(settledFrames);
      expect(changed).not.toHaveBeenCalled(); expect(buffer.write).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(buffer.data.slice(0, 300 * 24)).toEqual(staticInstances);
      expect(scene.children.filter(node => node.name === 'mesh')).toEqual(original);
      expect(setup).toHaveBeenCalledOnce(); expect(cleanup).not.toHaveBeenCalled();
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      expect(captured.counts.every(count => count === 301)).toBe(true);
      expect(add.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
      expect(remove.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(0);

      await resize(3000); await step();
      await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); disposed = true;
      const beforeDispose = submissions.length;
      expect([...pending.values()].every(callback => producers.has(callback))).toBe(true);
      await settleComponentUpdates();
      for (let i = 0; i < 4; i++) await step();
      expect(remove.mock.calls.filter(([type]) => type === 'resize')).toHaveLength(1);
      expect(pending.size).toBe(0);
      await resize(4000);
      expect(pending.size).toBe(0);
      expect(submissions).toHaveLength(beforeDispose);
      expect(cleanup).toHaveBeenCalledOnce();
      expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      if (!disposed) { await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); }
      await settleComponentUpdates();
      for (let i = 0; i < 4; i++) await step();
    }
  });
});
