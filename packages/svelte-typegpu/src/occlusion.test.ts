import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TgpuRoot } from 'typegpu';
import { createElement, insert, removeAttribute, setAttribute } from './core';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import { createFakeGpuRoot, enableFakeOcclusion } from './gpu-test-utils';
import { HiZOcclusion, isOcclusionEligible, packOcclusionBounds, packOcclusionClusters, pyramidSize } from './occlusion';
import { MAX_OCCLUDER_DRAWS, MAX_OCCLUDER_TESTS, MAX_OCCLUDER_TRIANGLES, OccluderSelection } from './occluder-selection';
import { drawTypeGpuMaterialBatch } from './gpu-renderer';
import { createViewProjectionMatrix } from './camera-math';
import { TYPEGPU_SHADOW_UNIFORM_BYTES } from './typegpu-layouts';

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
    const selection = new OccluderSelection();
    selection.select([batch], matrix, 0);
    expect(selection.count).toBe(1);
    for (const patch of [{ transparent: true }, { depthTest: false }, { depthWrite: false }, { opacity: 0.8 }, { blendMode: 'alpha' }]) {
      expect(isOcclusionEligible({ ...batch, material: { ...batch.material, ...patch } } as typeof batch)).toBe(false);
    }
    expect(isOcclusionEligible({ ...batch, material: { ...batch.material, map: { kind: 'url', src: 'opaque.png' } } })).toBe(true);
    expect(isOcclusionEligible({ ...batch, geometry: { ...batch.geometry, hasVertexAlpha: true } })).toBe(false);
  });

  it('selects individual walls in large shared batches, caches, and obeys global budgets', () => {
    const { batch } = fixture(5000);
    const matrix = createViewProjectionMatrix(1, { projection: 'perspective', position: [0,0,2], target: [0,0,0], fov: 45, near: 0.1, far: 100 });
    const selection = new OccluderSelection(), batches = [batch];
    selection.select(batches, matrix, 1);
    expect(selection.count).toBeGreaterThan(0);
    expect(selection.count).toBeLessThanOrEqual(MAX_OCCLUDER_DRAWS);
    expect(selection.triangles).toBeLessThanOrEqual(MAX_OCCLUDER_TRIANGLES);
    expect(selection.tests).toBeLessThanOrEqual(MAX_OCCLUDER_TESTS);
    expect(selection.fullBatches.size).toBe(0);
    expect(selection.entries[0].count).toBe(1);
    const entries = [...selection.entries];
    selection.select(batches, matrix, 1);
    expect(selection.tests).toBe(0);
    expect(selection.entries.every(entry => entries.includes(entry))).toBe(true);
    // Alpha can change without changing spatial bounds. The renderer explicitly
    // invalidates selection on sparse instance or material updates.
    const first = selection.entries[0].first;
    batch.instances[first * 24 + 7] = 0.5;
    selection.invalidate(); selection.select(batches, matrix, 1);
    expect(selection.tests).toBeGreaterThan(0);
    expect(selection.entries.slice(0, selection.count).some(entry => entry.first === first)).toBe(false);
  });

  it('ranks later useful batches instead of accepting the first 16 and bounds total triangles', () => {
    const { batch } = fixture(1);
    const matrix = createViewProjectionMatrix(1, { projection: 'perspective', position: [0,0,2], target: [0,0,0], fov: 45, near: 0.1, far: 100 });
    const batches = Array.from({ length: 40 }, (_, i) => ({ ...batch, key: `batch-${i}`,
      geometry: { ...batch.geometry, vertexCount: i === 39 ? 3 : 12288 } }));
    const selection = new OccluderSelection(); selection.select(batches, matrix, 1);
    expect(selection.entries[0].batch.key).toBe('batch-39');
    expect(selection.triangles).toBeLessThanOrEqual(MAX_OCCLUDER_TRIANGLES);
    expect(selection.count).toBeLessThanOrEqual(MAX_OCCLUDER_DRAWS);
  });

  it('retains metadata and buffers, uploads only changed bounds, prunes and disposes', () => {
    const { root } = createFakeGpuRoot({ bindings: [], counts: [] });
    const fake = enableFakeOcclusion(root);
    const gpu = root as unknown as TgpuRoot, culler = new HiZOcclusion(gpu, true);
    expect(fake.device.createBuffer).toHaveBeenCalledWith(expect.objectContaining({ label: 'Occlusion camera', size: TYPEGPU_SHADOW_UNIFORM_BYTES }));
    const { batch, nodes, scene, cache } = fixture();
    const matrix = new Float32Array([1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]);
    const selection = { rangeCount: 2, ranges: new Uint32Array([0,129,200,60]) };
    culler.begin(1001, 601, matrix);
    expect(HiZOcclusion.supported(gpu, 1001, 601)).toBe(true);
    expect(culler.prepare(batch, selection, undefined, {} as GPUBuffer)).toBe(true);
    const r = culler.resources.get(batch.key)!;
    expect(r.blockCount).toBe(4);
    expect([...r.blocksData.subarray(0, 16)]).toEqual([0,128,0,0, 128,1,0,1, 200,56,1,1, 256,4,1,2]);
    expect([...r.rangesData.subarray(0, 8)]).toEqual([0,2,0,129,36,0,0,1]);
    fake.writeBuffer.mockClear(); fake.device.createBuffer.mockClear(); root.createBindGroup.mockClear();
    culler.begin(1001, 601, matrix); culler.prepare(batch, selection, undefined, r.source);
    expect(fake.writeBuffer.mock.calls.map(([buffer]) => buffer.label)).toEqual(['Occlusion camera']);
    expect(fake.device.createBuffer).not.toHaveBeenCalled(); expect(root.createBindGroup).not.toHaveBeenCalled();
    setAttribute(nodes[17], 'position', [18, 1, 0]);
    const next = createSceneState(scene, cache).drawBatches[0];
    fake.writeBuffer.mockClear(); culler.updateBounds(next, [{ start: 17, count: 1 }]);
    expect(fake.writeBuffer.mock.calls.map(([, offset, , , bytes]) => [offset, bytes])).toEqual([[17 * 32, 32], [0, 32]]);
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

  it('packs enclosing tree clusters, handles unknown/alpha bounds, and never includes unused capacity', () => {
    const { batch } = fixture(260), clusters = new Float32Array(24), individual = new Float32Array(260 * 8);
    packOcclusionClusters(batch, clusters, 0, 3); packOcclusionBounds(batch, individual, 0, 260);
    for (let i = 0; i < 260; i++) {
      const cluster = Math.floor(i / 128) * 8;
      for (let axis = 0; axis < 3; axis++) {
        expect(clusters[cluster + axis]).toBeLessThanOrEqual(individual[i * 8 + axis]);
        expect(clusters[cluster + axis + 4]).toBeGreaterThanOrEqual(individual[i * 8 + axis + 4]);
      }
    }
    expect([clusters[3], clusters[11], clusters[19]]).toEqual([1, 1, 1]);
    batch.instances[150 * 24 + 7] = 0.5;
    packOcclusionClusters(batch, clusters, 1, 1); expect(clusters[11]).toBe(0);
    const base = batch.visibility!.leafBase * batch.visibility!.leafSize / 128;
    batch.visibility!.nodes[base * 6] = -Infinity;
    packOcclusionClusters(batch, clusters, 0, 1); expect(clusters[3]).toBe(0);
  });

  it('keeps the flat benchmark path free of cluster buffers and uploads', () => {
    const { root } = createFakeGpuRoot({ bindings: [], counts: [] }), fake = enableFakeOcclusion(root);
    const culler = new HiZOcclusion(root as unknown as TgpuRoot, false), { batch } = fixture();
    culler.begin(400, 400, new Float32Array(16));
    culler.prepare(batch, { ranges: new Uint32Array([200, 60]), rangeCount: 1 }, undefined, {} as GPUBuffer);
    expect(culler.resources.get(batch.key)!.blockCount).toBe(1);
    expect(fake.buffers.some(buffer => buffer.label.startsWith('Occlusion clusters'))).toBe(false);
    culler.dispose();
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
