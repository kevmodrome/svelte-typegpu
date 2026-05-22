import { describe, expect, it } from 'vitest';
import {
  cameraFromOrbit,
  deriveOrbitState,
  normalizeWheelDelta,
  rotateOrbit,
  zoomOrbit
} from './camera-orbit';

describe('TypeGPU orbit camera math', () => {
  const camera = {
    position: [0, 1.4, 5] as [number, number, number],
    lookAt: [0, 0, 0] as [number, number, number],
    fov: 45,
    near: 0.1,
    far: 500
  };

  it('derives orbit state from camera position and lookAt', () => {
    const state = deriveOrbitState(camera, { minDistance: 1, maxDistance: 100 });

    expect(state.lookAt).toEqual([0, 0, 0]);
    expect(state.radius).toBeCloseTo(5.1923);
    expect(state.yaw).toBeCloseTo(0);
    expect(state.pitch).toBeCloseTo(0.2730);
  });

  it('reconstructs camera settings from orbit state', () => {
    const state = deriveOrbitState(camera, { minDistance: 1, maxDistance: 100 });
    const nextCamera = cameraFromOrbit(state, camera);

    expect(nextCamera.position[0]).toBeCloseTo(0);
    expect(nextCamera.position[1]).toBeCloseTo(1.4);
    expect(nextCamera.position[2]).toBeCloseTo(5);
    expect(nextCamera.lookAt).toEqual([0, 0, 0]);
    expect(nextCamera.fov).toBe(45);
    expect(nextCamera.near).toBe(0.1);
    expect(nextCamera.far).toBe(500);
  });

  it('rotates orbit yaw and pitch with clamping', () => {
    const state = deriveOrbitState(camera, { minDistance: 1, maxDistance: 100 });
    const rotated = rotateOrbit(state, 100, -40, {
      invert: false,
      rotateSpeed: 1,
      minDistance: 1,
      maxDistance: 100
    });

    expect(rotated.radius).toBeCloseTo(state.radius);
    expect(rotated.yaw).toBeCloseTo(-0.5);
    expect(rotated.pitch).toBeCloseTo(0.0730);
  });

  it('zooms orbit radius within constraints', () => {
    const state = deriveOrbitState(camera, { minDistance: 4, maxDistance: 6 });

    expect(zoomOrbit(state, 100, { minDistance: 4, maxDistance: 6, zoomSpeed: 1 }).radius).toBe(6);
    expect(zoomOrbit(state, -100, { minDistance: 4, maxDistance: 6, zoomSpeed: 1 }).radius).toBe(4);
  });

  it('normalizes and clamps wheel deltas', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48);
    expect(normalizeWheelDelta(1, 2, 800)).toBe(60);
    expect(normalizeWheelDelta(500, 0, 800)).toBe(60);
    expect(normalizeWheelDelta(-500, 0, 800)).toBe(-60);
  });
});
