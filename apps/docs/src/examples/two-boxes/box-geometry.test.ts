import { describe, expect, it } from 'vitest';
import { floorVertices, leftBoxVertices, rightBoxVertices } from './box-geometry';

const FLOATS_PER_VERTEX = 12;
const COLOR_OFFSET = 8;
const CHANNELS_PER_COLOR = 3;
const CUBE_VERTEX_COUNT = 36;
const TWO_BOXES_RANDOM_SEED = 0x6d2b79f5;

describe('two-boxes geometry', () => {
  it('packs position, normal, uv, and deterministic per-vertex colors', () => {
    expect(leftBoxVertices).toHaveLength(CUBE_VERTEX_COUNT * FLOATS_PER_VERTEX);
    expect(rightBoxVertices).toHaveLength(CUBE_VERTEX_COUNT * FLOATS_PER_VERTEX);
    expect(floorVertices).toHaveLength(6 * FLOATS_PER_VERTEX);

    expect(colorAt(leftBoxVertices, 0)).toEqual(expectedColor(0));
    expect(colorAt(leftBoxVertices, 1)).toEqual(expectedColor(1));
    expect(colorAt(rightBoxVertices, 0)).toEqual(expectedColor(CUBE_VERTEX_COUNT));
    expect(colorAt(floorVertices, 0)).toEqual(expectedColor(CUBE_VERTEX_COUNT * 2));

    expect(colorAt(leftBoxVertices, 0)).not.toEqual(colorAt(leftBoxVertices, 1));
    expect(colorAt(floorVertices, 0)).not.toEqual(colorAt(floorVertices, 1));
  });
});

function colorAt(vertices: Float32Array, vertexIndex: number): number[] {
  const start = vertexIndex * FLOATS_PER_VERTEX + COLOR_OFFSET;

  return Array.from(vertices.slice(start, start + 4));
}

function expectedColor(vertexIndex: number): number[] {
  const channelStart = vertexIndex * CHANNELS_PER_COLOR;

  return [
    pseudoRandomAt(channelStart),
    pseudoRandomAt(channelStart + 1),
    pseudoRandomAt(channelStart + 2),
    1
  ].map((value) => Math.fround(value));
}

function pseudoRandomAt(index: number): number {
  let state = TWO_BOXES_RANDOM_SEED;

  for (let current = 0; current <= index; current += 1) {
    state = (state + 0x6d2b79f5) | 0;
  }

  let value = Math.imul(state ^ (state >>> 15), 1 | state);
  value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);

  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
