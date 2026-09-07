import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TgpuRoot } from 'typegpu';
import { createElement, insert, removeAttribute, setAttribute } from './core';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import { createFakeGpuRoot, enableFakeOcclusion } from './gpu-test-utils';
import { HiZOcclusion, isOcclusionEligible, isUsefulOccluder, packOcclusionBounds, pyramidSize } from './occlusion';
import { drawTypeGpuMaterialBatch } from './gpu-renderer';
import { createViewProjectionMatrix } from './camera-math';

afterEach(() => vi.unstubAllGlobals());
function fixture(count = 260) {
  const scene = createElement('scene');
  setAttribute(scene, 'frustumCulling', false); setAttribute(scene, 'occlusion', 'hi-z');
  const nodes = Array.from({ length: count }, (_, i) => {
    const mesh = createElement('mesh'); setAttribute(mesh, 'position', [i, 0, 0]);
    insert(mesh, createElement('boxGeometry'), null); insert(scene, mesh, null); return mesh;
  });
  const cache = createTypeGpuSceneCache();
  const state = createSceneState(scene, cache);
  return { scene, nodes, cache, batch: state.drawBatches[0] };
}

describe('conservative occlusion contracts', () => {
  it('retains bounds when frustum culling is off and resolves reactive settings', () => {
    const { scene, cache, batch } = fixture();
    expect(batch.visibility).toBeDefined();
    setAttribute(scene, 'occlusion', 'none');
    expect(createSceneState(scene, cache).renderSettings.occlusion).toBe('none');
    removeAttribute(scene, 'occlusion');
    expect(createSceneState(scene, cache).renderSettings.occlusion).toBeUndefined();
  });

  it.each([[1,1,1,1,1], [3,5,2,4,3], [1001,601,512,512,10], [2048,256,1024,128,11]])(
    'pads %ix%i without dropping odd pixels', (w, h, width, height, levels) => {
      expect(pyramidSize(w, h)).toEqual({ width, height, levels });
    });

  it('rounds bounds outwards and bypasses unknown/alpha instances', () => {
    const { batch } = fixture(3), packed = new Float32Array(24);
    batch.visibility!.items.set([0.123456789, -7, 3, 1.23456789, 2, 9]);
    batch.visibility!.items[6] = -Infinity;
    batch.instances[2 * 24 + 7] = 0.5;
    packOcclusionBounds(batch, packed, 0, 3);
    for (let i = 0; i < 3; i++) {
      expect(packed[i]).toBeLessThan(batch.visibility!.items[i]);
      expect(packed[i + 4]).toBeGreaterThan(batch.visibility!.items[i + 3]);
    }
    expect([packed[3], packed[11], packed[19]]).toEqual([1, 0, 0]);
  });

  it('excludes unsupported material/depth contracts and uses bounded actual occluders', () => {
    const { batch } = fixture(1);
    expect(isOcclusionEligible(batch)).toBe(true);
    const matrix = createViewProjectionMatrix(1, { projection: 'perspective', position: [0,0,2], target: [0,0,0], fov: 45, near: 0.1, far: 100 });
    expect(isUsefulOccluder(batch, matrix)).toBe(true);
    for (const patch of [{ transparent: true }, { depthTest: false }, { depthWrite: false }, { opacity: 0.8 }, { blendMode: 'alpha' }]) {
      expect(isOcclusionEligible({ ...batch, material: { ...batch.material, ...patch } } as typeof batch)).toBe(false);
    }
    expect(isUsefulOccluder({ ...batch, instanceCount: 100000 }, matrix)).toBe(false);
    expect(isOcclusionEligible({ ...batch, geometry: { ...batch.geometry, hasVertexAlpha: true } })).toBe(false);
  });

  it('retains metadata and buffers, uploads only changed bounds, prunes and disposes', () => {
    const { root } = createFakeGpuRoot({ bindings: [], counts: [] });
    const fake = enableFakeOcclusion(root);
    const gpu = root as unknown as TgpuRoot, culler = new HiZOcclusion(gpu);
    const { batch, nodes, scene, cache } = fixture();
    const matrix = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const selection = { rangeCount: 2, ranges: new Uint32Array([0,129,200,60]) };
    culler.begin(1001, 601, matrix);
    expect(HiZOcclusion.supported(gpu, 1001, 601)).toBe(true);
    expect(culler.prepare(batch, selection, undefined, {} as GPUBuffer)).toBe(true);
    const r = culler.resources.get(batch.key)!;
    expect(r.blockCount).toBe(3);
    expect([...r.blocksData.subarray(0, 12)]).toEqual([0,128,0,0, 128,1,0,0, 200,60,1,0]);
    expect([...r.rangesData.subarray(0, 8)]).toEqual([0,2,0,129,36,0,0,1]);
    fake.writeBuffer.mockClear(); fake.device.createBuffer.mockClear(); root.createBindGroup.mockClear();
    culler.begin(1001, 601, matrix); culler.prepare(batch, selection, undefined, r.source);
    expect(fake.writeBuffer.mock.calls.map(([buffer]) => buffer.label)).toEqual(['Occlusion camera']);
    expect(fake.device.createBuffer).not.toHaveBeenCalled(); expect(root.createBindGroup).not.toHaveBeenCalled();
    setAttribute(nodes[17], 'position', [18, 1, 0]);
    const next = createSceneState(scene, cache).drawBatches[0];
    fake.writeBuffer.mockClear(); culler.updateBounds(next, [{ start: 17, count: 1 }]);
    expect(fake.writeBuffer.mock.calls.map(([, offset, , , bytes]) => [offset, bytes])).toEqual([[17 * 32, 32]]);
    selection.rangeCount = 1; selection.ranges.set([129, 100]);
    culler.prepare(next, selection, undefined, r.source);
    expect(r.blockCount).toBe(1); expect(r.rangesData[15]).toBe(0);
    culler.begin(513, 257, matrix);
    expect(fake.textures.slice(0, 2).every(t => t.destroy.mock.calls.length === 1)).toBe(true);
    expect(culler.prepare(next, { ranges: selection.ranges, rangeCount: 193 }, undefined, r.source)).toBe(false);
    fake.device.limits.maxStorageBufferBindingSize = 96;
    expect(culler.prepare(next, selection, undefined, r.source)).toBe(false);
    culler.prune(new Set()); expect(culler.resources.size).toBe(0);
    expect(fake.buffers.filter(b => b.label !== 'Occlusion camera').every(b => b.destroy.mock.calls.length === 1)).toBe(true);
    culler.dispose(); expect(fake.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
  });

  it.each([false, true])('issues one indirect command per retained range (indexed: %s)', indexed => {
    const draw = vi.fn(), drawIndexed = vi.fn(), drawIndirect = vi.fn(), drawIndexedIndirect = vi.fn();
    const pipeline = { with() { return this; }, withIndexBuffer() { return this; }, draw, drawIndexed, drawIndirect, drawIndexedIndirect };
    const args = {}, instances = {};
    drawTypeGpuMaterialBatch({ pipeline, indirect: { args, instances }, indirectRange: 4,
      selection: { ranges: new Uint32Array([2,3,8,1]), rangeCount: 2 },
      geometryResource: { vertexBuffer: { buffer: {} }, ...(indexed ? { indexBuffer: { buffer: {} }, indexCount: 6, indexFormat: 'uint16' } : {}) },
      instanceResource: { buffer: { buffer: {} } }, materialResource: {}, batch: { geometry: { vertexCount: 6 } }
    } as never);
    expect(indexed ? drawIndexedIndirect.mock.calls : drawIndirect.mock.calls).toEqual([[args,128], [args,160]]);
    expect(draw).not.toHaveBeenCalled(); expect(drawIndexed).not.toHaveBeenCalled();
  });
});
