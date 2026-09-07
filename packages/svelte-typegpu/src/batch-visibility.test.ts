import { describe, expect, it } from 'vitest';
import { BatchBounds, MAX_VISIBILITY_RANGES, VisibilitySelection, spatiallyOrderInstances } from './batch-visibility';
import { Frustum } from './frustum';
import { createViewProjectionMatrix } from './camera-math';
import { createDrawBatchCache } from './draw-batch-cache';
import { createElement } from './core';
import { transformBounds } from './bounds';
import { createMaterialDescriptor } from './material-descriptors';
import type { TypeGpuMeshDrawItem } from './types';

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const geometry = { key: 'test-box', vertexData: new Float32Array(36 * 12), vertexCount: 36,
  vertexFloats: 12, bounds: { min: [-0.1, -0.1, -0.1] as [number, number, number], max: [0.1, 0.1, 0.1] as [number, number, number] } };
const material = createMaterialDescriptor('standard');
function item(x: number, id = `${x}`): TypeGpuMeshDrawItem {
  const transform = { position: [x, 0, 0.5] as [number, number, number], rotation: [0, 0, 0] as [number, number, number], scale: [1, 1, 1] as [number, number, number] };
  return { id, node: createElement('mesh'), revision: 1, geometry, material, transform,
    bounds: transformBounds(geometry.bounds, transform), color: [1, 1, 1, 1], renderOrder: 0,
    hitTest: 'bounds', pointerEvents: 'auto', castShadow: true, receiveShadow: true };
}
function select(items: TypeGpuMeshDrawItem[], spatial = true) {
  const cache = createDrawBatchCache(), frustum = new Frustum(), selection = new VisibilitySelection();
  frustum.setMatrix(identity);
  const batch = cache.read(items, true, spatial)[0];
  selection.select(frustum, batch.visibility, batch.instanceCount);
  return { cache, frustum, selection, batch };
}
function ranges(selection: VisibilitySelection) { return Array.from(selection.ranges.subarray(0, selection.rangeCount * 2)); }

describe('retained batch visibility', () => {
  it('keeps thin ground-plane worlds spatially local despite small height variation', () => {
    const items = Array.from({ length: 8192 }, (_, i) => {
      const value = item(i, `${i}`);
      value.transform.position = [(i % 128) * 4, ((i * 2654435761) >>> 0) / 2 ** 32 * 0.01, Math.floor(i / 128) * 4];
      value.bounds = transformBounds(geometry.bounds, value.transform);
      return value;
    });
    const ordered = spatiallyOrderInstances(items);
    let widest = 0;
    for (let start = 0; start < ordered.length; start += 32) {
      const cluster = ordered.slice(start, start + 32);
      for (const axis of [0, 2]) {
        const positions = cluster.map(item => item.transform.position[axis]);
        widest = Math.max(widest, Math.max(...positions) - Math.min(...positions));
      }
    }
    expect(widest).toBeLessThan(100);
  });
  it('selects disjoint slots without repacking and coalesces adjacent visible slots', () => {
    const { batch, selection, frustum } = select([item(10), item(0), item(0.5), item(20), item(0.3)]);
    expect(ranges(selection)).toEqual([1, 2, 4, 1]); expect(selection.instanceCount).toBe(3);
    expect(batch.instanceCount).toBe(5); expect(batch.instanceIds).toEqual(['10', '0', '0.5', '20', '0.3']);
    const storage = selection.ranges;
    selection.select(frustum, batch.visibility, 5);
    expect(selection.boundsTests).toBe(0); expect(selection.ranges).toBe(storage);
  });

  it('reselects for camera motion without updating instances or world bounds', () => {
    const { batch, selection, frustum } = select([item(0), item(10)]);
    const instances = batch.instances.slice(), revision = batch.visibility!.revision;
    const translated = identity.slice(); translated[12] = -10; frustum.setMatrix(translated);
    selection.select(frustum, batch.visibility, 2); expect(ranges(selection)).toEqual([1, 1]);
    expect(batch.instances).toEqual(instances); expect(batch.visibility!.revision).toBe(revision);
  });

  it('refits only changed slots and their ancestors without changing canonical order', () => {
    const items = Array.from({ length: 50000 }, (_, i) => item(i + 20));
    const { cache, batch, selection, frustum } = select(items);
    expect(selection.instanceCount).toBe(0); expect(selection.boundsTests).toBe(1);
    const bounds = batch.visibility!, storage = bounds.nodes, instanceStorage = batch.instances;
    const moving = items[2000], slot = batch.instanceIds.indexOf(moving.id);
    moving.transform.position[0] = 0; moving.bounds = transformBounds(geometry.bounds, moving.transform); moving.revision++;
    cache.updateInstances([moving]); selection.select(frustum, bounds, batch.instanceCount);
    expect(batch.instances).toBe(instanceStorage); expect(bounds.nodes).toBe(storage);
    expect(batch.dirtyRanges).toEqual([{ start: slot, count: 1 }]);
    expect(bounds.lastRefitNodes).toBeLessThan(20);
    expect(selection.instanceCount).toBeLessThanOrEqual(32); expect(selection.instanceCount).toBeGreaterThan(0);
    expect(selection.boundsTests).toBeLessThan(30);
    const revision = bounds.revision;
    moving.color = [1, 0, 0, 1]; moving.revision++; cache.updateInstances([moving]);
    expect(bounds.revision).toBe(revision); expect(bounds.lastRefitNodes).toBe(0);
  });

  it('retains storage across shrink/grow within capacity and clears stale bounds', () => {
    const { cache, batch, frustum, selection } = select([item(0), item(10), item(20)]);
    const bounds = batch.visibility;
    const shrunk = cache.read([item(10)])[0]; expect(shrunk.visibility).toBe(bounds);
    selection.select(frustum, bounds, 1); expect(selection.instanceCount).toBe(0);
    const grown = cache.read([item(10), item(0), item(20), item(30)])[0];
    expect(grown.visibility).toBe(bounds); selection.select(frustum, bounds, 4); expect(ranges(selection)).toEqual([1, 1]);
    expect(cache.read([item(1), item(2), item(3), item(4), item(5)])[0].visibility).not.toBe(bounds);
  });

  it('keeps missing/nonfinite bounds visible, not the picking fallback box', () => {
    const unknown = item(1000); unknown.geometry = { ...geometry, bounds: undefined };
    const invalid = item(2000); invalid.bounds.min[0] = NaN;
    const { selection } = select([unknown, invalid, item(5000)]);
    expect(ranges(selection)).toEqual([0, 2]);
  });

  it('preserves geometry transformed by nonuniform/negative scale and rotation', () => {
    const moving = item(2);
    moving.transform.scale = [-20, 0.5, 4]; moving.transform.rotation = [0.3, 0.2, 0.4];
    moving.bounds = transformBounds(geometry.bounds, moving.transform);
    expect(select([moving]).selection.instanceCount).toBe(1);
  });

  it('bypasses selection in raw mode and handles an empty batch', () => {
    const { batch, selection, frustum, cache } = select([item(10)]);
    selection.select(frustum, undefined, 1); expect(ranges(selection)).toEqual([0, 1]);
    expect(cache.read([item(10)], false)[0].visibility).toBeUndefined();
    selection.select(frustum, batch.visibility, 0); expect(selection.rangeCount).toBe(0);
  });

  it('bounds fragmented draw calls with a conservative whole-batch fallback', () => {
    const items = Array.from({ length: 8192 }, (_, i) => item(Math.floor(i / 32) % 2 ? 10 : 0, `${i}`));
    const { selection } = select(items, false);
    expect(selection.fallback).toBe(true); expect(selection.rangeCount).toBeLessThanOrEqual(MAX_VISIBILITY_RANGES);
    expect(selection.instanceCount).toBe(items.length);
  });

  it('spatially groups large opaque batches only at structural compilation', () => {
    const items = Array.from({ length: 4096 }, (_, i) => item(i % 2 ? 10000 + i : i / 4096, `${i}`));
    const { batch, selection } = select(items);
    expect(batch.instanceIds).not.toEqual(items.map(item => item.id));
    expect(selection.instanceCount).toBe(2048); expect(selection.rangeCount).toBe(1);
    expect(items[0].id).toBe('0'); expect(items[1].id).toBe('1');
  });

  it('never rejects a potentially visible instance across oblique camera views', () => {
    const items = Array.from({ length: 10000 }, (_, i) => {
      const value = item(0, `${i}`);
      value.transform.position = [(i * 37 % 201) - 100, (i * 11 % 31) - 15, (i * 67 % 201) - 100];
      value.transform.rotation = [i % 3, i % 5, i % 7];
      value.transform.scale = [1 + i % 8, -(1 + i % 4), 0.2 + i % 3];
      value.bounds = transformBounds(geometry.bounds, value.transform);
      return value;
    });
    const { batch, selection, frustum } = select(items);
    const bounds = batch.visibility!;
    for (let view = 0; view < 8; view++) {
      frustum.setMatrix(createViewProjectionMatrix(0.5 + view / 4, { projection: 'perspective',
        position: [Math.cos(view) * 40, 20, Math.sin(view) * 40], target: [0, 0, 0], fov: 45, near: 1, far: 150 }));
      selection.select(frustum, bounds, batch.instanceCount);
      const submitted = new Uint8Array(batch.instanceCount);
      for (let r = 0; r < selection.rangeCount * 2; r += 2) submitted.fill(1, selection.ranges[r], selection.ranges[r] + selection.ranges[r + 1]);
      for (let i = 0; i < batch.instanceCount; i++) {
        if (frustum.classify(bounds.items, i * 6) !== -1) expect(submitted[i]).toBe(1);
      }
    }
  });

  it.each([{ transparent: true }, { blendMode: 'alpha' as const }, { depthWrite: false }, { depthTest: false }])(
    'preserves authored instance order for order-dependent materials %j', override => {
      const items = Array.from({ length: 4096 }, (_, i) => ({ ...item(4096 - i), material: { ...material, ...override } }));
      expect(spatiallyOrderInstances(items)).toBe(items);
      expect(createDrawBatchCache().read(items, true, false)[0].instanceIds).toEqual(items.map(item => item.id));
    });
});
