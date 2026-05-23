import type { Vector3Tuple } from './types';
import { normalize3, rotateVectorXyz, subtract3 } from './math3d';

export const DEFAULT_LIGHT_DIRECTION: Vector3Tuple = [0, 0, -1];

export function normalizeVector(vector: Vector3Tuple, fallback: Vector3Tuple): Vector3Tuple {
  return normalize3(vector, fallback);
}

export function subtractVectors(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return subtract3(left, right);
}

export { rotateVectorXyz };
