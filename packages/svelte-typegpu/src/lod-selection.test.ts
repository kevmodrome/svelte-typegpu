import { describe, expect, it } from 'vitest';
import { BatchBounds, VisibilitySelection } from './batch-visibility';
import { LodSelection, chooseLevel, projectedHeight } from './lod-selection';
import { Frustum } from './frustum';
import { createViewProjectionMatrix } from './camera-math';
import { createBoxGeometryData } from './geometries';
import { createGeometryLod } from './lod';
import { createDrawBatchCache } from './draw-batch-cache';
import { createElement } from './core';
import { createMaterialDescriptor } from './material-descriptors';
import { transformBounds } from './bounds';
import { growInstanceCapacity } from './instance-data';
import type { TypeGpuCameraSettings, TypeGpuMeshDrawItem, TypeGpuPerspectiveCameraSettings } from './types';

const low = createBoxGeometryData(1, 1, 1);
const geometry = createGeometryLod({ ...low, key: 'high', vertexCount: 360 }, [{ geometry: low, maxScreenHeight: 40 }]);
const material = createMaterialDescriptor('standard');
function item(z: number, id: number, scale = 1): TypeGpuMeshDrawItem {
  const transform = { position: [0, 0, z] as [number, number, number], rotation: [0, 0, 0] as [number, number, number],
    scale: [scale, scale, scale] as [number, number, number] };
  return { id, node: createElement('model'), revision: 1, geometry, material, transform,
    bounds: transformBounds(geometry.bounds!, transform), color: [1, 1, 1, 1], renderOrder: 0,
    hitTest: 'bounds', pointerEvents: 'auto', castShadow: true, receiveShadow: true };
}
function camera(z = 10): TypeGpuPerspectiveCameraSettings {
  return { projection: 'perspective', position: [0, 0, z], target: [0, 0, 0], fov: 60, near: 0.1, far: 10000 };
}
function setup(items: TypeGpuMeshDrawItem[]) {
  const bounds = new BatchBounds(growInstanceCapacity(items.length)); bounds.rebuild(items);
  const visible = new VisibilitySelection(), frustum = new Frustum(), selection = new LodSelection(bounds.leafBase, geometry.lod!);
  function select(view: TypeGpuCameraSettings = camera(), height = 400) {
    const matrix = createViewProjectionMatrix(1, view); frustum.setMatrix(matrix);
    visible.select(frustum, bounds, items.length); selection.select(matrix, frustum.revision, height, bounds, visible);
  }
  select(); return { bounds, visible, selection, select };
}

describe('retained LOD selection', () => {
  it('chooses levels in canonical order with no overlaps or missing instances', () => {
    const { selection, visible } = setup([item(0, 0), item(-100, 1), item(-100, 2), item(0, 3)]);
    expect(visible.instanceCount).toBe(4); expect(selection.rangeCount).toBe(3);
    expect([...selection.ranges.slice(0, 6)]).toEqual([0, 1, 1, 2, 3, 1]);
    expect([...selection.levels.slice(0, 3)]).toEqual([0, 1, 0]);
  });
  it('uses hysteresis without delaying refinement', () => {
    const policy = geometry.lod!;
    expect(chooseLevel(38, 0, policy)).toBe(0); expect(chooseLevel(35, 0, policy)).toBe(1);
    expect(chooseLevel(38, 1, policy)).toBe(1); expect(chooseLevel(41, 1, policy)).toBe(0);
    expect(chooseLevel(Infinity, 1, policy)).toBe(0);
  });
  it('caches unchanged views and invalidates on canvas size and sparse bound changes', () => {
    const items = [item(-100, 0)], { selection, bounds, select } = setup(items);
    const storage = selection.ranges; select(); expect(selection.tests).toBe(0);
    select(camera(), 4000); expect(selection.levels[0]).toBe(0); expect(selection.tests).toBe(1);
    items[0] = item(0, 0); bounds.update(0, items[0]); select();
    expect(selection.levels[0]).toBe(0); expect(selection.ranges).toBe(storage);
  });
  it('responds to field of view, scale and orthographic zoom, not orthographic distance', () => {
    const { selection, select } = setup([item(-100, 0)]);
    expect(selection.levels[0]).toBe(1);
    select({ ...camera(), fov: 2 }); expect(selection.levels[0]).toBe(0);
    expect(setup([item(-100, 0, 20)]).selection.levels[0]).toBe(0);
    const ortho: TypeGpuCameraSettings = { projection: 'orthographic', position: [0, 0, 10], target: [0, 0, 0], zoom: 0.1, near: 0.1, far: 10000 };
    select(ortho); expect(selection.levels[0]).toBe(1);
    select({ ...ortho, position: [0, 0, 1000] }); expect(selection.levels[0]).toBe(1);
    select({ ...ortho, zoom: 5 }); expect(selection.levels[0]).toBe(0);
  });
  it('uses individual radius rather than cluster diameter and refits maximum radius', () => {
    const items = Array.from({ length: 512 }, (_, i) => item(-100 - i * 10, i));
    const { bounds, selection } = setup(items);
    expect(bounds.radii[1]).toBeCloseTo(Math.sqrt(3) / 2); expect(selection.levels[0]).toBe(1);
    const original = bounds.nodes.slice(); items[12] = item(-220, 12, 8); bounds.update(12, items[12]);
    expect(bounds.radii[1]).toBeCloseTo(Math.sqrt(3) * 4); expect(bounds.lastRefitNodes).toBeLessThan(10);
    expect(bounds.nodes).not.toEqual(original);
  });
  it('retains unknown bounds and near-plane intersections at high detail', () => {
    const unknown = item(-100, 0); unknown.geometry = { ...geometry, bounds: undefined };
    expect(setup([unknown]).selection.levels[0]).toBe(0);
    expect(setup([item(10, 0)]).selection.levels[0]).toBe(0);
  });
  it('falls back to high-detail visibility ranges when LOD is fragmented', () => {
    const items = Array.from({ length: 8192 }, (_, i) => item(Math.floor(i / 32) % 2 ? -100 : 0, i));
    const { selection, visible } = setup(items);
    expect(selection.fallback).toBe(true); expect(selection.rangeCount).toBe(visible.rangeCount);
    expect(selection.ranges[1]).toBe(8192); expect(selection.levels[0]).toBe(0);
  });
  it('maintains bounds for LOD even with frustum culling disabled', () => {
    const batch = createDrawBatchCache().read([item(-100, 0)], false)[0]; expect(batch.visibility).toBeDefined();
  });
  it('allows a bounded larger shadow range budget without changing color history or storage', () => {
    const items = Array.from({ length: 8192 }, (_, i) => item(Math.floor(i / 32) % 2 ? -100 : 0, i));
    const { selection: color, visible, bounds } = setup(items);
    const shadow = new LodSelection(bounds.leafBase, geometry.lod!, 384), storage = shadow.ranges;
    const matrix = createViewProjectionMatrix(1, camera());
    shadow.select(matrix, 1, 400, bounds, visible);
    expect(color.fallback).toBe(true); expect(shadow.fallback).toBe(false); expect(shadow.rangeCount).toBe(256);
    expect([...shadow.ranges.slice(0, shadow.rangeCount * 2)].filter((_, i) => i % 2).reduce((a, b) => a + b, 0)).toBe(8192);
    shadow.select(matrix, 1, 400, bounds, visible);
    expect(shadow.tests).toBe(0); expect(shadow.ranges).toBe(storage);
    expect(() => new LodSelection(1, geometry.lod!, 8)).toThrow(RangeError);
  });
  it('uses finer LOD groups without changing frustum instance membership', () => {
    const items = Array.from({ length: 8192 }, (_, i) => item(Math.floor(i / 4) % 2 ? -100 : 0, i));
    const coarse = new BatchBounds(8192), fine = new BatchBounds(8192, true);
    coarse.rebuild(items); fine.rebuild(items);
    expect(fine.leafSize).toBe(4); expect(fine.cullLeafSize).toBe(32);
    const matrix = createViewProjectionMatrix(1, camera()), frustum = new Frustum(); frustum.setMatrix(matrix);
    const a = new VisibilitySelection(), b = new VisibilitySelection();
    a.select(frustum, coarse, 8192); b.select(frustum, fine, 8192);
    expect(a.ranges).toEqual(b.ranges); expect(a.instanceCount).toBe(b.instanceCount);
    expect(projectedHeight(matrix, 400, fine, fine.leafBase + 1)).toBeLessThan(40);
    expect(projectedHeight(matrix, 400, coarse, coarse.leafBase)).toBeGreaterThan(40);
  });
  it('bounds projected corner heights under oblique perspective and orthographic views', () => {
    let seed = 17; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 2 ** 32; };
    for (const projection of ['perspective', 'orthographic'] as const) {
      const view: TypeGpuCameraSettings = projection === 'perspective'
        ? { ...camera(), position: [20, 13, 35] }
        : { projection, position: [20, 13, 35], target: [0, 0, 0], zoom: 0.1, near: 0.1, far: 10000 };
      const matrix = createViewProjectionMatrix(1.6, view);
      for (let sample = 0; sample < 1000; sample++) {
        const value = item(-random() * 40, sample, 0.1 + random() * 3);
        value.transform.position[0] = random() * 40 - 20; value.transform.position[1] = random() * 20 - 10;
        value.bounds = transformBounds(geometry.bounds!, value.transform);
        const bounds = new BatchBounds(1); bounds.rebuild([value]);
        let min = Infinity, max = -Infinity;
        for (let corner = 0; corner < 8; corner++) {
          const p = [0, 1, 2].map(axis => value.bounds[corner & 1 << axis ? 'max' : 'min'][axis]);
          const y = matrix[1] * p[0] + matrix[5] * p[1] + matrix[9] * p[2] + matrix[13];
          const w = matrix[3] * p[0] + matrix[7] * p[1] + matrix[11] * p[2] + matrix[15];
          min = Math.min(min, y / w); max = Math.max(max, y / w);
        }
        expect(projectedHeight(matrix, 400, bounds, 1) + 0.0001).toBeGreaterThanOrEqual((max - min) * 200);
      }
    }
  });
});
