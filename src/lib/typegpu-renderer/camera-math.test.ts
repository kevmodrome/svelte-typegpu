import { describe, expect, it } from 'vitest';
import { createElement, createFragment, insert, setAttribute } from './core';
import {
  cameraRayFromViewport,
  createViewProjectionMatrix,
  readCameraState
} from './camera-math';
import { invert4, multiply4, perspectiveMatrix } from './math3d';

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

  it('reads direct orthographic camera props and creates a numeric matrix', () => {
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
    expect(matrix[0]).toBeCloseTo(1.125);
    expect(matrix[5]).toBeCloseTo(1.856953);
    expect(matrix[10]).toBeCloseTo(-0.018589);
    expect(matrix[14]).toBeCloseTo(-0.78638);
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

  it('creates an off-center perspective ray from viewport coordinates', () => {
    const ray = cameraRayFromViewport({
      x: 800,
      y: 0,
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
    expect(ray.direction[0]).toBeGreaterThan(0.45);
    expect(ray.direction[1]).toBeGreaterThan(0.3);
    expect(ray.direction[2]).toBeLessThan(-0.8);
  });

  it('creates orthographic rays with shifted origins and shared direction', () => {
    const ray = cameraRayFromViewport({
      x: 800,
      y: 0,
      viewport: { width: 800, height: 400 },
      camera: {
        projection: 'orthographic',
        position: [0, 0, 10],
        target: [0, 0, 0],
        zoom: 2,
        near: 0.1,
        far: 100
      }
    });

    expect(ray.origin[0]).toBeCloseTo(1);
    expect(ray.origin[1]).toBeCloseTo(0.5);
    expect(ray.origin[2]).toBeCloseTo(9.9);
    expect(ray.direction).toEqual([0, 0, -1]);
  });

  it('prefers an active camera when multiple cameras exist', () => {
    const root = createFragment();
    const first = createElement('perspectiveCamera');
    const second = createElement('orthographicCamera');

    setAttribute(first, 'position', [1, 0, 0]);
    setAttribute(second, 'active', true);
    setAttribute(second, 'position', [2, 0, 0]);
    setAttribute(second, 'zoom', 3);
    insert(root, first, null);
    insert(root, second, null);

    expect(readCameraState(root).settings).toEqual({
      projection: 'orthographic',
      position: [2, 0, 0],
      target: [0, 0, 0],
      zoom: 3,
      near: 0.1,
      far: 100
    });
  });

  it('normalizes invalid direct camera props before creating rays', () => {
    const root = createFragment();
    const camera = createElement('perspectiveCamera');

    setAttribute(camera, 'fov', 0);
    setAttribute(camera, 'near', -1);
    setAttribute(camera, 'far', 0);
    insert(root, camera, null);

    const state = readCameraState(root);
    const ray = cameraRayFromViewport({
      x: 400,
      y: 300,
      viewport: { width: 800, height: 600 },
      camera: state.settings
    });

    expect(state.settings).toMatchObject({ fov: 45, near: 0.1, far: 100 });
    expect(ray.direction.every(Number.isFinite)).toBe(true);
  });

  it('throws when creating a ray with invalid viewport dimensions', () => {
    expect(() =>
      cameraRayFromViewport({
        x: 0,
        y: 0,
        viewport: { width: 0, height: 600 },
        camera: {
          projection: 'perspective',
          position: [0, 0, 10],
          target: [0, 0, 0],
          fov: 45,
          near: 0.1,
          far: 100
        }
      })
    ).toThrow('Viewport dimensions must be finite positive numbers');
  });

  it('returns null for singular matrix inversion', () => {
    expect(invert4(new Float32Array(16))).toBeNull();
  });

  it('inverts a non-singular matrix', () => {
    const matrix = perspectiveMatrix(Math.PI / 4, 16 / 9, 0.1, 100);
    const inverse = invert4(matrix);

    expect(inverse).not.toBeNull();

    const identity = multiply4(inverse!, matrix);
    for (let index = 0; index < 16; index += 1) {
      expect(identity[index]).toBeCloseTo(index % 5 === 0 ? 1 : 0, 5);
    }
  });
});
