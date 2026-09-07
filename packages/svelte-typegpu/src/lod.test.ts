import { describe, expect, it } from 'vitest';
import { createBoxGeometryData, createSphereGeometryData } from './geometries';
import { createGeometryLod, createModelLod } from './lod';
import { createMaterialDescriptor } from './material-descriptors';
import type { TypeGpuLoadedModel } from './types';

const high = createSphereGeometryData(1, 32, 16), low = createBoxGeometryData(1, 1, 1);
const levels = [{ maxScreenHeight: 40, geometry: low }];
const model = (geometry = high): TypeGpuLoadedModel => ({ key: geometry.key, meshes: [{ name: 'part', geometry,
  material: createMaterialDescriptor('standard'), transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }] });

describe('authored LOD assets', () => {
  it('shares geometry data, retains base materials, and makes a distinct family identity', () => {
    const source = model(), result = createModelLod(source, [{ maxScreenHeight: 40, asset: model(low) }]);
    expect(result).not.toBe(source); expect(result.meshes[0].geometry.vertexData).toBe(high.vertexData);
    expect(result.meshes[0].material).toBe(source.meshes[0].material);
    expect(result.meshes[0].geometry.lod?.levels[0].geometry).toBe(low);
    expect(result.meshes[0].geometry.key).not.toBe(high.key); expect(source.meshes[0].geometry.lod).toBeUndefined();
    expect(createGeometryLod(high, levels).key).toBe(createGeometryLod(high, levels).key);
    expect(createGeometryLod(high, levels, 0.2).key).not.toBe(createGeometryLod(high, levels).key);
  });
  it('unions every level bound without mutating inputs', () => {
    const wider = createBoxGeometryData(8, 1, 1), result = createGeometryLod(high, [{ maxScreenHeight: 40, geometry: wider }]);
    expect(result.bounds).toEqual({ min: [-4, -1, -1], max: [4, 1, 1] });
    expect(high.bounds?.max[0]).toBe(1);
  });
  it('returns the original for no alternatives', () => {
    expect(createGeometryLod(high, [])).toBe(high); const source = model(); expect(createModelLod(source, [])).toBe(source);
  });
  it('snapshots and freezes selection policy without freezing shared geometry', () => {
    const input = [{ ...levels[0] }], result = createGeometryLod(high, input);
    input[0].maxScreenHeight = 100;
    expect(result.lod!.levels[0].maxScreenHeight).toBe(40);
    expect(Object.isFrozen(result.lod)).toBe(true); expect(Object.isFrozen(result.lod!.levels)).toBe(true);
    expect(Object.isFrozen(result.lod!.levels[0])).toBe(true); expect(Object.isFrozen(low)).toBe(false);
  });
  it('rejects empty or incomplete levels rather than disappearing at a threshold', () => {
    for (const vertexCount of [0, 1, 2, NaN, Infinity]) {
      expect(() => createGeometryLod(high, [{ ...levels[0], geometry: { ...low, vertexCount } }])).toThrow(/triangles/);
    }
  });
  it.each([0, -1, Infinity, NaN])('rejects invalid screen height %s', maxScreenHeight => {
    expect(() => createGeometryLod(high, [{ maxScreenHeight, geometry: low }])).toThrow(/screen heights/);
  });
  it.each([-0.1, 1, Infinity, NaN])('rejects invalid hysteresis %s', value => {
    expect(() => createGeometryLod(high, levels, value)).toThrow(/hysteresis/);
  });
  it('rejects unordered or unbounded level lists', () => {
    expect(() => createGeometryLod(high, [...levels, ...levels])).toThrow(/descending/);
    expect(() => createGeometryLod(high, Array(4).fill(levels[0]))).toThrow(/at most four/);
  });
  it('rejects nested, incompatible, denser and unbounded geometry', () => {
    expect(() => createGeometryLod(createGeometryLod(high, levels), levels)).toThrow(/nested/);
    expect(() => createGeometryLod(high, [{ ...levels[0], geometry: { ...low, vertexFloats: 8 } }])).toThrow(/layout/);
    expect(() => createGeometryLod(high, [{ ...levels[0], geometry: { ...low, hasVertexAlpha: true } }])).toThrow(/alpha/);
    expect(() => createGeometryLod(low, [{ ...levels[0], geometry: high }])).toThrow(/increase/);
    expect(() => createGeometryLod(high, [{ ...levels[0], geometry: { ...low, bounds: undefined } }])).toThrow(/bounds/);
  });
  it('rejects mesh-count, name/order and transform mismatches', () => {
    expect(() => createModelLod(model(), [{ maxScreenHeight: 40, asset: { key: 'empty', meshes: [] } }])).toThrow(/counts/);
    const asset = model(low); asset.meshes[0].name = 'different';
    expect(() => createModelLod(model(), [{ maxScreenHeight: 40, asset }])).toThrow(/names/);
    asset.meshes[0].name = 'part'; asset.meshes[0].transform.position[0] = 1;
    expect(() => createModelLod(model(), [{ maxScreenHeight: 40, asset }])).toThrow(/transforms/);
  });
});
