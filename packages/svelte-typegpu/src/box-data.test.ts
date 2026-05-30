import { describe, expect, it } from 'vitest';
import { createViewProjectionMatrix } from './camera-math';
import {
  BOX_INSTANCE_FLOATS,
  BOX_SPIN_OFFSET_OFFSET,
  BOX_SPIN_SPEED_OFFSET,
  BOX_VERTEX_FLOATS,
  createBoxVertexData
} from './box-data';

describe('TypeGPU box data', () => {
  it('creates indexed box triangle vertices with positions, normals, UVs, and colors', () => {
    const vertices = createBoxVertexData();

    expect(vertices).toBeInstanceOf(Float32Array);
    expect(vertices.length).toBe(36 * BOX_VERTEX_FLOATS);
    expect(Array.from(vertices.slice(0, 12))).toEqual([
      -0.5, -0.5, 0.5,
      0, 0, 1,
      0, 0,
      1, 1, 1, 1
    ]);
    expect(Array.from(vertices.slice(12, 24))).toEqual([
      0.5, -0.5, 0.5,
      0, 0, 1,
      1, 0,
      1, 1, 1, 1
    ]);
  });

  it('aliases the packed mesh instance fields used by box batches', () => {
    expect(BOX_INSTANCE_FLOATS).toBe(24);
    expect(BOX_SPIN_SPEED_OFFSET).toBe(11);
    expect(BOX_SPIN_OFFSET_OFFSET).toBe(12);
  });

  it('creates a stable view projection matrix for the GPU uniform buffer', () => {
    const matrix = createViewProjectionMatrix(16 / 9);

    expect(matrix).toBeInstanceOf(Float32Array);
    expect(matrix).toHaveLength(16);
    expect(Array.from(matrix).every(Number.isFinite)).toBe(true);
    expect(matrix[0]).toBeCloseTo(1.116533);
    expect(matrix[5]).toBeCloseTo(2.207548);
    expect(matrix[15]).toBeCloseTo(17.291616);
  });
});
