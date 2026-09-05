import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, insert, setAttribute } from './core';
import { Dirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import * as resources from './resources';
import * as transforms from './transform';

afterEach(() => vi.restoreAllMocks());

describe('incremental material values', () => {
  function fixture(count = 3) {
    const root = createElement('scene');
    const meshes = Array.from({ length: count }, () => {
      const mesh = createElement('mesh');
      insert(mesh, createElement('boxGeometry'), null);
      insert(mesh, createElement('standardMaterial'), null);
      insert(root, mesh, null);
      return mesh;
    });
    const cache = createTypeGpuSceneCache();
    const first = createSceneState(root, cache);
    return { root, meshes, cache, first };
  }

  it('updates one material without a tree walk or geometry/transform work', () => {
    const { root, meshes, cache, first } = fixture(2000);
    const material = meshes[400].lastChild!;
    setAttribute(material, 'color', [0, 1, 0, 1]);
    setAttribute(material, 'roughness', 0.8);
    const geometry = vi.spyOn(resources, 'readInlineGeometry');
    const transform = vi.spyOn(transforms, 'readLocalTransform');
    const regroup = vi.spyOn(cache.drawBatchCache, 'read');
    const state = createSceneState(root, cache, {
      dirty: Dirty.MaterialUniform,
      dirtyNodes: new Map([[material, Dirty.MaterialUniform]])
    });
    expect(state.drawBatchesChanged).toBe(false);
    expect(state.drawBatches[0].instances).toBe(first.drawBatches[0].instances);
    expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 400, count: 1 }]);
    expect(geometry).not.toHaveBeenCalled();
    expect(transform).not.toHaveBeenCalled();
    expect(regroup).not.toHaveBeenCalled();
    expect(Array.from(state.drawBatches[0].instances)).toEqual(
      Array.from(createSceneState(root).drawBatches[0].instances)
    );
  }, 30_000);

  it('preflights all values before falling back for opacity and shadow transitions', () => {
    const { root, meshes, cache } = fixture();
    setAttribute(meshes[1], 'castShadow', true);
    createSceneState(root, cache);
    const [a, b] = [meshes[0].lastChild!, meshes[1].lastChild!];
    setAttribute(a, 'color', [1, 0, 0, 1]);
    setAttribute(b, 'opacity', 0.5);
    const result = createSceneState(root, cache, {
      dirty: Dirty.MaterialUniform,
      dirtyNodes: new Map([
        [a, Dirty.MaterialUniform],
        [b, Dirty.MaterialUniform]
      ])
    });
    expect(result.drawBatchesChanged).toBe(true);
    expect(result.resourceItems![1].castShadow).toBe(false);
    expect(result.drawBatches.map((b) => Array.from(b.instances))).toEqual(
      createSceneState(root).drawBatches.map((b) => Array.from(b.instances))
    );
    setAttribute(b, 'opacity', 0.6);
    const next = createSceneState(root, cache, {
      dirty: Dirty.MaterialUniform,
      dirtyNodes: new Map([[b, Dirty.MaterialUniform]])
    });
    expect(next.drawBatchesChanged).toBe(false);
  });

  it('updates hidden material values and same-node motion/color without changing other instances', () => {
    const { root, meshes, cache } = fixture();
    setAttribute(meshes[0], 'visible', false);
    createSceneState(root, cache);
    setAttribute(meshes[0].lastChild!, 'color', [0, 0, 1, 1]);
    const hidden = createSceneState(root, cache, {
      dirty: Dirty.MaterialUniform,
      dirtyNodes: new Map([[meshes[0].lastChild!, Dirty.MaterialUniform]])
    });
    expect(hidden.instanceUpdates).toEqual([]);
    setAttribute(meshes[0], 'visible', true);
    createSceneState(root, cache);
    setAttribute(meshes[0], 'color', [0, 1, 0, 1]);
    setAttribute(meshes[0], 'position', [2, 0, 0]);
    const mask = Dirty.MaterialUniform | Dirty.Transform | Dirty.Lights;
    const next = createSceneState(root, cache, {
      dirty: mask,
      dirtyNodes: new Map([[meshes[0], mask]])
    });
    expect(next.drawBatchesChanged).toBe(false);
    expect(next.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);
    expect(Array.from(next.drawBatches[0].instances.slice(0, 8))).toEqual([2, 0, 0, 0, 0, 1, 0, 1]);
  });
});
