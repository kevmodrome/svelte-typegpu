import { describe, expect, it } from 'vitest';
import {
  CUBE_COUNT_PRESETS,
  clampCubeCount,
  createCubeField,
  sceneCameraForCount
} from './cube-field';

describe('cube field', () => {
  it('clamps cube counts to the supported stress-test range', () => {
    expect(CUBE_COUNT_PRESETS).toEqual([1, 1_000, 10_000]);
    expect(clampCubeCount(-5)).toBe(1);
    expect(clampCubeCount(1.7)).toBe(2);
    expect(clampCubeCount(20_000)).toBe(10_000);
  });

  it('creates a deterministic centered 3D grid', () => {
    expect(createCubeField(1)).toEqual([
      {
        id: 0,
        position: [0, 0, 0],
        phase: 0
      }
    ]);

    const field = createCubeField(8);
    expect(field).toHaveLength(8);
    expect(field[0]).toEqual({ id: 0, position: [-0.28, -0.28, -0.28], phase: 0 });
    expect(field[7]).toEqual({ id: 7, position: [0.28, 0.28, 0.28], phase: 0.7 });
  });

  it('moves the camera back for multi-cube stress tests', () => {
    expect(sceneCameraForCount(1)).toEqual({
      position: [0, 1.4, 5],
      target: [0, 0, 0],
      floorSize: 6,
      cubeSize: 1.5
    });

    expect(sceneCameraForCount(10_000)).toEqual({
      position: [9, 7, 13],
      target: [0, 0, 0],
      floorSize: 18,
      cubeSize: 0.24
    });
  });

});
