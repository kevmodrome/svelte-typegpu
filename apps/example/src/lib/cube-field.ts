export const CUBE_COUNT_PRESETS = [1, 1_000, 10_000] as const;
export const MAX_CUBE_COUNT = 10_000;

export interface CubeInstance {
  id: number;
  position: [number, number, number];
  phase: number;
}

export interface SceneCameraSettings {
  position: [number, number, number];
  target: [number, number, number];
  floorSize: number;
  cubeSize: number;
}

const GRID_SPACING = 0.56;

export function clampCubeCount(count: number): number {
  return Math.min(MAX_CUBE_COUNT, Math.max(1, Math.round(count)));
}

export function createCubeField(count: number): CubeInstance[] {
  const safeCount = clampCubeCount(count);

  if (safeCount === 1) {
    return [{ id: 0, position: [0, 0, 0], phase: 0 }];
  }

  const side = Math.ceil(Math.cbrt(safeCount));
  const center = (side - 1) / 2;

  return Array.from({ length: safeCount }, (_, id) => {
    const x = id % side;
    const y = Math.floor(id / side) % side;
    const z = Math.floor(id / (side * side));

    return {
      id,
      position: [
        roundGrid((x - center) * GRID_SPACING),
        roundGrid((y - center) * GRID_SPACING),
        roundGrid((z - center) * GRID_SPACING)
      ],
      phase: roundPhase(id * 0.1)
    };
  });
}

export function sceneCameraForCount(count: number): SceneCameraSettings {
  if (clampCubeCount(count) === 1) {
    return {
      position: [0, 1.4, 5],
      target: [0, 0, 0],
      floorSize: 6,
      cubeSize: 1.5
    };
  }

  return {
    position: [9, 7, 13],
    target: [0, 0, 0],
    floorSize: 18,
    cubeSize: 0.24
  };
}

function roundGrid(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundPhase(value: number): number {
  return Math.round(value * 10) / 10;
}
