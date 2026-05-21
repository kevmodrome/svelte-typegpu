import { describe, expect, it, vi } from 'vitest';
import { BOX_INSTANCE_FLOATS } from './box-data';
import {
  addEventListener,
  createElement,
  createFragment,
  dispatchNodeEvent,
  getNextSibling,
  insert,
  remove,
  setAttribute
} from './core';
import { collectMeshDrawItems, findFirstInteractiveMesh } from './components/mesh';
import { readPerspectiveCamera } from './components/perspective-camera';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';

describe('TypeGPU renderer core', () => {
  it('turns authored primitive nodes into separate draw batches', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const first = createElement('box');
    const second = createElement('box');
    const sphere = createElement('sphere');

    setAttribute(camera, 'position', [0, 2, 8]);
    setAttribute(camera, 'lookAt', [0, 0, 0]);
    setAttribute(camera, 'fov', 50);
    setAttribute(first, 'position', [1, 2, 3]);
    setAttribute(first, 'phase', 0.25);
    setAttribute(first, 'color', [0.1, 0.2, 0.3, 1]);
    setAttribute(first, 'width', 20);
    setAttribute(first, 'height', 5);
    setAttribute(first, 'depth', 10);
    setAttribute(first, 'spinSpeed', 1.4);
    setAttribute(second, 'position', [-1, -2, -3]);
    setAttribute(second, 'phase', 0.5);
    setAttribute(second, 'color', [0.4, 0.5, 0.6, 1]);
    setAttribute(sphere, 'position', [7, 8, 9]);
    setAttribute(sphere, 'phase', 0.75);
    setAttribute(sphere, 'color', [0.7, 0.8, 0.9, 1]);

    insert(scene, camera, null);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(scene, sphere, null);
    insert(root, scene, null);

    const state = createSceneState(root);
    const boxBatch = drawBatch(state, 'primitive:box');
    const sphereBatch = drawBatch(state, 'primitive:sphere');

    expect(state).toMatchObject({
      camera: {
        position: [0, 2, 8],
        lookAt: [0, 0, 0],
        fov: 50,
        near: 0.1,
        far: 100
      }
    });

    expect(boxBatch.geometry.key).toBe('box');
    expect(boxBatch.instanceCount).toBe(2);
    expect(boxBatch.instanceIds).toEqual([first.uid, second.uid]);
    expect(Array.from(boxBatch.instances.slice(0, 4))).toEqual([1, 2, 3, 0.25]);
    expect(boxBatch.instances[4]).toBeCloseTo(0.1);
    expect(boxBatch.instances[5]).toBeCloseTo(0.2);
    expect(boxBatch.instances[6]).toBeCloseTo(0.3);
    expect(boxBatch.instances[7]).toBe(1);
    expect(Array.from(boxBatch.instances.slice(8, 11))).toEqual([20, 5, 10]);
    expect(boxBatch.instances[11]).toBeCloseTo(1.4);
    expect(boxBatch.instances[12]).toBe(0);
    expect(Array.from(boxBatch.instances.slice(13, 17))).toEqual([-1, -2, -3, 0.5]);
    expect(boxBatch.instances[17]).toBeCloseTo(0.4);
    expect(boxBatch.instances[18]).toBeCloseTo(0.5);
    expect(boxBatch.instances[19]).toBeCloseTo(0.6);
    expect(boxBatch.instances[20]).toBe(1);
    expect(Array.from(boxBatch.instances.slice(21, 25))).toEqual([1, 1, 1, 0]);
    expect(boxBatch.instances[25]).toBe(0);

    expect(sphereBatch.geometry.key).toBe('sphere');
    expect(sphereBatch.instanceCount).toBe(1);
    expect(sphereBatch.instanceIds).toEqual([sphere.uid]);
    expect(Array.from(sphereBatch.instances.slice(0, 4))).toEqual([7, 8, 9, 0.75]);
    expect(sphereBatch.instances[4]).toBeCloseTo(0.7);
    expect(sphereBatch.instances[5]).toBeCloseTo(0.8);
    expect(sphereBatch.instances[6]).toBeCloseTo(0.9);
    expect(sphereBatch.instances[7]).toBe(1);
  });

  it('reads camera settings from a perspectiveCamera node', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');

    setAttribute(camera, 'position', [2, 3, 4]);
    setAttribute(camera, 'lookAt', [1, 1, 1]);
    setAttribute(camera, 'fov', 35);
    setAttribute(camera, 'near', 0.5);
    setAttribute(camera, 'far', 250);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readPerspectiveCamera(root)).toEqual({
      position: [2, 3, 4],
      lookAt: [1, 1, 1],
      fov: 35,
      near: 0.5,
      far: 250
    });
  });

  it('stores and dispatches element events', () => {
    const box = createElement('box');
    const handler = vi.fn();

    addEventListener(box, 'click', handler);
    dispatchNodeEvent(box, 'click', { detail: { selected: true } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'click',
        target: box,
        currentTarget: box,
        detail: { selected: true }
      })
    );
  });

  it('returns child snapshots without letting snapshot mutation corrupt sibling operations', () => {
    const scene = createElement('scene');
    const first = createElement('box');
    const second = createElement('box');
    const insertedBeforeSecond = createElement('box');

    insert(scene, first, null);
    insert(scene, second, null);

    const snapshot = scene.children;
    snapshot.length = 0;

    expect(getNextSibling(first)).toBe(second);

    insert(scene, insertedBeforeSecond, second);
    remove(first);

    expect(scene.children).toEqual([insertedBeforeSecond, second]);
    expect(getNextSibling(insertedBeforeSecond)).toBe(second);
  });

  it('reuses packed primitive data when only non-primitive attributes change', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const box = createElement('box');

    setAttribute(camera, 'position', [0, 2, 8]);
    setAttribute(box, 'position', [1, 2, 3]);
    insert(scene, camera, null);
    insert(scene, box, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    setAttribute(camera, 'fov', 35);
    const secondState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'primitive:box');
    const secondBoxBatch = drawBatch(secondState, 'primitive:box');

    expect(firstBoxBatch.instancesChanged).toBe(true);
    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(false);
    expect(secondBoxBatch.dirtyRanges).toEqual([]);
  });

  it('keeps global scene scale and animation speed out of primitive instance data', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const box = createElement('box');

    setAttribute(scene, 'scale', 1);
    setAttribute(scene, 'animationSpeed', 1);
    setAttribute(box, 'position', [1, 2, 3]);
    setAttribute(box, 'width', 2);
    insert(scene, box, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'primitive:box');
    setAttribute(scene, 'scale', 1.5);
    setAttribute(scene, 'animationSpeed', 0.35);
    const secondState = createSceneState(root, cache);
    const secondBoxBatch = drawBatch(secondState, 'primitive:box');

    expect(secondState.scale).toBe(1.5);
    expect(secondState.animationSpeed).toBe(0.35);
    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(false);
    expect(secondBoxBatch.dirtyRanges).toEqual([]);
  });

  it('re-packs only changed primitive nodes when the primitive structure is stable', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const first = createElement('box');
    const second = createElement('box');

    setAttribute(first, 'position', [1, 2, 3]);
    setAttribute(second, 'position', [4, 5, 6]);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    setAttribute(second, 'color', [0.2, 0.3, 0.4, 1]);
    const secondState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'primitive:box');
    const secondBoxBatch = drawBatch(secondState, 'primitive:box');

    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(true);
    expect(secondBoxBatch.dirtyRanges).toEqual([{ start: 1, count: 1 }]);
    expect(secondBoxBatch.instances[BOX_INSTANCE_FLOATS + 4]).toBeCloseTo(0.2);
    expect(secondBoxBatch.instances[BOX_INSTANCE_FLOATS + 5]).toBeCloseTo(0.3);
    expect(secondBoxBatch.instances[BOX_INSTANCE_FLOATS + 6]).toBeCloseTo(0.4);
    expect(secondBoxBatch.instances[BOX_INSTANCE_FLOATS + 7]).toBe(1);
  });

  it('reads a mesh with box geometry and standard material into a draw item', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(mesh, 'phase', 0.25);
    setAttribute(mesh, 'spinSpeed', 1.4);
    setAttribute(geometry, 'width', 20);
    setAttribute(geometry, 'height', 5);
    setAttribute(geometry, 'depth', 10);
    setAttribute(material, 'color', [0.1, 0.2, 0.3, 1]);
    setAttribute(material, 'roughness', 0.62);
    setAttribute(material, 'metalness', 0.18);

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item).toMatchObject({
      id: mesh.uid,
      phase: 0.25,
      spinSpeed: 1.4,
      geometry: {
        kind: 'box',
        size: [20, 5, 10]
      },
      material: {
        kind: 'standard',
        color: [0.1, 0.2, 0.3, 1],
        roughness: 0.62,
        metalness: 0.18
      },
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
  });

  it('uses identity transform defaults for an untransformed mesh', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform).toEqual({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    });
  });

  it('applies nested group transforms to child meshes', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(group, 'position', [10, 0, 0]);
    setAttribute(group, 'scale', [2, 3, 4]);
    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(mesh, 'rotation', [0.1, 0.2, 0.3]);

    insert(mesh, geometry, null);
    insert(group, mesh, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform.position[0]).toBeCloseTo(12);
    expect(item.transform.position[1]).toBeCloseTo(6);
    expect(item.transform.position[2]).toBeCloseTo(12);
    expect(item.transform.rotation).toEqual([0.1, 0.2, 0.3]);
    expect(item.transform.scale).toEqual([2, 3, 4]);
  });

  it('composes nested rotations instead of adding Euler components', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(group, 'rotation', [Math.PI / 2, 0, 0]);
    setAttribute(mesh, 'rotation', [0, Math.PI / 2, 0]);

    insert(mesh, geometry, null);
    insert(group, mesh, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform.rotation[0]).toBeCloseTo(Math.PI / 2);
    expect(item.transform.rotation[1]).toBeCloseTo(0);
    expect(item.transform.rotation[2]).toBeCloseTo(Math.PI / 2);
  });

  it('skips invalid mesh composition without crashing', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const meshWithoutGeometry = createElement('mesh');
    const looseGeometry = createElement('boxGeometry');
    const validMesh = createElement('mesh');
    const validGeometry = createElement('sphereGeometry');

    insert(scene, looseGeometry, null);
    insert(scene, meshWithoutGeometry, null);
    insert(validMesh, validGeometry, null);
    insert(scene, validMesh, null);
    insert(root, scene, null);

    const items = collectMeshDrawItems(root);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(validMesh.uid);
    expect(items[0].geometry.kind).toBe('sphere');
    expect(items[0].material.color).toEqual([1, 1, 1, 1]);
  });

  it('changes mesh item revision when a material child is replaced', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const treeRevision = root.treeRevision;
    const [before] = collectMeshDrawItems(root);
    const replacement = createElement('standardMaterial');

    remove(material);
    insert(mesh, replacement, null);
    // Keep the tree seed stable so this isolates child identity in the item revision.
    root.treeRevision = treeRevision;

    const [after] = collectMeshDrawItems(root);

    expect(after.revision).not.toBe(before.revision);
  });

  it('finds the first interactive mesh node', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const first = createElement('mesh');
    const second = createElement('mesh');
    const handler = vi.fn();

    addEventListener(second, 'click', handler);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(root, scene, null);

    expect(findFirstInteractiveMesh(root, 'click')).toBe(second);
  });
});

function drawBatch(state: ReturnType<typeof createSceneState>, key: string) {
  const batch = state.drawBatches.find((candidate) => candidate.key === key);

  if (!batch) {
    throw new Error(`Missing draw batch ${key}`);
  }

  return batch;
}
