// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import tgpu from 'typegpu';
import { createFragment } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer, drawTypeGpuMaterialBatch } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { settleComponentUpdates } from './component-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { VisibilitySelection } from './batch-visibility';
import type { TypeGpuCameraSettings } from './types';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[],
  draws: [] as { indexed: boolean; count: number; firstInstance: number }[] }));
vi.mock('typegpu', async original => {
  const actual = await original<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});
vi.mock('./typegpu-pipeline', async () => {
  const { createFakePipeline } = await import('./gpu-test-utils');
  return { createMeshPipeline: vi.fn(() => createFakePipeline(captured)),
    createShadowPipeline: vi.fn(() => createFakePipeline(captured)),
    createShaderPassPipeline: vi.fn(() => createFakePipeline(captured)) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); captured.bindings.length = captured.counts.length = captured.draws.length = 0; });

const camera = (x: number): TypeGpuCameraSettings => ({ projection: 'perspective', position: [x, 0, 10],
  target: [x, 0, 0], fov: 30, near: 0.1, far: 20 });

describe('compiled scene frustum delivery', () => {
  it.each([60, 120, 144].flatMap(hz => [
    { hz, mode: 'demand' as const, first: false }, { hz, mode: 'demand' as const, first: true },
    { hz, mode: 'manual' as const, first: false }
  ]))('selects current camera slots at $hz Hz ($mode, renderer first: $first)', async ({ hz, mode, first }) => {
    let now = 0, id = 0, x = 0, active = true;
    const pending = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
    vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
    const canvas = Object.assign(new EventTarget(), { width: 100, height: 100, clientWidth: 100, clientHeight: 100 }) as HTMLCanvasElement;
    const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop: mode });
    const changed = vi.spyOn(gpuRenderer, 'setScene');
    const root = createFragment(), runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer); root.runtime = runtime;
    const setup = vi.fn(() => cleanup), cleanup = vi.fn();
    const Scene = compileViewportSource<{ cull(value: boolean): void; move(value: number): void }>(`<script>
      let { setup } = $props(); let enabled = $state(true), moving = $state(0);
      export function cull(value) { enabled = value; }
      export function move(value) { moving = value; }
    </script><scene frustumCulling={enabled}>
      <perspectiveCamera position={[0,0,10]} target={[0,0,0]} fov={30} near={0.1} far={20} />
      <directionalLight castShadow={true} position={[0,10,10]} />
      {#each [0,10,20] as x (x)}<mesh position={[x + (x === 0 ? moving : 0),0,0]} castShadow={true} {@attach setup}>
        <boxGeometry /><standardMaterial />
      </mesh>{/each}
    </scene>`);
    const instance = mount(Scene, { renderer, target: root, props: { setup } });
    async function step() {
      now += 1000 / hz;
      for (const [id, callback] of [...pending]) {
        if (!pending.delete(id)) continue;
        callback(now); flushSync(); await Promise.resolve();
      }
    }
    let disposed = false;
    try {
      await settleComponentUpdates(); for (let i = 0; i < 4; i++) await step();
      if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(pending.size).toBe(0); expect(setup).toHaveBeenCalledTimes(3);
      const batch = changed.mock.lastCall![0].drawBatches[0], storage = batch.instances, bounds = batch.visibility;
      const instanceBuffers = buffers.filter(buffer => buffer.label.endsWith('instances'));
      for (const buffer of instanceBuffers) buffer.write.mockClear();
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear(); vi.mocked(createMeshPipeline).mockClear();
      const renderFrame = gpuRenderer.renderFrame.bind(gpuRenderer);
      const rendered = vi.spyOn(gpuRenderer, 'renderFrame').mockImplementation(timestamp => {
        captured.draws.length = 0; renderFrame(timestamp);
        expect(captured.draws).toEqual([
          { indexed: false, count: 3, firstInstance: 0 },
          { indexed: false, count: 1, firstInstance: x / 10 }
        ]);
        expect(gpuRenderer.getRenderStats!()).toMatchObject({ retainedInstances: 3, candidateInstances: 3,
          submittedInstances: 1, culledInstances: 2, colorDraws: 1, colorTriangles: 12, shadowTriangles: 36 });
      });
      function producer() {
        if (!active) return;
        x = x === 0 ? 10 : 0; gpuRenderer.setCamera(camera(x)); requestAnimationFrame(producer);
      }
      if (first) gpuRenderer.invalidate();
      requestAnimationFrame(producer);
      if (!first) gpuRenderer.invalidate();
      for (let frame = 0; frame < hz / 2; frame++) {
        const before = rendered.mock.calls.length, beforePasses = submissions.length;
        await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
        expect(rendered.mock.calls.length - before).toBe(1);
        expect(submissions.length - beforePasses).toBe(2);
        expect(batch.instances).toBe(storage); expect(batch.visibility).toBe(bounds);
      }
      expect(instanceBuffers.every(buffer => buffer.write.mock.calls.length === 0)).toBe(true);
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
      if (mode === 'manual') expect(request.mock.calls.every(([callback]) => callback === producer)).toBe(true);
      active = false; for (let i = 0; i < 4; i++) await step(); expect(pending.size).toBe(0);
      const settled = submissions.length; for (let i = 0; i < 3; i++) await step(); expect(submissions.length).toBe(settled);
      rendered.mockRestore();
      flushSync(() => instance.cull(false)); await settleComponentUpdates();
      await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(gpuRenderer.getRenderStats!()).toMatchObject({ candidateInstances: 3, submittedInstances: 3, culledInstances: 0, colorDraws: 1 });
      flushSync(() => { instance.cull(true); instance.move(100); }); await settleComponentUpdates();
      await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(gpuRenderer.getRenderStats!()).toMatchObject({ submittedInstances: 0, culledInstances: 3, colorDraws: 0, shadowTriangles: 36 });
      gpuRenderer.invalidate(); await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); disposed = true;
      expect(pending.size).toBe(0); expect(cleanup).toHaveBeenCalledTimes(3);
      expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      active = false;
      if (!disposed) { await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); }
      pending.clear();
    }
  });

  it.each([false, true])('passes canonical instance offsets to draws (indexed: %s)', indexed => {
    const draw = vi.fn(), drawIndexed = vi.fn();
    const pipeline = { with() { return this; }, withIndexBuffer() { return this; }, draw, drawIndexed };
    const selection = new VisibilitySelection(); selection.rangeCount = 2; selection.ranges.set([2, 3, 8, 1]);
    drawTypeGpuMaterialBatch({ pipeline, selection, geometryResource: {
      vertexBuffer: { buffer: {} }, ...(indexed ? { indexBuffer: { buffer: {} }, indexCount: 6, indexFormat: 'uint16' } : {})
    }, instanceResource: { buffer: { buffer: {} } }, materialResource: {}, batch: { geometry: { vertexCount: 6 } } } as never);
    expect(indexed ? drawIndexed.mock.calls : draw.mock.calls).toEqual(indexed ? [[6, 3, 0, 0, 2], [6, 1, 0, 0, 8]] : [[6, 3, 0, 2], [6, 1, 0, 8]]);
    expect(indexed ? draw : drawIndexed).not.toHaveBeenCalled();
  });
});
