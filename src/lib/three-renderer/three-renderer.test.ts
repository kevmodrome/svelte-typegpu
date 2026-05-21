import { describe, expect, it, vi } from 'vitest';
import { Color, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, Scene, Vector3 } from 'three';
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

describe('Three renderer core', () => {
  it('inserts Object3D children and preserves sibling order', () => {
    const scene = createElement('scene');
    const first = createElement('mesh');
    const second = createElement('group');
    const insertedBeforeSecond = createElement('mesh');

    insert(scene, first, null);
    insert(scene, second, null);
    insert(scene, insertedBeforeSecond, second);

    expect(scene.three).toBeInstanceOf(Scene);
    expect(scene.children).toEqual([first, insertedBeforeSecond, second]);
    expect((scene.three as Scene).children).toEqual([
      first.three,
      insertedBeforeSecond.three,
      second.three
    ]);
    expect(getNextSibling(first)).toBe(insertedBeforeSecond);
  });

  it('assigns geometry and material resource children to meshes', () => {
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('meshStandardMaterial');

    setAttribute(geometry, 'args', [2, 3, 4]);
    setAttribute(material, 'color', '#ff3366');

    insert(mesh, geometry, null);
    insert(mesh, material, null);

    expect(mesh.three).toBeInstanceOf(Mesh);
    expect((mesh.three as Mesh).geometry).toBe(geometry.three);
    expect((mesh.three as Mesh).material).toBe(material.three);
    expect(((mesh.three as Mesh).material as unknown as { color: Color }).color.getHexString()).toBe(
      'ff3366'
    );
  });

  it('creates instanced meshes and applies instance transforms', () => {
    const mesh = createElement('instancedMesh');
    const matrix = new Matrix4();
    const position = new Vector3();

    setAttribute(mesh, 'args', [2]);
    setAttribute(mesh, 'instanceTransforms', [
      { position: [1, 2, 3], rotation: [0, 0, 0], scale: 2 },
      { position: [4, 5, 6], rotation: [0, Math.PI / 2, 0], scale: 1 }
    ]);

    expect(mesh.three).toBeInstanceOf(InstancedMesh);
    expect((mesh.three as InstancedMesh).count).toBe(2);

    (mesh.three as InstancedMesh).getMatrixAt(0, matrix);
    position.setFromMatrixPosition(matrix);

    expect(position.toArray()).toEqual([1, 2, 3]);
  });

  it('updates instanced meshes from stable field data and scalar animation attributes', () => {
    const mesh = createElement('instancedMesh');
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();

    setAttribute(mesh, 'args', [2]);
    setAttribute(mesh, 'instanceField', [
      { position: [1, 2, 3], phase: 0 },
      { position: [4, 5, 6], phase: 0.5 }
    ]);
    setAttribute(mesh, 'instanceScale', 0.75);
    setAttribute(mesh, 'instanceSpin', 1);

    expect(mesh.three).toBeInstanceOf(InstancedMesh);
    expect((mesh.three as InstancedMesh).count).toBe(2);

    (mesh.three as InstancedMesh).getMatrixAt(1, matrix);
    position.setFromMatrixPosition(matrix);
    scale.setFromMatrixScale(matrix);

    expect(position.toArray()).toEqual([4, 5, 6]);
    expect(scale.x).toBeCloseTo(0.75);
    expect(scale.y).toBeCloseTo(0.75);
    expect(scale.z).toBeCloseTo(0.75);
  });

  it('automatically batches compatible mesh siblings into an internal InstancedMesh', async () => {
    const scene = createElement('scene');
    const first = createBatchableMesh([1, 0, 0], '#ff3366');
    const second = createBatchableMesh([2, 0, 0], '#ff3366');
    const matrix = new Matrix4();
    const position = new Vector3();

    insert(scene, first, null);
    insert(scene, second, null);
    await Promise.resolve();

    const batch = (scene.three as Scene).children.find(
      (child): child is InstancedMesh => child instanceof InstancedMesh
    );

    expect(batch).toBeInstanceOf(InstancedMesh);
    expect(batch?.count).toBe(2);
    expect((scene.three as Scene).children).not.toContain(first.three);
    expect((scene.three as Scene).children).not.toContain(second.three);
    expect(batch?.userData.__svelteThreeInstanceNodes).toEqual([first, second]);

    batch?.getMatrixAt(1, matrix);
    position.setFromMatrixPosition(matrix);
    expect(position.toArray()).toEqual([2, 0, 0]);
  });

  it('does not batch meshes with incompatible material state', async () => {
    const scene = createElement('scene');
    const first = createBatchableMesh([1, 0, 0], '#ff3366');
    const second = createBatchableMesh([2, 0, 0], '#33aaff');

    insert(scene, first, null);
    insert(scene, second, null);
    await Promise.resolve();

    expect((scene.three as Scene).children.some((child) => child instanceof InstancedMesh)).toBe(
      false
    );
    expect((scene.three as Scene).children).toEqual([first.three, second.three]);
  });

  it('updates common Three object attributes', () => {
    const camera = createElement('perspectiveCamera');
    const mesh = createElement('mesh');

    setAttribute(camera, 'position', [0, 1, 8]);
    setAttribute(camera, 'fov', 50);
    setAttribute(mesh, 'rotation', [0.1, 0.2, 0.3]);
    setAttribute(mesh, 'scale', 1.5);
    setAttribute(mesh, 'visible', false);

    expect(camera.three).toBeInstanceOf(PerspectiveCamera);
    expect((camera.three as PerspectiveCamera).position.toArray()).toEqual([0, 1, 8]);
    expect((camera.three as PerspectiveCamera).fov).toBe(50);
    expect(mesh.three.rotation.toArray().slice(0, 3)).toEqual([0.1, 0.2, 0.3]);
    expect(mesh.three.scale.toArray()).toEqual([1.5, 1.5, 1.5]);
    expect(mesh.three.visible).toBe(false);
  });

  it('moves nodes between parents before inserting', () => {
    const firstScene = createElement('scene');
    const secondScene = createElement('scene');
    const mesh = createElement('mesh');

    insert(firstScene, mesh, null);
    insert(secondScene, mesh, null);

    expect(firstScene.children).toEqual([]);
    expect(secondScene.children).toEqual([mesh]);
    expect((firstScene.three as Scene).children).toEqual([]);
    expect((secondScene.three as Scene).children).toEqual([mesh.three]);
  });

  it('removes nodes and detaches Three resources', () => {
    const mesh = createElement('mesh');
    const material = createElement('meshBasicMaterial');

    insert(mesh, material, null);
    remove(material);

    expect(mesh.children).toEqual([]);
    expect((mesh.three as Mesh).material).not.toBe(material.three);
  });

  it('stores element listeners and dispatches node events', () => {
    const fragment = createFragment();
    const mesh = createElement('mesh');
    const handler = vi.fn();

    insert(fragment, mesh, null);
    addEventListener(mesh, 'click', handler);
    dispatchNodeEvent(mesh, 'click', { detail: { selected: true } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'click',
        target: mesh,
        currentTarget: mesh,
        detail: { selected: true }
      })
    );
  });
});

function createBatchableMesh(position: [number, number, number], color: string) {
  const mesh = createElement('mesh');
  const geometry = createElement('boxGeometry');
  const material = createElement('meshStandardMaterial');

  setAttribute(geometry, 'args', [1, 1, 1]);
  setAttribute(material, 'color', color);
  setAttribute(mesh, 'position', position);
  insert(mesh, geometry, null);
  insert(mesh, material, null);

  return mesh;
}
