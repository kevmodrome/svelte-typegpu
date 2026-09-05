import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addEventListener,
  createElement,
  insert,
  remove,
  setAttribute,
  type TypeGpuNode
} from './core';
import { Dirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import * as resources from './resources';
import * as transforms from './transform';
import { createModelCache } from './model-cache';
import type { TypeGpuLoadedModel } from './glb-loader';
import type { TypeGpuSceneState } from './types';

const MOTION = Dirty.Transform | Dirty.Lights;

afterEach(() => vi.restoreAllMocks());

function box(parent: TypeGpuNode, x = 0) {
  const mesh = createElement('mesh');
  setAttribute(mesh, 'position', [x, 0, 0]);
  insert(mesh, createElement('boxGeometry'), null);
  insert(mesh, createElement('standardMaterial'), null);
  insert(parent, mesh, null);
  return mesh;
}

function packed(scene: TypeGpuSceneState) {
  return scene.drawBatches.map((batch) => ({
    key: batch.key,
    ids: batch.instanceIds,
    data: Array.from(batch.instances)
  }));
}

describe('incremental scene transforms', () => {
  it('requires a completed full batch compilation before using cached transform records', () => {
    const root = createElement('scene');
    const mesh = box(root);
    const cache = createTypeGpuSceneCache();
    createSceneState(root, cache, { reuseDrawBatches: true });
    setAttribute(mesh, 'position', [3, 0, 0]);
    const state = createSceneState(root, cache, {
      dirty: MOTION,
      dirtyNodes: new Map([[mesh, MOTION]])
    });
    expect(state.drawBatchesChanged).toBe(true);
    expect(state.drawBatches[0].instances[0]).toBe(3);
  });
  it('does not mistake mixed transform and instance/picking edits for pure motion', () => {
    const root = createElement('scene');
    const mesh = box(root);
    addEventListener(mesh, 'click', () => {});
    const cache = createTypeGpuSceneCache();
    createSceneState(root, cache);
    setAttribute(mesh, 'receiveShadow', true);
    setAttribute(mesh, 'position', [1, 0, 0]);
    const mask = MOTION | Dirty.InstanceData;
    const shadow = createSceneState(root, cache, {
      dirty: mask,
      dirtyNodes: new Map([[mesh, mask]])
    });
    expect(shadow.drawBatchesChanged).toBe(true);
    expect(packed(shadow)).toEqual(packed(createSceneState(root)));
    setAttribute(mesh, 'pointerEvents', 'none');
    setAttribute(mesh, 'position', [2, 0, 0]);
    const interaction = MOTION | Dirty.Interaction;
    const hiddenPick = createSceneState(root, cache, {
      dirty: interaction,
      dirtyNodes: new Map([[mesh, interaction]])
    });
    expect(hiddenPick.interaction.targets).toHaveLength(0);
  });
  it('moves one leaf without reading static siblings, geometry, material, camera, or scene settings', () => {
    const root = createElement('scene');
    const meshes = Array.from({ length: 2000 }, (_, index) => box(root, index));
    addEventListener(meshes[0], 'click', () => {});
    const cache = createTypeGpuSceneCache();
    const initial = createSceneState(root, cache);
    const buffer = initial.drawBatches[0].instances;
    const target = initial.interaction.targets[0];
    const geometry = vi.spyOn(resources, 'readInlineGeometry');
    const material = vi.spyOn(resources, 'readInlineMaterial');
    const transform = vi.spyOn(transforms, 'readLocalTransform');
    const regroup = vi.spyOn(cache.drawBatchCache, 'read');
    const attributes = root.attributes;
    const sceneRead = vi.spyOn(root, 'attributes', 'get').mockReturnValue(attributes);
    setAttribute(meshes[0], 'position', [3, 0, 0]);
    const moved = createSceneState(root, cache, {
      dirty: MOTION,
      dirtyNodes: new Map([[meshes[0], MOTION]])
    });
    expect(geometry).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    expect(regroup).not.toHaveBeenCalled();
    expect(sceneRead).not.toHaveBeenCalled();
    expect(transform).toHaveBeenCalledExactlyOnceWith(meshes[0]);
    expect(cache.transforms.stats).toEqual({ transformsUpdated: 1, itemsUpdated: 1 });
    expect(moved.drawBatchesChanged).toBe(false);
    expect(moved.drawBatches[0].instances).toBe(buffer);
    expect(moved.instanceUpdates).toHaveLength(1);
    expect(moved.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);
    expect(moved.interaction).toBe(initial.interaction);
    expect(target.bounds.min[0]).toBe(2.5);
    expect(
      moved.interaction.pick({
        viewport: { width: 100, height: 100 },
        x: 50,
        y: 50,
        camera: { ...moved.camera, position: [3, 0, 10], target: [3, 0, 0] },
        type: 'click'
      })?.node
    ).toBe(meshes[0]);
    expect(packed(moved)).toEqual(packed(createSceneState(root)));
  });

  it('deduplicates parent and child updates, preserves static slots, and coalesces unordered ranges', () => {
    const root = createElement('scene');
    const group = createElement('group');
    insert(root, group, null);
    const a = box(group, 1);
    const b = box(group, 2);
    const staticMesh = box(root, 8);
    const cache = createTypeGpuSceneCache();
    createSceneState(root, cache);
    const read = vi.spyOn(transforms, 'readLocalTransform');
    setAttribute(a, 'scale', [2, 1, 3]);
    setAttribute(group, 'rotation', [0, Math.PI / 4, 0]);
    const dirtyNodes = new Map([
      [b, MOTION],
      [a, MOTION],
      [group, MOTION]
    ]);
    const moved = createSceneState(root, cache, { dirty: MOTION, dirtyNodes });
    expect(read.mock.calls.map(([node]) => node)).toEqual([group, a, b]);
    expect(read).not.toHaveBeenCalledWith(staticMesh);
    expect(moved.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 2 }]);
    expect(packed(moved)).toEqual(packed(createSceneState(root)));
    setAttribute(b, 'quaternion', [0, 0.70710678, 0, 0.70710678]);
    const next = createSceneState(root, cache, {
      dirty: MOTION,
      dirtyNodes: new Map([[b, MOTION]])
    });
    expect(next.instanceUpdates![0].dirtyRanges).toEqual([{ start: 1, count: 1 }]);
    expect(packed(next)).toEqual(packed(createSceneState(root)));
    const cameraOnly = createSceneState(root, cache, { dirty: Dirty.Camera });
    expect(cameraOnly.drawBatches.every((batch) => !batch.instancesChanged)).toBe(true);
  });

  it('falls back for structure, then resumes combined incremental motion and material values', () => {
    const root = createElement('scene');
    const group = createElement('group');
    const other = createElement('group');
    insert(root, group, null);
    insert(root, other, null);
    const mesh = box(group);
    const cache = createTypeGpuSceneCache();
    createSceneState(root, cache);
    const dirtyNodes = new Map([[mesh, MOTION]]);
    setAttribute(other, 'position', [10, 0, 0]);
    insert(other, mesh, null);
    const reparented = createSceneState(root, cache, { dirty: MOTION, dirtyNodes });
    expect(reparented.drawBatchesChanged).toBe(true);
    expect(reparented.drawBatches[0].instances[0]).toBe(10);
    setAttribute(mesh, 'position', [2, 0, 0]);
    const moved = createSceneState(root, cache, { dirty: MOTION, dirtyNodes });
    expect(moved.drawBatchesChanged).toBe(false);
    expect(moved.drawBatches[0].instances[0]).toBe(12);
    const material = mesh.lastChild!;
    setAttribute(material, 'color', [1, 0, 0, 1]);
    const mixed = createSceneState(root, cache, {
      dirty: MOTION | Dirty.MaterialUniform,
      dirtyNodes: new Map([
        [mesh, MOTION],
        [material, Dirty.MaterialUniform]
      ])
    });
    expect(mixed.drawBatchesChanged).toBe(false);
    expect(packed(mixed)).toEqual(packed(createSceneState(root)));
    remove(mesh);
    expect(createSceneState(root, cache, { dirty: MOTION, dirtyNodes }).drawBatches).toHaveLength(
      0
    );
  });

  it('uses the full path when moving a group containing lights', () => {
    const root = createElement('scene');
    const group = createElement('group');
    insert(root, group, null);
    box(group);
    insert(group, createElement('pointLight'), null);
    const cache = createTypeGpuSceneCache();
    createSceneState(root, cache);
    setAttribute(group, 'position', [4, 0, 0]);
    const state = createSceneState(root, cache, {
      dirty: MOTION,
      dirtyNodes: new Map([[group, MOTION]])
    });
    expect(state.drawBatchesChanged).toBe(true);
    expect(state.lights[0].position).toEqual([4, 0, 0]);
    expect(packed(state)).toEqual(packed(createSceneState(root)));
  });

  it('updates hidden transforms without uploading, then shows the current pose', () => {
    const root = createElement('scene');
    const group = createElement('group');
    insert(root, group, null);
    box(group, 2);
    setAttribute(group, 'visible', false);
    const cache = createTypeGpuSceneCache();
    createSceneState(root, cache);
    setAttribute(group, 'position', [5, 0, 0]);
    const hidden = createSceneState(root, cache, {
      dirty: MOTION,
      dirtyNodes: new Map([[group, MOTION]])
    });
    expect(hidden.instanceUpdates).toEqual([]);
    expect(hidden.drawBatches).toEqual([]);
    setAttribute(group, 'visible', true);
    expect(createSceneState(root, cache).drawBatches[0].instances[0]).toBe(7);
  });

  it('keeps model primitive-local transforms after async settlement and visibility changes', async () => {
    const root = createElement('scene');
    const model = createElement('model');
    setAttribute(model, 'src', '/model.glb');
    insert(root, model, null);
    const geometry = resources.readInlineGeometry(createElement('boxGeometry'))!;
    const material = resources.readInlineMaterial(createElement('standardMaterial'))!;
    const loaded: TypeGpuLoadedModel = {
      key: 'model',
      meshes: [1, 3].map((x) => ({
        geometry,
        material,
        transform: { position: [x, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0] }
      }))
    };
    const modelCache = createModelCache({ loadUrl: async () => loaded });
    const cache = createTypeGpuSceneCache({ modelCache });
    expect(createSceneState(root, cache).drawBatches).toHaveLength(0);
    await Promise.resolve();
    createSceneState(root, cache);
    setAttribute(model, 'position', [10, 0, 0]);
    const state = createSceneState(root, cache, {
      dirty: MOTION,
      dirtyNodes: new Map([[model, MOTION]])
    });
    expect(state.drawBatchesChanged).toBe(false);
    expect(state.drawBatches[0].instances[0]).toBe(11);
    expect(state.drawBatches[0].instances[24]).toBe(13);
    expect(packed(state)).toEqual(
      packed(createSceneState(root, createTypeGpuSceneCache({ modelCache })))
    );
    const override = createElement('standardMaterial');
    insert(model, override, null);
    createSceneState(root, cache);
    setAttribute(override, 'roughness', 0.2);
    const values = createSceneState(root, cache, {
      dirty: Dirty.MaterialUniform,
      dirtyNodes: new Map([[override, Dirty.MaterialUniform]])
    });
    expect(values.drawBatchesChanged).toBe(false);
    expect(values.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 2 }]);
    expect(packed(values)).toEqual(packed(createSceneState(root, createTypeGpuSceneCache({ modelCache }))));
    setAttribute(model, 'visible', false);
    expect(createSceneState(root, cache).drawBatches).toHaveLength(0);
    setAttribute(model, 'visible', true);
    expect(createSceneState(root, cache).drawBatches[0].instanceCount).toBe(2);
  });
});
