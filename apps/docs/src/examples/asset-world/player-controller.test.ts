import { describe, expect, it, vi } from 'vitest';
import SAT from 'sat';
import { createPlayerController, createPlayerState, playerRadius, runSpeed, walkSpeed } from './player-controller';
import { idleMovement } from './player-input';

const camera = { x: 0, z: 1 };
describe('campsite walking', () => {
  it.each([60, 120, 144])('uses elapsed seconds at %s Hz', hz => {
    const player = { ...createPlayerState(), x: 6, z: -2 }, controller = createPlayerController();
    for (let i = 0; i < hz; i++) controller.step(player, { x: 1, z: 0, run: false }, 1 / hz, camera, false);
    expect(player.x).toBeCloseTo(6 + walkSpeed, 8); expect(player.z).toBe(-2);
  });
  it('normalizes diagonals, runs, and moves relative to the orbit camera', () => {
    for (const run of [false, true]) {
      const player = createPlayerState(), before = { ...player }, controller = createPlayerController();
      controller.step(player, { x: 1, z: -1, run }, 0.05, camera, false);
      expect(Math.hypot(player.x - before.x, player.z - before.z)).toBeCloseTo((run ? runSpeed : walkSpeed) * 0.05);
    }
    const player = createPlayerState(), before = { ...player };
    createPlayerController().step(player, { x: 0, z: -1, run: false }, 0.05, { x: 1, z: 0 }, false);
    expect(player.x).toBeLessThan(before.x); expect(player.z).toBe(before.z);
  });
  it('does not move while idle or on invalid deltas and clamps long gaps', () => {
    const player = createPlayerState(), before = { ...player }, controller = createPlayerController();
    controller.step(player, idleMovement, 0.05, camera, true);
    for (const delta of [0, -1, NaN, Infinity]) controller.step(player, { x: 1, z: 0, run: false }, delta, camera, true);
    expect(player).toEqual(before);
    controller.step(player, { x: 1, z: 0, run: false }, 10, camera, true);
    expect(player.x - before.x).toBeCloseTo(walkSpeed * 0.05);
  });
  it.each([60, 120, 144])('blocks the river but crosses the footbridge at %s Hz', hz => {
    const player = { ...createPlayerState(), x: 1, z: 1 }, controller = createPlayerController();
    const right = { x: 1, z: 0, run: true };
    for (let i = 0; i < hz; i++) controller.step(player, right, 1 / hz, camera, false);
    expect(player.x).toBeCloseTo(2 - playerRadius, 6);
    player.x = 1; player.z = -2.5;
    for (let i = 0; i < hz / 2; i++) controller.step(player, right, 1 / hz, camera, false);
    expect(player.x).toBeGreaterThan(3); expect(player.y).toBeCloseTo(0.4);
    for (let i = 0; i < hz / 2; i++) controller.step(player, right, 1 / hz, camera, false);
    expect(player.x).toBeGreaterThan(5.4); expect(player.y).toBeCloseTo(0.03);
  });
  it('blocks tents and island edges, and respects forest visibility', () => {
    const player = { ...createPlayerState(), x: -3.8, z: -4 }, controller = createPlayerController();
    for (let i = 0; i < 120; i++) controller.step(player, { x: 0, z: 1, run: true }, 1 / 60, camera, false);
    expect(player.z).toBeLessThan(-2.9);
    player.x = -9; player.z = 0;
    for (let i = 0; i < 120; i++) controller.step(player, { x: -1, z: 0, run: true }, 1 / 60, camera, false);
    expect(player.x).toBeCloseTo(-10 + playerRadius, 6);
    player.x = 7; player.z = -1.2;
    for (let i = 0; i < 60; i++) controller.step(player, { x: 0, z: 1, run: false }, 1 / 60, camera, true);
    expect(player.z).toBeLessThan(-0.4);
    for (let i = 0; i < 60; i++) controller.step(player, { x: 0, z: 1, run: false }, 1 / 60, camera, false);
    expect(player.z).toBeGreaterThan(1.5);
  });
  it('reuses collision shapes and scratch objects while walking', () => {
    const player = createPlayerState(), controller = createPlayerController();
    const constructors = ['Vector', 'Circle', 'Polygon', 'Box', 'Response'] as const;
    const spies = constructors.map(name => {
      const prototype = SAT[name].prototype, spy = vi.spyOn(SAT, name);
      // Preserve instanceof for the prebuilt shapes while observing constructors.
      Object.defineProperty(spy, 'prototype', { value: prototype });
      return spy;
    });
    try {
      for (let i = 0; i < 144; i++) controller.step(player, { x: 0, z: -1, run: true }, 1 / 144, camera, true);
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally { for (const spy of spies) spy.mockRestore(); }
  });
});
