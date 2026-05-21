import { describe, expect, it, vi } from 'vitest';
import {
  addEventListener,
  createElement,
  createFragment,
  dispatchNodeEvent,
  insert,
  setAttribute
} from './core';
import { readPerspectiveCamera } from './components/perspective-camera';
import { createSceneState } from './scene-state';

describe('TypeGPU renderer core', () => {
  it('turns authored box nodes into compact instance data', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const first = createElement('box');
    const second = createElement('box');

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

    insert(scene, camera, null);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(root, scene, null);

    const state = createSceneState(root);

    expect(state).toMatchObject({
      camera: {
        position: [0, 2, 8],
        lookAt: [0, 0, 0],
        fov: 50,
        near: 0.1,
        far: 100
      },
      instanceCount: 2
    });
    expect(state.instanceIds).toEqual([first.uid, second.uid]);
    expect(Array.from(state.instances.slice(0, 4))).toEqual([1, 2, 3, 0.25]);
    expect(state.instances[4]).toBeCloseTo(0.1);
    expect(state.instances[5]).toBeCloseTo(0.2);
    expect(state.instances[6]).toBeCloseTo(0.3);
    expect(state.instances[7]).toBe(1);
    expect(Array.from(state.instances.slice(8, 11))).toEqual([20, 5, 10]);
    expect(state.instances[11]).toBeCloseTo(1.4);
    expect(state.instances[12]).toBe(0);
    expect(Array.from(state.instances.slice(13, 17))).toEqual([-1, -2, -3, 0.5]);
    expect(state.instances[17]).toBeCloseTo(0.4);
    expect(state.instances[18]).toBeCloseTo(0.5);
    expect(state.instances[19]).toBeCloseTo(0.6);
    expect(state.instances[20]).toBe(1);
    expect(Array.from(state.instances.slice(21, 25))).toEqual([1, 1, 1, 0]);
    expect(state.instances[25]).toBe(0);
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
});
