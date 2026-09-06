// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { prefersReducedMotion } from 'svelte/motion';
import * as svelteClient from 'svelte/internal/client';
import tgpu from 'typegpu';
import { createFragment } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';
import SvelteMotion from '../../../apps/docs/src/generated/typegpu-scenes/svelte-motion/SvelteMotion.typegpu.js';

// The real svelte/motion singleton captures its MediaQuery during module initialization.
const media = vi.hoisted(() => {
  let matches = false;
  const query = new EventTarget();
  Object.defineProperty(query, 'matches', { get: () => matches });
  vi.spyOn(window, 'matchMedia').mockReturnValue(query as MediaQueryList);
  return { query, change(value: boolean) { matches = value; query.dispatchEvent(new Event('change')); } };
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

describe('reduced motion in the generated Svelte Motion example', () => {
  it.each([60, 120, 144].flatMap(hz => [false, true].flatMap(initiallyReduced => [
    { hz, initiallyReduced, frameloop: 'demand' as const, rendererFirst: false },
    { hz, initiallyReduced, frameloop: 'demand' as const, rendererFirst: true },
    { hz, initiallyReduced, frameloop: 'manual' as const, rendererFirst: false }
  ])))('responds without replaying settled targets at $hz Hz ($frameloop, renderer first: $rendererFirst, initially reduced: $initiallyReduced)',
    async ({ hz, initiallyReduced, frameloop, rendererFirst }) => {
    media.change(initiallyReduced);
    expect(prefersReducedMotion.current).toBe(initiallyReduced);
    const add = vi.spyOn(media.query, 'addEventListener'), remove = vi.spyOn(media.query, 'removeEventListener');
    const pending = new Map<number, FrameRequestCallback>();
    const producers = new WeakSet<FrameRequestCallback>();
    let now = 0, id = 0;
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
    const Host = compileViewportSource<{ configure(values: Record<string, number>): void }>(`<script>
      let { Scene, initiallyReduced } = $props();
      const controls = $state({ x: initiallyReduced ? 0 : -7, z: initiallyReduced ? 0 : -7,
        lift: 0, appearance: 0, visible: true, count: 64 });
      export function configure(next) { Object.assign(controls, next); }
    </script><Scene {controls} onTargetChange={(x, z) => { controls.x = x; controls.z = z; }} />`);
    const instance = mount(Host, { renderer, target: root, props: { Scene: SvelteMotion, initiallyReduced } });
    const order: string[] = [];
    async function step() {
      now += 1000 / hz; order.length = 0;
      for (const [key, callback] of [...pending]) {
        if (!pending.delete(key)) continue;
        order.push(producers.has(callback) ? 'motion' : 'render');
        callback(now); flushSync(); await Promise.resolve();
      }
    }
    async function settle() {
      await settleComponentUpdates();
      for (let i = 0; i < 4; i++) await step();
    }
    let disposed = false;
    try {
      await settle();
      if (frameloop === 'manual') gpuRenderer.renderFrame(now);
      expect(add).toHaveBeenCalledOnce();
      expect(pending.size).toBe(0);
      const scene = root.children.find(node => node.name === 'scene')!;
      const marker = scene.children.filter(node => node.name === 'group').at(-1)!;
      const moving = marker.children.filter(node => node.name === 'mesh');
      expect(marker.attributes.position).toEqual(initiallyReduced ? [0, 2, 0] : [-7, 2, -7]);
      const batches = changed.mock.lastCall![0].drawBatches;
      expect(batches.map(batch => batch.instanceCount).sort((a, b) => a - b)).toEqual([1, 66]);
      const storage = batches.map(batch => batch.instances);
      const bufferForCount = (count: number) => buffers.find(buffer =>
        buffer.label === `TypeGPU ${batches.find(batch => batch.instanceCount === count)!.key} instances`)!;
      const standard = bufferForCount(66), shader = bufferForCount(1);
      const staticInstances = standard.data.slice(0, 64 * 24);
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear(); vi.mocked(createMeshPipeline).mockClear();
      changed.mockClear(); request.mockClear();
      media.change(false); await settle();
      expect(changed).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();

      async function animate(next: Record<string, number>) {
        if (frameloop === 'demand' && rendererFirst) { gpuRenderer.invalidate(); gpuRenderer.invalidate(); }
        flushSync(() => instance.configure(next)); await settleComponentUpdates();
        if (frameloop === 'demand' && !rendererFirst) { gpuRenderer.invalidate(); gpuRenderer.invalidate(); }
        for (let frame = 0; frame < hz; frame++) {
          standard.write.mockClear(); shader.write.mockClear(); changed.mockClear();
          const before = submissions.length, draws = captured.counts.length;
          await step();
          if (frameloop === 'manual') gpuRenderer.renderFrame(now);
          expect(submissions.length - before).toBe(1);
          expect(captured.counts.slice(draws).sort((a, b) => a - b)).toEqual([1, 66]);
          expect(order).toEqual(frameloop === 'manual' ? ['motion'] :
            rendererFirst ? ['render', 'motion'] : ['motion', 'render']);
          if (frame > 0) {
            expect(standard.write).toHaveBeenCalledOnce();
            expect(standard.write.mock.lastCall![1]).toEqual({ startOffset: 64 * 96, endOffset: 66 * 96 });
            expect(shader.write).toHaveBeenCalledOnce();
            expect(shader.write.mock.lastCall![1]).toEqual({ startOffset: 0, endOffset: 96 });
          }
          for (const [state] of changed.mock.calls) {
            expect(state.drawBatchesChanged).toBe(false);
            expect(state.drawBatches.every((batch, i) => batch.instances === storage[i])).toBe(true);
          }
          const x = (marker.attributes.position as number[])[0];
          expect(standard.data[64 * 24]).toBeCloseTo(x);
          expect(shader.data[0]).toBeCloseTo(x + 1.5);
        }
        if (frameloop === 'manual') expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
      }
      await animate({ x: 7, z: 6, lift: 2, appearance: 1 });
      expect((marker.attributes.position as number[])[0]).toBeLessThan(7);
      const beforeReduction = submissions.length;
      standard.write.mockClear(); shader.write.mockClear();
      media.change(true); await settleComponentUpdates();
      expect(marker.attributes.position).toEqual([7, 2, 6]);
      expect(moving[0].attributes.position).toEqual([0, 2, 0]);
      expect(moving[2].children[1].attributes.uniforms).toEqual({ value0: 1 });
      expect(standard.write).toHaveBeenCalledOnce(); expect(shader.write).toHaveBeenCalledOnce();
      expect(standard.write.mock.lastCall![1]).toEqual({ startOffset: 64 * 96, endOffset: 66 * 96 });
      expect(shader.write.mock.lastCall![1]).toEqual({ startOffset: 0, endOffset: 96 });
      await settle();
      expect(pending.size).toBe(0);
      // Active demand motion already owns one follow-up for either RAF callback order.
      expect(submissions.length - beforeReduction).toBe(frameloop === 'manual' ? 0 : 2);
      request.mockClear();
      const beforeInstant = submissions.length;
      flushSync(() => instance.configure({ x: 1, z: 2, lift: 1, appearance: 0.25 }));
      await settleComponentUpdates();
      expect(marker.attributes.position).toEqual([1, 2, 2]);
      expect(moving[0].attributes.position).toEqual([0, 1, 0]);
      expect(moving[2].children[1].attributes.uniforms).toEqual({ value0: 0.25 });
      await settle();
      expect(submissions.length - beforeInstant).toBe(frameloop === 'manual' ? 0 : 1);
      expect(request.mock.calls.every(([callback]) => !producers.has(callback))).toBe(true);
      if (frameloop === 'manual') expect(request).not.toHaveBeenCalled();
      request.mockClear(); changed.mockClear(); standard.write.mockClear(); shader.write.mockClear();
      const beforeReenable = submissions.length;
      media.change(false); await settle();
      expect(request).not.toHaveBeenCalled();
      expect(changed).not.toHaveBeenCalled();
      expect(standard.write).not.toHaveBeenCalled(); expect(shader.write).not.toHaveBeenCalled();
      expect(submissions).toHaveLength(beforeReenable);
      await animate({ x: -4, z: -3, lift: 3, appearance: 0.75 });
      expect((marker.attributes.position as number[])[0]).toBeGreaterThan(-4);
      expect(add).toHaveBeenCalledOnce(); expect(remove).not.toHaveBeenCalled();
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      expect(standard.data.slice(0, 64 * 24)).toEqual(staticInstances);
      expect(scene.children.filter(node => node.name === 'group').at(-1)).toBe(marker);
      await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); disposed = true;
      const beforeDispose = submissions.length;
      expect([...pending.values()].every(callback => producers.has(callback))).toBe(true);
      await settle();
      media.change(true); await settle();
      expect(remove).toHaveBeenCalledOnce();
      expect(pending.size).toBe(0);
      expect(submissions).toHaveLength(beforeDispose);
      expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      if (!disposed) { await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); }
      await settle();
    }
  });
});
