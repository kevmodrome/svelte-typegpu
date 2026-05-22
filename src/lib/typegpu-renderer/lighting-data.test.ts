import { describe, expect, it } from 'vitest';
import {
  MAX_TYPEGPU_LIGHTS,
  TYPEGPU_LIGHTING_BYTES,
  TYPEGPU_LIGHT_RECORD_BYTES
} from './typegpu-layouts';
import {
  packLightingState,
  TYPEGPU_LIGHT_COLOR_OFFSET,
  TYPEGPU_LIGHT_DIRECTION_OFFSET,
  TYPEGPU_LIGHT_FLAGS_OFFSET,
  TYPEGPU_LIGHT_HEADER_BYTES,
  TYPEGPU_LIGHT_KIND,
  TYPEGPU_LIGHT_KIND_NONE,
  TYPEGPU_LIGHT_KIND_OFFSET,
  TYPEGPU_LIGHT_PARAMS_OFFSET,
  TYPEGPU_LIGHT_POSITION_OFFSET,
  TYPEGPU_LIGHT_SECONDARY_COLOR_OFFSET,
  TYPEGPU_LIGHT_SHADOW_INDEX_OFFSET
} from './lighting-data';
import type { TypeGpuLight } from './types';

describe('TypeGPU lighting data packing', () => {
  it('packs light count and light records into a mixed u32/f32 ArrayBuffer', () => {
    const buffer = packLightingState([
      light({
        kind: 'point',
        position: [2, 3, 4],
        direction: [0.25, -0.5, -1],
        color: [1, 0.5, 0.25],
        intensity: 6,
        range: 12,
        decay: 2,
        angle: Math.PI / 4,
        penumbra: 0.25,
        castsShadow: true,
        shadowIndex: 3
      }),
      light({
        kind: 'hemisphere',
        color: [0.5, 0.6, 0.7],
        groundColor: [0.1, 0.08, 0.04],
        intensity: 0.5
      })
    ]);
    const view = new DataView(buffer);
    const f32 = Float32Array.BYTES_PER_ELEMENT;
    const firstOffset = TYPEGPU_LIGHT_HEADER_BYTES;
    const secondOffset = firstOffset + TYPEGPU_LIGHT_RECORD_BYTES;
    const thirdOffset = secondOffset + TYPEGPU_LIGHT_RECORD_BYTES;

    expect(buffer.byteLength).toBe(TYPEGPU_LIGHTING_BYTES);
    expect(view.getUint32(0, true)).toBe(2);
    expect(view.getUint32(firstOffset + TYPEGPU_LIGHT_KIND_OFFSET, true)).toBe(
      TYPEGPU_LIGHT_KIND.point
    );
    expect(view.getUint32(firstOffset + TYPEGPU_LIGHT_FLAGS_OFFSET, true)).toBe(1);
    expect(view.getUint32(firstOffset + TYPEGPU_LIGHT_SHADOW_INDEX_OFFSET, true)).toBe(3);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_POSITION_OFFSET, true)).toBeCloseTo(2);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_POSITION_OFFSET + f32, true)).toBeCloseTo(3);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_POSITION_OFFSET + 2 * f32, true)).toBeCloseTo(4);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_POSITION_OFFSET + 3 * f32, true)).toBeCloseTo(12);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_DIRECTION_OFFSET, true)).toBeCloseTo(0.25);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_DIRECTION_OFFSET + f32, true)).toBeCloseTo(-0.5);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_DIRECTION_OFFSET + 2 * f32, true)).toBeCloseTo(-1);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_DIRECTION_OFFSET + 3 * f32, true)).toBeCloseTo(
      Math.PI / 4
    );
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_COLOR_OFFSET, true)).toBeCloseTo(1);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_COLOR_OFFSET + f32, true)).toBeCloseTo(0.5);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_COLOR_OFFSET + 2 * f32, true)).toBeCloseTo(0.25);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_COLOR_OFFSET + 3 * f32, true)).toBeCloseTo(6);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_PARAMS_OFFSET, true)).toBeCloseTo(2);
    expect(view.getFloat32(firstOffset + TYPEGPU_LIGHT_PARAMS_OFFSET + f32, true)).toBeCloseTo(0.25);

    expect(view.getUint32(secondOffset + TYPEGPU_LIGHT_KIND_OFFSET, true)).toBe(
      TYPEGPU_LIGHT_KIND.hemisphere
    );
    expect(view.getFloat32(secondOffset + TYPEGPU_LIGHT_SECONDARY_COLOR_OFFSET, true)).toBeCloseTo(
      0.1
    );
    expect(
      view.getFloat32(secondOffset + TYPEGPU_LIGHT_SECONDARY_COLOR_OFFSET + f32, true)
    ).toBeCloseTo(0.08);
    expect(
      view.getFloat32(secondOffset + TYPEGPU_LIGHT_SECONDARY_COLOR_OFFSET + 2 * f32, true)
    ).toBeCloseTo(0.04);
    expect(view.getUint32(thirdOffset + TYPEGPU_LIGHT_KIND_OFFSET, true)).toBe(
      TYPEGPU_LIGHT_KIND_NONE
    );
  });

  it('caps packed light count to the TypeGPU lighting capacity', () => {
    const lights = Array.from({ length: MAX_TYPEGPU_LIGHTS + 1 }, (_, index) =>
      light({ id: index + 1 })
    );
    const buffer = packLightingState(lights);
    const view = new DataView(buffer);

    expect(view.getUint32(0, true)).toBe(MAX_TYPEGPU_LIGHTS);
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
