import { clampCubeCount, createCubeField, type CubeInstance } from './cube-field';
import type { Vector3Tuple } from 'svelte-typegpu';

export interface QuadrantCubeInstance extends CubeInstance {
  colorOffset: number;
}

export interface CubeQuadrant {
  id: string;
  position: Vector3Tuple;
  scale: number;
  spinSpeed: number;
  phase: number;
  instances: QuadrantCubeInstance[];
}

interface CubeQuadrantConfig {
  id: string;
  signs: [number, number];
  scale: number;
  spinSpeed: number;
  phase: number;
  colorOffset: number;
}

const QUADRANT_ID_STEP = 1_000_000;
const CUBE_QUADRANTS: CubeQuadrantConfig[] = [
  { id: 'slow-small', signs: [-1, -1], scale: 0.7, spinSpeed: 0.35, phase: 0, colorOffset: 0 },
  { id: 'steady-base', signs: [1, -1], scale: 0.9, spinSpeed: 0.8, phase: 0.7, colorOffset: 24 },
  { id: 'brisk-wide', signs: [-1, 1], scale: 1.1, spinSpeed: 1.25, phase: 1.4, colorOffset: 48 },
  { id: 'fast-large', signs: [1, 1], scale: 1.3, spinSpeed: 1.75, phase: 2.1, colorOffset: 72 }
];

export function createCubeQuadrants(count: number, floorSize: number): CubeQuadrant[] {
  const counts = splitCubeCount(count, CUBE_QUADRANTS.length);
  const offset = Math.max(2.4, floorSize * 0.28);

  return CUBE_QUADRANTS.map((quadrant, index) => ({
    id: quadrant.id,
    position: [quadrant.signs[0] * offset, 0, quadrant.signs[1] * offset],
    scale: quadrant.scale,
    spinSpeed: quadrant.spinSpeed,
    phase: quadrant.phase,
    instances: createQuadrantInstances(counts[index], index, quadrant.colorOffset)
  }));
}

function splitCubeCount(count: number, parts: number): number[] {
  const safeCount = clampCubeCount(count);
  const baseCount = Math.floor(safeCount / parts);
  const remainder = safeCount % parts;

  return Array.from({ length: parts }, (_, index) => baseCount + (index < remainder ? 1 : 0));
}

function createQuadrantInstances(
  count: number,
  quadrantIndex: number,
  colorOffset: number
): QuadrantCubeInstance[] {
  if (count <= 0) return [];

  return createCubeField(count).map((box) => ({
    ...box,
    id: quadrantIndex * QUADRANT_ID_STEP + box.id,
    colorOffset
  }));
}
