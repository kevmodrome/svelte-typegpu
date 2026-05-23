import { describe, expect, it } from 'vitest';
import { createElement, createFragment, insert, setAttribute } from './core';
import {
  cameraRayFromViewport,
  createViewProjectionMatrix,
  readCameraState
} from './camera-math';

describe('TypeGPU camera math', () => {
  it('reads direct perspective camera props', () => {
    const root = createFragment();
    const camera = createElement('perspectiveCamera');

    setAttribute(camera, 'position', [1, 2, 3]);
    setAttribute(camera, 'target', [0, 1, 0]);
    setAttribute(camera, 'fov', 60);
    setAttribute(camera, 'near', 0.5);
    setAttribute(camera, 'far', 250);
    insert(root, camera, null);

    expect(readCameraState(root).settings).toEqual({
      projection: 'perspective',
      position: [1, 2, 3],
      target: [0, 1, 0],
      fov: 60,
      near: 0.5,
      far: 250
    });
  });

  it('reads direct orthographic camera props and creates a finite matrix', () => {
    const root = createFragment();
    const camera = createElement('orthographicCamera');

    setAttribute(camera, 'position', [0, 4, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(camera, 'zoom', 2);
    insert(root, camera, null);

    const state = readCameraState(root);
    const matrix = createViewProjectionMatrix(16 / 9, state.settings);

    expect(state.settings).toEqual({
      projection: 'orthographic',
      position: [0, 4, 10],
      target: [0, 0, 0],
      zoom: 2,
      near: 0.1,
      far: 100
    });
    expect(matrix).toBeInstanceOf(Float32Array);
    expect(matrix).toHaveLength(16);
    expect(Array.from(matrix).every(Number.isFinite)).toBe(true);
  });

  it('creates a center perspective ray from viewport coordinates', () => {
    const ray = cameraRayFromViewport({
      x: 400,
      y: 300,
      viewport: { width: 800, height: 600 },
      camera: {
        projection: 'perspective',
        position: [0, 0, 10],
        target: [0, 0, 0],
        fov: 45,
        near: 0.1,
        far: 100
      }
    });

    expect(ray.origin).toEqual([0, 0, 10]);
    expect(ray.direction[0]).toBeCloseTo(0);
    expect(ray.direction[1]).toBeCloseTo(0);
    expect(ray.direction[2]).toBeLessThan(-0.99);
  });
});
