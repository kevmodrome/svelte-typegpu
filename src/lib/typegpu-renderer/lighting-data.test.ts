import { describe, expect, it } from 'vitest';
import { TYPEGPU_LIGHT_RECORD_BYTES } from './typegpu-layouts';
import { packLightingState, TYPEGPU_LIGHT_KIND } from './lighting-data';
import type { TypeGpuLight } from './types';

describe('TypeGPU lighting data packing', () => {
  it('packs light count and light records into a mixed u32/f32 ArrayBuffer', () => {
    const buffer = packLightingState([
      light({
        kind: 'point',
        position: [2, 3, 4],
        color: [1, 0.5, 0.25],
        intensity: 6,
        range: 12,
        decay: 2
      }),
      light({
        kind: 'hemisphere',
        color: [0.5, 0.6, 0.7],
        groundColor: [0.1, 0.08, 0.04],
        intensity: 0.5
      })
    ]);
    const view = new DataView(buffer);
    const firstOffset = 16;
    const secondOffset = firstOffset + TYPEGPU_LIGHT_RECORD_BYTES;

    expect(view.getUint32(0, true)).toBe(2);
    expect(view.getUint32(firstOffset, true)).toBe(TYPEGPU_LIGHT_KIND.point);
    expect(view.getFloat32(firstOffset + 16, true)).toBeCloseTo(2);
    expect(view.getFloat32(firstOffset + 20, true)).toBeCloseTo(3);
    expect(view.getFloat32(firstOffset + 24, true)).toBeCloseTo(4);
    expect(view.getFloat32(firstOffset + 28, true)).toBeCloseTo(12);
    expect(view.getFloat32(firstOffset + 48, true)).toBeCloseTo(1);
    expect(view.getFloat32(firstOffset + 52, true)).toBeCloseTo(0.5);
    expect(view.getFloat32(firstOffset + 56, true)).toBeCloseTo(0.25);
    expect(view.getFloat32(firstOffset + 60, true)).toBeCloseTo(6);
    expect(view.getFloat32(firstOffset + 84, true)).toBeCloseTo(2);

    expect(view.getUint32(secondOffset, true)).toBe(TYPEGPU_LIGHT_KIND.hemisphere);
    expect(view.getFloat32(secondOffset + 64, true)).toBeCloseTo(0.1);
    expect(view.getFloat32(secondOffset + 68, true)).toBeCloseTo(0.08);
    expect(view.getFloat32(secondOffset + 72, true)).toBeCloseTo(0.04);
  });
});

function light(overrides: Partial<TypeGpuLight>): TypeGpuLight {
  return {
    id: 1,
    revision: 1,
    kind: 'ambient',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 0, 0],
    direction: [0, 0, -1],
    range: 0,
    decay: 2,
    angle: Math.PI / 6,
    penumbra: 0,
    groundColor: [0, 0, 0],
    castsShadow: false,
    shadowIndex: -1,
    ...overrides
  };
}
