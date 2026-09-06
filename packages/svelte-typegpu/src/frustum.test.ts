import { describe, expect, it } from 'vitest';
import { Frustum } from './frustum';
import { createViewProjectionMatrix } from './camera-math';

const identity = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
function test(frustum: Frustum, bounds: number[]) { return frustum.classify(new Float64Array(bounds), 0); }

describe('WebGPU frustum planes', () => {
  it.each([
    [-3, 0, 0.5], [3, 0, 0.5], [0, -3, 0.5], [0, 3, 0.5], [0, 0, -0.5], [0, 0, 2]
  ])('rejects the outside point (%s, %s, %s)', (x, y, z) => {
    const frustum = new Frustum(); frustum.setMatrix(identity);
    expect(test(frustum, [x, y, z, x, y, z])).toBe(-1);
  });

  it('keeps touching, intersecting, and camera-enclosing bounds', () => {
    const frustum = new Frustum(); frustum.setMatrix(identity);
    expect(test(frustum, [-0.5, -0.5, 0.1, 0.5, 0.5, 0.9])).toBe(1);
    for (const z of [0, 1]) expect(test(frustum, [0, 0, z, 0, 0, z])).toBe(0);
    expect(test(frustum, [1, 0, 0.5, 2, 0.5, 0.5])).toBe(0);
    expect(test(frustum, [-10, -10, -10, 10, 10, 10])).toBe(0);
    expect(test(frustum, [1 + 1e-7, 0, 0.5, 2, 0.5, 0.5])).toBe(0);
  });

  it('uses perspective near z=0 rather than OpenGL near z=-w', () => {
    const frustum = new Frustum();
    frustum.setMatrix(createViewProjectionMatrix(1, { projection: 'perspective', position: [0, 0, 0],
      target: [0, 0, -1], fov: 90, near: 1, far: 10 }));
    expect(test(frustum, [0, 0, -0.75, 0, 0, -0.75])).toBe(-1);
    expect(test(frustum, [0, 0, -1, 0, 0, -1])).toBe(0);
    expect(test(frustum, [-0.1, -0.1, -5, 0.1, 0.1, -4])).toBe(1);
    expect(test(frustum, [0, 0, -11, 0, 0, -11])).toBe(-1);
    expect(test(frustum, [0, 0, 1, 0, 0, 1])).toBe(-1);
  });

  it.each(['perspective', 'orthographic'] as const)('follows real %s camera translation and aspect', projection => {
    const frustum = new Frustum();
    const camera = { position: [100, 0, 10] as [number, number, number],
      target: [100, 0, 0] as [number, number, number], near: 0.1, far: 15,
      ...(projection === 'perspective' ? { projection, fov: 45 } : { projection, zoom: 1 }) };
    frustum.setMatrix(createViewProjectionMatrix(1, camera));
    expect(test(frustum, [99.9, -0.1, -0.1, 100.1, 0.1, 0.1])).toBe(1);
    expect(test(frustum, [-0.1, -0.1, -0.1, 0.1, 0.1, 0.1])).toBe(-1);
    const old = frustum.revision;
    frustum.setMatrix(createViewProjectionMatrix(1, camera)); expect(frustum.revision).toBe(old);
    frustum.setMatrix(createViewProjectionMatrix(2, camera)); expect(frustum.revision).toBe(old + 1);
  });

  it('fails open for invalid views and unbounded objects', () => {
    const frustum = new Frustum();
    for (const matrix of [new Float32Array(16), new Float32Array(16).fill(NaN)]) {
      frustum.setMatrix(matrix); expect(frustum.valid).toBe(false);
      expect(test(frustum, [10, 10, 10, 11, 11, 11])).toBe(0);
    }
    frustum.setMatrix(identity);
    expect(test(frustum, [-Infinity, -Infinity, -Infinity, Infinity, Infinity, Infinity])).toBe(0);
  });
});
