import { describe, expect, it } from 'vitest';
import {
  boxBounds,
  planeBounds,
  rayIntersectsBounds,
  sphereBounds,
  transformBounds
} from './bounds';

describe('TypeGPU bounds math', () => {
  it('creates centered box bounds from size', () => {
    expect(boxBounds([2, 4, 6])).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
  });

  it('creates centered plane bounds in the XZ plane', () => {
    expect(planeBounds([4, 6, 0])).toEqual({ min: [-2, 0, -3], max: [2, 0, 3] });
  });

  it('creates centered sphere bounds from size', () => {
    expect(sphereBounds([2, 2, 2])).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });
  });

  it('transforms bounds with position and scale', () => {
    expect(
      transformBounds(boxBounds([2, 2, 2]), {
        position: [5, 0, 0],
        rotation: [0, 0, 0],
        scale: [2, 1, 1]
      })
    ).toEqual({ min: [3, -1, -1], max: [7, 1, 1] });
  });

  it('returns nearest positive ray intersection distance and point', () => {
    const hit = rayIntersectsBounds(
      { origin: [0, 0, 5], direction: [0, 0, -1] },
      boxBounds([2, 2, 2])
    );

    expect(hit).not.toBeNull();
    expect(hit!.distance).toBeCloseTo(4);
    expect(hit!.point).toEqual([0, 0, 1]);
  });

  it('returns null for a ray miss', () => {
    expect(
      rayIntersectsBounds(
        { origin: [0, 0, 5], direction: [0, 1, 0] },
        boxBounds([2, 2, 2])
      )
    ).toBeNull();
  });
});
