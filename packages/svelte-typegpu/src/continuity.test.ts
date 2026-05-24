import { describe, expect, it } from 'vitest';
import { createContinuityTracker } from './continuity';

describe('TypeGPU continuity tracker', () => {
  it('preserves the current value when a keyed rate changes', () => {
    const continuity = createContinuityTracker();

    expect(continuity.offsetFor({ key: 10, rate: 1, time: 4 })).toBe(0);
    const offset = continuity.offsetFor({ key: 10, rate: 2, time: 4 });

    expect(4 * 2 + offset).toBeCloseTo(4);
    expect(5 * 2 + offset).toBeCloseTo(6);
  });

  it('keeps zero-rate values fixed at their previous value', () => {
    const continuity = createContinuityTracker();

    continuity.offsetFor({ key: 'shape-a', rate: 1, time: 4 });
    const offset = continuity.offsetFor({ key: 'shape-a', rate: 0, time: 4 });

    expect(4 * 0 + offset).toBeCloseTo(4);
    expect(10 * 0 + offset).toBeCloseTo(4);
  });
});
