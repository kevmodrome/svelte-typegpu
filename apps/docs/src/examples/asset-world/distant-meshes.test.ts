import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { loadGlbModel } from '../../../../../packages/svelte-typegpu/src/glb-loader';
import { assetFiles, type WorldAssets } from './world';
import { prepareDistantWorldAssets } from './distant-meshes';

const assets = Object.fromEntries(Object.entries(assetFiles).map(([key, name]) => {
  const bytes = readFileSync(new URL(`../../../public/assets/asset-world/${name}`, import.meta.url));
  return [key, loadGlbModel(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), name)];
})) as WorldAssets;

describe('shared distant landscape representations', () => {
  it('evicts a failed preparation so the same source can be retried', async () => {
    const { MeshoptSimplifier } = await import('meshoptimizer/simplifier');
    const source = { ...assets };
    const simplify = vi.spyOn(MeshoptSimplifier, 'simplifyWithAttributes').mockImplementationOnce(() => { throw new Error('failed'); });
    try {
      const failed = prepareDistantWorldAssets(source);
      await expect(failed).rejects.toThrow('failed');
      const retry = prepareDistantWorldAssets(source);
      expect(retry).not.toBe(failed);
      expect((await retry).pine).not.toBe(source.pine);
    } finally { simplify.mockRestore(); }
  });
  it('deduplicates in-flight preparation and retains non-landscape assets', async () => {
    const pending = prepareDistantWorldAssets(assets);
    expect(prepareDistantWorldAssets(assets)).toBe(pending);
    const result = await pending;
    expect(await prepareDistantWorldAssets(assets)).toBe(result);
    for (const name of ['tent', 'canoe', 'firepit', 'sign', 'bridge'] as const) expect(result[name]).toBe(assets[name]);
  });

  it('reduces actual GLBs with compact indices, intact attributes and conservative bounds', async () => {
    const snapshots = Object.values(assets).flatMap(asset => asset.meshes.map(mesh => mesh.geometry.vertexData.slice()));
    const result = await prepareDistantWorldAssets(assets);
    for (const name of ['pine', 'oak', 'rock', 'log'] as const) {
      let originalTriangles = 0, distantTriangles = 0;
      expect(result[name].meshes.length).toBe(assets[name].meshes.length);
      result[name].meshes.forEach((mesh, index) => {
        const original = assets[name].meshes[index], geometry = mesh.geometry;
        expect(mesh.name).toBe(original.name); expect(mesh.transform).toBe(original.transform);
        expect(mesh.material).toBe(original.material); expect(geometry.bounds).toBe(original.geometry.bounds);
        originalTriangles += (original.geometry.indexCount ?? original.geometry.vertexCount) / 3;
        distantTriangles += (geometry.indexCount ?? geometry.vertexCount) / 3;
        expect(geometry.vertexData.every(Number.isFinite)).toBe(true);
        expect(geometry.vertexData.length).toBe(geometry.vertexCount * 12);
        if (geometry !== original.geometry) {
          expect(geometry.indexCount! % 3).toBe(0);
          expect(geometry.indexCount).toBeGreaterThan(0);
          expect(new Set(geometry.indexData!).size).toBe(geometry.vertexCount);
          expect(Math.max(...geometry.indexData!)).toBe(geometry.vertexCount - 1);
          expect(geometry.vertexData.byteLength).toBeLessThan(original.geometry.vertexData.byteLength);
        }
        const originalVertices = new Set(Array.from({ length: original.geometry.vertexCount }, (_, i) =>
          [...original.geometry.vertexData.subarray(i * 12, i * 12 + 12)].join(',')));
        for (let i = 0; i < geometry.vertexCount; i++) {
          const vertex = geometry.vertexData.subarray(i * 12, i * 12 + 12);
          expect(originalVertices.has([...vertex].join(','))).toBe(true);
          for (let axis = 0; axis < 3; axis++) {
            expect(vertex[axis]).toBeGreaterThanOrEqual(geometry.bounds!.min[axis]);
            expect(vertex[axis]).toBeLessThanOrEqual(geometry.bounds!.max[axis]);
          }
        }
      });
      expect(distantTriangles).toBeLessThan(originalTriangles * 0.65);
    }
    expect(Object.values(assets).flatMap(asset => asset.meshes.map(mesh => mesh.geometry.vertexData))).toEqual(snapshots);
  });

  it.each(['texture', 'alpha', 'transparent', 'layout'] as const)('retains unsupported %s geometry', async kind => {
    const source = { ...assets, pine: { ...assets.pine, meshes: assets.pine.meshes.map(mesh => ({ ...mesh,
      geometry: { ...mesh.geometry, ...(kind === 'alpha' ? { hasVertexAlpha: true } : {}),
        ...(kind === 'layout' ? { vertexFloats: 8 } : {}) },
      material: { ...mesh.material, ...(kind === 'texture' ? { map: { kind: 'url' as const, src: '/test.png' } } : {}),
        ...(kind === 'transparent' ? { transparent: true } : {}) }
    })) } };
    const result = await prepareDistantWorldAssets(source);
    result.pine.meshes.forEach((mesh, index) => expect(mesh.geometry).toBe(source.pine.meshes[index].geometry));
  });
});
