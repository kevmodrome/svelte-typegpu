import {
  add3,
  multiply3,
  rotateVectorXyz,
  scale3
} from './math3d';
import type { TypeGpuBounds, TypeGpuRay, TypeGpuTransform, Vector3Tuple } from './types';

export function boxBounds(size: Vector3Tuple): TypeGpuBounds {
  return centeredBounds(size);
}

// Planes use the existing primitive size tuple: [width, depth, unused].
export function planeBounds(size: Vector3Tuple): TypeGpuBounds {
  return {
    min: [-size[0] / 2, 0, -size[1] / 2],
    max: [size[0] / 2, 0, size[1] / 2]
  };
}

export function sphereBounds(size: Vector3Tuple): TypeGpuBounds {
  return centeredBounds(size);
}

export function transformBounds(bounds: TypeGpuBounds, transform: TypeGpuTransform): TypeGpuBounds {
  const corners = [
    [bounds.min[0], bounds.min[1], bounds.min[2]],
    [bounds.max[0], bounds.min[1], bounds.min[2]],
    [bounds.min[0], bounds.max[1], bounds.min[2]],
    [bounds.max[0], bounds.max[1], bounds.min[2]],
    [bounds.min[0], bounds.min[1], bounds.max[2]],
    [bounds.max[0], bounds.min[1], bounds.max[2]],
    [bounds.min[0], bounds.max[1], bounds.max[2]],
    [bounds.max[0], bounds.max[1], bounds.max[2]]
  ] as Vector3Tuple[];
  const transformed = corners.map((corner) =>
    add3(rotateVectorXyz(multiply3(corner, transform.scale), transform.rotation), transform.position)
  );

  return transformed.reduce<TypeGpuBounds>(
    (next, point) => ({
      min: [
        Math.min(next.min[0], point[0]),
        Math.min(next.min[1], point[1]),
        Math.min(next.min[2], point[2])
      ],
      max: [
        Math.max(next.max[0], point[0]),
        Math.max(next.max[1], point[1]),
        Math.max(next.max[2], point[2])
      ]
    }),
    { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  );
}

export function rayIntersectsBounds(
  ray: TypeGpuRay,
  bounds: TypeGpuBounds
): { distance: number; point: Vector3Tuple } | null {
  let near = -Infinity;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis += 1) {
    const origin = ray.origin[axis];
    const direction = ray.direction[axis];

    if (Math.abs(direction) <= 1e-12) {
      if (origin < bounds.min[axis] || origin > bounds.max[axis]) {
        return null;
      }
      continue;
    }

    const first = (bounds.min[axis] - origin) / direction;
    const second = (bounds.max[axis] - origin) / direction;
    const axisNear = Math.min(first, second);
    const axisFar = Math.max(first, second);

    near = Math.max(near, axisNear);
    far = Math.min(far, axisFar);

    if (near > far) {
      return null;
    }
  }

  const distance = near >= 0 ? near : far >= 0 ? far : null;

  if (distance === null) {
    return null;
  }

  return {
    distance,
    point: add3(ray.origin, scale3(ray.direction, distance))
  };
}

function centeredBounds(size: Vector3Tuple): TypeGpuBounds {
  return {
    min: [-size[0] / 2, -size[1] / 2, -size[2] / 2],
    max: [size[0] / 2, size[1] / 2, size[2] / 2]
  };
}
