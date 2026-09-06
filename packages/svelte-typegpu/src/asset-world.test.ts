import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGlbModel, parseGlbContainer } from './glb-loader';
import { assetFiles, assetCount, loadWorldAssets, landmarks, trees, details } from '../../../apps/docs/src/examples/asset-world/world';

function file(name: string): ArrayBuffer {
  const bytes = readFileSync(new URL(`../../../apps/docs/public/assets/asset-world/${name}`, import.meta.url));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('bundled asset world', () => {
  it('imports every GLB primitive within a small local asset budget', () => {
    let bytes = 0;
    for (const name of Object.values(assetFiles)) {
      const data = file(name); bytes += data.byteLength;
      const model = loadGlbModel(data, name), source = parseGlbContainer(data).json;
      expect(model.meshes.length, name).toBe(source.meshes!.reduce((n, mesh) => n + mesh.primitives!.length, 0));
      expect(model.meshes.length).toBeGreaterThan(0);
      for (const mesh of model.meshes) {
        expect(mesh.geometry.vertexCount).toBeGreaterThan(0);
        expect([...mesh.geometry.bounds!.min, ...mesh.geometry.bounds!.max].every(Number.isFinite)).toBe(true);
        expect(mesh.material.texture).toBeNull();
      }
    }
    expect(bytes).toBeLessThan(150_000);
    const items = [...landmarks, ...trees, ...details];
    expect(new Set(items.map(item => item.key)).size).toBe(items.length);
    expect(items.every(item => item.asset in assetFiles)).toBe(true);
  });

  it('loads once per asset, reports progress, and returns shared immutable inputs', async () => {
    const fetcher = vi.fn(async (url: string) => new Response(file(url.split('/').at(-1)!)));
    vi.stubGlobal('fetch', fetcher);
    const controller = new AbortController(), progress = vi.fn();
    const assets = await loadWorldAssets(controller.signal, progress);
    expect(Object.keys(assets)).toHaveLength(assetCount);
    expect(fetcher).toHaveBeenCalledTimes(assetCount);
    expect(progress.mock.calls.map(([count]) => count)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    for (const [, options] of fetcher.mock.calls as unknown as [string, RequestInit][]) {
      expect(options.signal).toBe(controller.signal);
    }
    const pines = trees.filter(item => item.asset === 'pine').map(item => assets[item.asset]);
    expect(pines.every(asset => asset === assets.pine)).toBe(true);
  });

  it('reports HTTP failure and never reports progress for an aborted result', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
    const progress = vi.fn();
    await expect(loadWorldAssets(new AbortController().signal, progress)).rejects.toThrow('503');
    expect(progress).not.toHaveBeenCalled();
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      controller.abort();
      return new Response(file(url.split('/').at(-1)!));
    }));
    await expect(loadWorldAssets(controller.signal, progress)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalled();
  });
});
