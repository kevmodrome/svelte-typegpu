import { describe, expect, it, vi } from 'vitest';
import { Color, Mesh, PerspectiveCamera, Scene } from 'three';
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
