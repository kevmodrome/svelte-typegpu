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

export function numberArg(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function dimensionArg(value: unknown, fallback: number): number {
  const number = numberArg(value, fallback);
  return number > 0 ? number : fallback;
}
