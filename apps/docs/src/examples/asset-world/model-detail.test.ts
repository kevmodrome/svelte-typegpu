import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { loadGlbModel } from '../../../../../packages/svelte-typegpu/src/glb-loader';
import type { TypeGpuGeometryData } from 'svelte-typegpu';
import { assetFiles, type WorldAssets } from './world';
import { detailWorldAssets, refineGeometry } from './model-detail';

const assets = Object.fromEntries(Object.entries(assetFiles).map(([key, name]) => {
  const bytes = readFileSync(new URL(`../../../public/assets/asset-world/${name}`, import.meta.url));
  return [key, loadGlbModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name)];
})) as WorldAssets;

describe('shared model triangle density', () => {
  it.each([1, 2])('multiplies every bundled mesh by 4^%s without changing its bounds or materials', level => {
    const detailed = detailWorldAssets(assets, level);
    expect(detailWorldAssets(assets, level)).toBe(detailed);
    expect(detailWorldAssets(assets, 0)).toBe(assets);
    for (const key of Object.keys(assets) as (keyof WorldAssets)[]) {
      for (const [index, mesh] of detailed[key].meshes.entries()) {
        const original = assets[key].meshes[index];
        expect(mesh.material).toBe(original.material);
        expect(mesh.transform).toBe(original.transform);
        expect(mesh.geometry.bounds).toBe(original.geometry.bounds);
        expect(mesh.geometry.vertexCount).toBe((original.geometry.indexCount ?? original.geometry.vertexCount) * 4 ** level);
        expect(mesh.geometry.key).not.toBe(original.geometry.key);
        expect(mesh.geometry.indexData).toBeUndefined();
        expect(mesh.geometry.vertexData.every(Number.isFinite)).toBe(true);
        for (let vertex = 0; vertex < mesh.geometry.vertexCount; vertex++) {
          for (let axis = 0; axis < 3; axis++) {
            const value = mesh.geometry.vertexData[vertex * 12 + axis];
            expect(value).toBeGreaterThanOrEqual(original.geometry.bounds!.min[axis] - 1e-6);
            expect(value).toBeLessThanOrEqual(original.geometry.bounds!.max[axis] + 1e-6);
          }
        }
      }
    }
  });
  it('interpolates UV, RGB and alpha while preserving winding and source data', () => {
    const source: TypeGpuGeometryData = { key: 'triangle', vertexCount: 3, vertexFloats: 12,
      indexData: new Uint16Array([0, 1, 2]), indexCount: 3,
      vertexData: new Float32Array([
        0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0,
        2, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1,
        0, 2, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1
      ]) };
    const before = source.vertexData.slice(), refined = refineGeometry(source, 1);
    expect(refined.vertexCount).toBe(12);
    let midpoint = false;
    for (let v = 0; v < refined.vertexCount; v++) {
      const values = refined.vertexData.subarray(v * 12, (v + 1) * 12);
      if (values[0] === 1 && values[1] === 0) {
        expect([...values]).toEqual([1, 0, 0, 0, 0, 1, 0.5, 0, 0.5, 0.5, 0, 0.5]); midpoint = true;
      }
    }
    for (let v = 0; v < refined.vertexCount; v += 3) {
      const a = refined.vertexData.subarray(v * 12), b = a.subarray(12), c = a.subarray(24);
      expect((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])).toBeGreaterThan(0);
    }
    expect(midpoint).toBe(true); expect(source.vertexData).toEqual(before);
    expect([...source.indexData!]).toEqual([0, 1, 2]);
    expect(() => refineGeometry(source, 3)).toThrow(RangeError);
    expect(() => refineGeometry({ ...source, vertexFloats: 8 }, 1)).toThrow('layout');
  });
});
