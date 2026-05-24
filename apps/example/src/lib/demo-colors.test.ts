import { describe, expect, it } from 'vitest';
import { demoColorForIndex, hslToRgb } from './demo-colors';

describe('demo colors', () => {
  it('converts hue to normalized rgb values', () => {
    expect(hslToRgb(0, 1, 0.5)).toEqual([1, 0, 0]);
    expect(hslToRgb(120, 1, 0.5)).toEqual([0, 1, 0]);
    expect(hslToRgb(240, 1, 0.5)).toEqual([0, 0, 1]);
  });

  it('creates shaded demo colors without renderer primitive coupling', () => {
    expect(demoColorForIndex(0, 0)[0]).toBeCloseTo(0.670752);
    expect(demoColorForIndex(0, 0)[3]).toBe(1);
    expect(demoColorForIndex(1, 120)[1]).toBeGreaterThan(demoColorForIndex(0, 120)[1]);
  });
});
