import { describe, expect, it, vi } from 'vitest';
import type { TypeGpuRoot } from 'svelte-typegpu';
import { profileWorld, sceneWorkload } from './world-profile';

type SceneState = Parameters<typeof sceneWorkload>[0];
function scene(): SceneState {
  const model = { name: 'model' };
  return { resourceItems: [{ node: model }, { node: model }, { node: { name: 'model' }, visible: false }, { node: { name: 'mesh' } }],
    lights: [{ kind: 'directional', castsShadow: true }],
    drawBatches: [
      { geometry: { indexCount: 12, vertexCount: 6 }, instanceCount: 20, castShadow: true },
      { geometry: { vertexCount: 6 }, instanceCount: 3, castShadow: false }
    ], drawBatchesChanged: true, lightsChanged: true } as unknown as SceneState;
}
describe('example workload sampling', () => {
  it('counts retained model nodes once, and candidate indexed/nonindexed triangles by pass', () => {
    const value = scene();
    expect(sceneWorkload(value)).toEqual({ models: 2, instances: 23, colorDraws: 2, colorTriangles: 86, shadowTriangles: 80 });
    value.lights = [];
    expect(sceneWorkload(value).shadowTriangles).toBe(0);
  });
  it('samples actual camera submissions without scanning or publishing on each frame', () => {
    const publish = vi.fn(), getRenderStats = vi.fn(() => ({ submittedInstances: 2, culledInstances: 21,
      colorDraws: 1, colorTriangles: 8, shadowTriangles: 80, cullingCpuMs: 0.12, rangeFallbacks: 0,
      lodInstances: 1, lodTrianglesSaved: 24, lodCpuMs: 0.2, lodRangeFallbacks: 0 }));
    const root = { gpu: { renderFrame() {}, setScene() {}, getRenderStats } } as unknown as TypeGpuRoot;
    const profiler = profileWorld(root, publish);
    root.gpu.setScene(scene());
    for (let i = 0; i < 144; i++) root.gpu.renderFrame(i);
    expect(getRenderStats).not.toHaveBeenCalled(); expect(publish).toHaveBeenCalledOnce();
    profiler.sample();
    expect(getRenderStats).toHaveBeenCalledOnce();
    expect(publish.mock.lastCall![0]).toMatchObject({ models: 2, instances: 2, culledInstances: 21,
      colorDraws: 1, colorTriangles: 8, shadowTriangles: 80, cullingCpuMs: 0.12, rangeFallbacks: 0,
      lodInstances: 1, lodTrianglesSaved: 24, lodCpuMs: 0.2, lodRangeFallbacks: 0 });
    profiler.dispose();
  });
  it('does not rescan batches on transform-only frames and restores wrapped methods', () => {
    let time = 0;
    const renderFrame = vi.fn(() => { time += 2; }), setScene = vi.fn(), publish = vi.fn();
    const root = { gpu: { renderFrame, setScene } } as unknown as TypeGpuRoot;
    const profiler = profileWorld(root, publish, () => time);
    root.gpu.setScene(scene());
    const incremental = { drawBatchesChanged: false, lightsChanged: false,
      get resourceItems() { throw new Error('Static models were rescanned'); } } as unknown as SceneState;
    root.gpu.setScene(incremental);
    expect(publish).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 144; i++) root.gpu.renderFrame(i);
    profiler.sample();
    expect(publish.mock.lastCall![0]).toMatchObject({ renderCpuMs: 2, maxRenderCpuMs: 2, colorTriangles: 86 });
    expect(renderFrame).toHaveBeenCalledTimes(144); expect(setScene).toHaveBeenCalledTimes(2);
    profiler.dispose(); profiler.sample();
    expect(root.gpu.renderFrame).toBe(renderFrame); expect(root.gpu.setScene).toBe(setScene);
    expect(publish).toHaveBeenCalledTimes(2);
  });
});
