// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import tgpu from 'typegpu';
import { createFragment } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { settleComponentUpdates } from './component-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { createBoxGeometryData, createPlaneGeometryData } from './geometries';
import { createMaterialDescriptor } from './material-descriptors';
import { createModelLod } from './lod';
import type { TypeGpuCameraSettings, TypeGpuGeometryData, TypeGpuLoadedModel } from './types';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[],
  draws: [] as { indexed: boolean; count: number; firstInstance: number }[] }));
vi.mock('typegpu', async original => {
  const actual = await original<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});
vi.mock('./typegpu-pipeline', async () => {
  const { createFakePipeline } = await import('./gpu-test-utils');
  return { createMeshPipeline: vi.fn(() => createFakePipeline(captured)),
    createShadowPipeline: vi.fn(() => createFakePipeline(captured)), createShaderPassPipeline: vi.fn(() => createFakePipeline(captured)) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); captured.bindings.length = captured.counts.length = captured.draws.length = 0; });
const camera = (far: boolean): TypeGpuCameraSettings => ({ projection: 'perspective', position: [0, 0, far ? 200 : 8],
  target: [0, 0, 0], fov: 60, near: 0.1, far: 1000 });
const model = (geometry: TypeGpuGeometryData): TypeGpuLoadedModel => ({ key: geometry.key, meshes: [{ geometry,
  material: createMaterialDescriptor('standard'), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] });

describe('compiled asset LOD frame delivery', () => {
  it.each([60, 120, 144].flatMap(hz => [false, true].flatMap(indexed => [
    { hz, indexed, mode: 'demand' as const, first: false }, { hz, indexed, mode: 'demand' as const, first: true },
    { hz, indexed, mode: 'manual' as const, first: false }
  ])))('crosses levels at $hz Hz ($mode, renderer first: $first, indexed low: $indexed)', async ({ hz, indexed, mode, first }) => {
    let now = 0, id = 0, far = false, active = true;
    const pending = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured); vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
    const canvas = Object.assign(new EventTarget(), { width: 400, height: 400, clientWidth: 400, clientHeight: 400 }) as HTMLCanvasElement;
    const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop: mode });
    const changed = vi.spyOn(gpuRenderer, 'setScene');
    const root = createFragment(), runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer); root.runtime = runtime;
    const high = createBoxGeometryData(1, 1, 1), plane = createPlaneGeometryData(1, 1, 1, 1);
    const low = indexed ? { ...plane, key: 'indexed-low', indexData: new Uint32Array([0, 1, 2]), indexCount: 3, indexFormat: 'uint32' as const } : plane;
    const asset = createModelLod(model(high), [{ maxScreenHeight: 40, asset: model(low) }]);
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const Scene = compileViewportSource<{ move(value: number): void; raw(): void }>(`<script>
      let { asset, original, setup } = $props(); let moving = $state(0), rawMode = $state(false);
      export function move(value) { moving = value; }
      export function raw() { rawMode = true; }
    </script><scene frustumCulling={false}>
      <perspectiveCamera position={[0,0,8]} target={[0,0,0]} fov={60} near={0.1} far={1000} />
      <directionalLight castShadow={true} position={[0,10,10]} />
      {#each [-1,0,1] as x (x)}<model asset={rawMode ? original : asset} position={[x,0,x === -1 ? moving : 0]}
        castShadow={true} {@attach setup} />{/each}
    </scene>`);
    const instance = mount(Scene, { renderer, target: root, props: { asset, original: model(high), setup } });
    async function step() {
      now += 1000 / hz;
      for (const [id, callback] of [...pending]) {
        if (!pending.delete(id)) continue; callback(now); flushSync(); await Promise.resolve();
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
        expect(captured.draws).toEqual([{ indexed: false, count: 3, firstInstance: 0 },
          { indexed: far && indexed, count: 3, firstInstance: 0 }]);
        expect(gpuRenderer.getRenderStats!()).toMatchObject({ candidateInstances: 3, submittedInstances: 3,
          culledInstances: 0, colorDraws: 1, colorTriangles: far ? indexed ? 3 : 6 : 36, shadowTriangles: 36,
          lodInstances: far ? 3 : 0, lodTrianglesSaved: far ? indexed ? 33 : 30 : 0, lodRangeFallbacks: 0 });
      });
      function producer() { if (active) { far = !far; gpuRenderer.setCamera(camera(far)); requestAnimationFrame(producer); } }
      if (first) gpuRenderer.invalidate(); requestAnimationFrame(producer); if (!first) gpuRenderer.invalidate();
      for (let frame = 0; frame < hz / 2; frame++) {
        const before = rendered.mock.calls.length, beforePasses = submissions.length;
        await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
        expect(rendered.mock.calls.length - before).toBe(1); expect(submissions.length - beforePasses).toBe(2);
        expect(batch.instances).toBe(storage); expect(batch.visibility).toBe(bounds);
      }
      expect(instanceBuffers.every(buffer => buffer.write.mock.calls.length === 0)).toBe(true);
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled(); expect(cleanup).not.toHaveBeenCalled();
      if (mode === 'manual') expect(request.mock.calls.every(([callback]) => callback === producer)).toBe(true);
      active = false; for (let i = 0; i < 4; i++) await step(); expect(pending.size).toBe(0);
      const settled = submissions.length; await step(); expect(submissions.length).toBe(settled); rendered.mockRestore();
      flushSync(() => instance.move(190)); await settleComponentUpdates(); gpuRenderer.setCamera(camera(true));
      await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(gpuRenderer.getRenderStats!()).toMatchObject({ submittedInstances: 3, lodInstances: 2,
        colorTriangles: indexed ? 14 : 16, shadowTriangles: 36 });
      expect(instanceBuffers.flatMap(buffer => buffer.write.mock.calls).reduce((sum, [, range]) => sum + range!.endOffset - range!.startOffset, 0)).toBe(96);
      const lowBuffers = buffers.filter(buffer => buffer.label.includes(low.key) && !buffer.label.includes('lod:'));
      expect(lowBuffers.length).toBe(indexed ? 2 : 1);
      flushSync(() => instance.raw()); await settleComponentUpdates(); await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(gpuRenderer.getRenderStats!()).toMatchObject({ lodInstances: 0, colorTriangles: 36 });
      expect(lowBuffers.every(buffer => buffer.destroy.mock.calls.length === 1)).toBe(true);
      gpuRenderer.invalidate(); await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); disposed = true;
      expect(pending.size).toBe(0); expect(cleanup).toHaveBeenCalledTimes(3); expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      active = false;
      if (!disposed) { await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); }
      pending.clear();
    }
  });
});
