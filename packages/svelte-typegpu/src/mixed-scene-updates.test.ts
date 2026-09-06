import { afterEach, describe, expect, it, vi } from 'vitest';
import { addEventListener, createElement, insert, setAttribute } from './core';
import { Dirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import * as resources from './resources';
import * as transforms from './transform';

afterEach(() => vi.restoreAllMocks());

function fixture(count = 1000) {
  const root = createElement('scene'), camera = createElement('perspectiveCamera');
  setAttribute(camera, 'position', [0, 0, 10]); insert(root, camera, null);
  const meshes = Array.from({ length: count }, () => {
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null); insert(mesh, createElement('standardMaterial'), null);
    insert(root, mesh, null); return mesh;
  });
  addEventListener(meshes[0], 'click', () => {});
  const cache = createTypeGpuSceneCache(), initial = createSceneState(root, cache);
  return { root, camera, meshes, cache, initial };
}

describe('mixed incremental scene updates', () => {
  it.each([false, true])('keeps camera + transform + material changes local (interaction: %s)', interaction => {
    const { root, camera, meshes, cache, initial } = fixture();
    const geometry = vi.spyOn(resources, 'readInlineGeometry'), transform = vi.spyOn(transforms, 'readLocalTransform');
    const regroup = vi.spyOn(cache.drawBatchCache, 'read'), reset = vi.spyOn(cache.transforms, 'reset');
    setAttribute(camera, 'fov', 60);
    setAttribute(meshes[0], 'position', [2, 0, 0]);
    setAttribute(meshes[700].lastChild!, 'color', [0, 1, 0, 1]);
    if (interaction) addEventListener(meshes[1], 'click', () => {});
    const nodes = new Map([
      [camera, Dirty.Camera], [meshes[0], Dirty.Transform],
      [meshes[700].lastChild!, Dirty.MaterialUniform]
    ]);
    if (interaction) nodes.set(meshes[1], Dirty.Interaction);
    const next = createSceneState(root, cache, {
      dirty: Dirty.Camera | Dirty.Transform | Dirty.MaterialUniform | (interaction ? Dirty.Interaction : Dirty.None),
      dirtyNodes: nodes
    });
    expect(next.camera.fov).toBe(60);
    expect(transform.mock.calls.length).toBe(1);
    expect(transform.mock.calls[0][0] === meshes[0]).toBe(true);
    expect(geometry.mock.calls.length).toBe(0); expect(regroup.mock.calls.length).toBe(0); expect(reset.mock.calls.length).toBe(0);
    expect(next.drawBatchesChanged).toBe(false);
    expect(next.drawBatches[0].instances).toBe(initial.drawBatches[0].instances);
    expect(next.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 1 }, { start: 700, count: 1 }]);
    expect(next.interaction.targets).toHaveLength(interaction ? 2 : 1);
    expect(next.interaction.targets[0].bounds.min[0]).toBe(1.5);
    expect(cache.transforms.stats).toEqual({ transformsUpdated: 1, itemsUpdated: 1 });
    expect(Array.from(next.drawBatches[0].instances)).toEqual(Array.from(createSceneState(root).drawBatches[0].instances));
  });

  it('preflights alpha transitions before falling back for a mixed update', () => {
    const { root, camera, meshes, cache } = fixture(3);
    const material = meshes[1].lastChild!, update = vi.spyOn(cache.transforms, 'update');
    setAttribute(camera, 'fov', 60); setAttribute(meshes[0], 'position', [3, 0, 0]);
    setAttribute(material, 'opacity', 0.5);
    const next = createSceneState(root, cache, {
      dirty: Dirty.Camera | Dirty.Transform | Dirty.MaterialUniform,
      dirtyNodes: new Map([[camera, Dirty.Camera], [meshes[0], Dirty.Transform], [material, Dirty.MaterialUniform]])
    });
    expect(update).not.toHaveBeenCalled(); expect(next.drawBatchesChanged).toBe(true);
    expect(next.camera.fov).toBe(60);
    expect(next.drawBatches.map(batch => Array.from(batch.instances))).toEqual(
      createSceneState(root).drawBatches.map(batch => Array.from(batch.instances))
    );
  });
});
