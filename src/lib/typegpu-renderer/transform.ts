import { scaleTuple, vectorTuple } from './attributes';
import type { TypeGpuNode } from './core';
import type { TypeGpuTransform, Vector3Tuple } from './types';
import { rotateVectorXyz } from './vector-math';

type Matrix3 = [Vector3Tuple, Vector3Tuple, Vector3Tuple];

export const IDENTITY_TRANSFORM: TypeGpuTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1]
};

export function readLocalTransform(node: TypeGpuNode): TypeGpuTransform {
  return {
    position: vectorTuple(node.attributes.position),
    rotation: vectorTuple(node.attributes.rotation),
    scale: scaleTuple(node.attributes.scale)
  };
}

export function composeTransforms(
  parent: TypeGpuTransform,
  child: TypeGpuTransform
): TypeGpuTransform {
  const scaledPosition: Vector3Tuple = [
    child.position[0] * parent.scale[0],
    child.position[1] * parent.scale[1],
    child.position[2] * parent.scale[2]
  ];
  const rotatedPosition = rotateVectorXyz(scaledPosition, parent.rotation);

  return {
    position: [
      parent.position[0] + rotatedPosition[0],
      parent.position[1] + rotatedPosition[1],
      parent.position[2] + rotatedPosition[2]
    ],
    rotation: composeRotations(parent.rotation, child.rotation),
    scale: [
      parent.scale[0] * child.scale[0],
      parent.scale[1] * child.scale[1],
      parent.scale[2] * child.scale[2]
    ]
  };
}

function composeRotations(parent: Vector3Tuple, child: Vector3Tuple): Vector3Tuple {
  return matrixToEulerXyz(multiplyMatrices(eulerXyzToMatrix(parent), eulerXyzToMatrix(child)));
}

function eulerXyzToMatrix(rotation: Vector3Tuple): Matrix3 {
  const [sinX, cosX] = [Math.sin(rotation[0]), Math.cos(rotation[0])];
  const [sinY, cosY] = [Math.sin(rotation[1]), Math.cos(rotation[1])];
  const [sinZ, cosZ] = [Math.sin(rotation[2]), Math.cos(rotation[2])];

  return [
    [cosZ * cosY, cosZ * sinY * sinX - sinZ * cosX, cosZ * sinY * cosX + sinZ * sinX],
    [sinZ * cosY, sinZ * sinY * sinX + cosZ * cosX, sinZ * sinY * cosX - cosZ * sinX],
    [-sinY, cosY * sinX, cosY * cosX]
  ];
}

function multiplyMatrices(left: Matrix3, right: Matrix3): Matrix3 {
  return [
    [
      left[0][0] * right[0][0] + left[0][1] * right[1][0] + left[0][2] * right[2][0],
      left[0][0] * right[0][1] + left[0][1] * right[1][1] + left[0][2] * right[2][1],
      left[0][0] * right[0][2] + left[0][1] * right[1][2] + left[0][2] * right[2][2]
    ],
    [
      left[1][0] * right[0][0] + left[1][1] * right[1][0] + left[1][2] * right[2][0],
      left[1][0] * right[0][1] + left[1][1] * right[1][1] + left[1][2] * right[2][1],
      left[1][0] * right[0][2] + left[1][1] * right[1][2] + left[1][2] * right[2][2]
    ],
    [
      left[2][0] * right[0][0] + left[2][1] * right[1][0] + left[2][2] * right[2][0],
      left[2][0] * right[0][1] + left[2][1] * right[1][1] + left[2][2] * right[2][1],
      left[2][0] * right[0][2] + left[2][1] * right[1][2] + left[2][2] * right[2][2]
    ]
  ];
}

function matrixToEulerXyz(matrix: Matrix3): Vector3Tuple {
  const clampedSinY = Math.max(-1, Math.min(1, -matrix[2][0]));
  const y = Math.asin(clampedSinY);
  const cosY = Math.cos(y);

  if (Math.abs(cosY) > 1e-6) {
    return [
      normalizeZero(Math.atan2(matrix[2][1], matrix[2][2])),
      normalizeZero(y),
      normalizeZero(Math.atan2(matrix[1][0], matrix[0][0]))
    ];
  }

  return [
    normalizeZero(0),
    normalizeZero(y),
    normalizeZero(Math.atan2(-matrix[0][1], matrix[1][1]))
  ];
}

function normalizeZero(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}
