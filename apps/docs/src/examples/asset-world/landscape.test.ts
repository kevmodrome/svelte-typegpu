import { describe, expect, it } from 'vitest';
import { campsiteModelCount, compactLandscape, createLandscape, worldCounts } from './landscape';
import { createPlayerController, createPlayerState, runSpeed } from './player-controller';

describe('large asset landscapes', () => {
  it.each(worldCounts)('creates exactly %s models including the campsite', count => {
    const landscape = createLandscape(count);
    expect(landscape.placements.length + campsiteModelCount).toBe(count);
    expect(new Set(landscape.placements.map(item => item.key)).size).toBe(landscape.placements.length);
    for (const item of landscape.placements) {
      const [x, , z] = item.position;
      expect(Math.abs(x)).toBeLessThan(landscape.halfWidth - 4);
      expect(Math.abs(z)).toBeLessThan(landscape.halfDepth - 4);
      expect(Math.abs(x) >= 16 || Math.abs(z) >= 13).toBe(true);
      expect(x <= 0.4 || x >= 6.6).toBe(true);
    }
  });
  it('preserves deterministic placement keys and transforms as the world grows', () => {
    expect(createLandscape(29)).toBe(compactLandscape);
    expect(createLandscape(20000).placements.slice(0, 971)).toEqual(createLandscape(1000).placements);
    for (const count of [0, 28, 29.1, 50001, NaN, Infinity]) expect(() => createLandscape(count)).toThrow(RangeError);
  });
  it.each([20000, 50000])('bounds collision candidates independently of %s models', count => {
    const landscape = createLandscape(count), controller = createPlayerController(landscape);
    let maximum = 0;
    for (const item of landscape.placements.filter((_, i) => i % 31 === 0)) {
      const state = { ...createPlayerState(), x: item.position[0] + 2, z: item.position[2] + 2 };
      controller.step(state, { x: 1, z: 0, run: true }, 1 / 60, { x: 0, z: 1 }, true);
      maximum = Math.max(maximum, controller.stats.candidates);
      expect(Number.isFinite(state.x + state.z)).toBe(true);
    }
    expect(maximum).toBeGreaterThan(6);
    expect(maximum).toBeLessThan(55);
    const state = { ...createPlayerState(), x: -12, z: 0 };
    for (let i = 0; i < 144; i++) controller.step(state, { x: 0, z: 1, run: true }, 1 / 144, { x: 0, z: 1 }, false);
    expect(state.z).toBeCloseTo(runSpeed, 8);
  });
});
