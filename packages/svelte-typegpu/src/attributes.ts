import type { RgbaTuple, Vector3Tuple } from './types';

export function vectorTuple(value: unknown, fallback: Vector3Tuple = [0, 0, 0]): Vector3Tuple {
  if (Array.isArray(value)) {
    return [
      numberArg(value[0], fallback[0]),
      numberArg(value[1], fallback[1]),
      numberArg(value[2], fallback[2])
    ];
  }

  if (value && typeof value === 'object') {
    const vector = value as { x?: unknown; y?: unknown; z?: unknown };
    return [
      numberArg(vector.x, fallback[0]),
      numberArg(vector.y, fallback[1]),
      numberArg(vector.z, fallback[2])
    ];
  }

  return fallback;
}

export function colorTuple(value: unknown): RgbaTuple {
  if (Array.isArray(value)) {
    return [
      numberArg(value[0], 1),
      numberArg(value[1], 1),
      numberArg(value[2], 1),
      numberArg(value[3], 1)
    ];
  }

  return [1, 1, 1, 1];
}

export function rgbTuple(value: unknown, fallback: Vector3Tuple = [1, 1, 1]): Vector3Tuple {
  if (Array.isArray(value)) {
    return [
      numberArg(value[0], fallback[0]),
      numberArg(value[1], fallback[1]),
      numberArg(value[2], fallback[2])
    ];
  }

  return fallback;
}

export function nonNegativeNumberArg(value: unknown, fallback: number): number {
  return Math.max(0, numberArg(value, fallback));
}

export function clampedNumberArg(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, numberArg(value, fallback)));
}

export function scaleTuple(value: unknown, fallback: Vector3Tuple = [1, 1, 1]): Vector3Tuple {
  const scalar = numberArg(value, Number.NaN);

  if (Number.isFinite(scalar)) {
    return [scalar, scalar, scalar];
  }

  return vectorTuple(value, fallback);
}

export function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function dimensionArg(value: unknown, fallback: number): number {
  const number = numberArg(value, fallback);
  return number > 0 ? number : fallback;
}
