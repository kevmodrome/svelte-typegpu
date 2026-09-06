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
  it('counts visible model nodes once, and submitted indexed/nonindexed triangles by pass', () => {
    const value = scene();
    expect(sceneWorkload(value)).toEqual({ models: 1, instances: 23, colorDraws: 2, colorTriangles: 86, shadowTriangles: 80 });
    value.lights = [];
    expect(sceneWorkload(value).shadowTriangles).toBe(0);
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
