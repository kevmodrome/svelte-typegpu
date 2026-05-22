import type { Vector3Tuple } from './types';

export const DEFAULT_LIGHT_DIRECTION: Vector3Tuple = [0, 0, -1];

export function normalizeVector(vector: Vector3Tuple, fallback: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);

  if (length <= 1e-6) {
    const fallbackLength = Math.hypot(fallback[0], fallback[1], fallback[2]);

    if (fallbackLength <= 1e-6) {
      return [...fallback];
    }

    return [
      fallback[0] / fallbackLength,
      fallback[1] / fallbackLength,
      fallback[2] / fallbackLength
    ];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function subtractVectors(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function rotateVectorXyz(vector: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple {
  const [sinX, cosX] = [Math.sin(rotation[0]), Math.cos(rotation[0])];
  const [sinY, cosY] = [Math.sin(rotation[1]), Math.cos(rotation[1])];
  const [sinZ, cosZ] = [Math.sin(rotation[2]), Math.cos(rotation[2])];

  const afterX: Vector3Tuple = [
    vector[0],
    vector[1] * cosX - vector[2] * sinX,
    vector[1] * sinX + vector[2] * cosX
  ];
  const afterY: Vector3Tuple = [
    afterX[0] * cosY + afterX[2] * sinY,
    afterX[1],
    -afterX[0] * sinY + afterX[2] * cosY
  ];

  return [
    afterY[0] * cosZ - afterY[1] * sinZ,
    afterY[0] * sinZ + afterY[1] * cosZ,
    afterY[2]
  ];
}
