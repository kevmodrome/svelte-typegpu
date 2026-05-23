import { scaleTuple, vectorTuple } from './attributes';
import type { TypeGpuTransform, Vector3Tuple } from './types';

type Matrix3 = [Vector3Tuple, Vector3Tuple, Vector3Tuple];

export const IDENTITY_TRANSFORM: TypeGpuTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1]
};

export function add3(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] + right[0], left[1] + right[1], left[2] + right[2]];
}

export function subtract3(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function multiply3(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] * right[0], left[1] * right[1], left[2] * right[2]];
}

export function scale3(vector: Vector3Tuple, scale: number): Vector3Tuple {
  return [vector[0] * scale, vector[1] * scale, vector[2] * scale];
}

export function dot3(left: Vector3Tuple, right: Vector3Tuple): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}

export function cross3(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

export function length3(vector: Vector3Tuple): number {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

export function normalize3(vector: Vector3Tuple, fallback: Vector3Tuple = [0, 0, 0]): Vector3Tuple {
  const length = length3(vector);

  if (length <= 1e-6) {
    const fallbackLength = length3(fallback);
    return fallbackLength <= 1e-6 ? [...fallback] : scale3(fallback, 1 / fallbackLength);
  }

  return scale3(vector, 1 / length);
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

export function composeTransforms(
  parent: TypeGpuTransform,
  child: TypeGpuTransform
): TypeGpuTransform {
  const scaledPosition = multiply3(child.position, parent.scale);
  const rotatedPosition = rotateVectorXyz(scaledPosition, parent.rotation);

  return {
    position: add3(parent.position, rotatedPosition),
    rotation: composeRotations(parent.rotation, child.rotation),
    scale: multiply3(parent.scale, child.scale)
  };
}

export function readTransformAttributes(attributes: Record<string, unknown>): TypeGpuTransform {
  return {
    position: vectorTuple(attributes.position),
    rotation: vectorTuple(attributes.rotation),
    scale: scaleTuple(attributes.scale)
  };
}

export function lookAtMatrix(
  eye: Vector3Tuple,
  center: Vector3Tuple,
  up: Vector3Tuple = [0, 1, 0]
): Float32Array {
  const z = normalize3(subtract3(eye, center), [0, 0, 1]);
  const x = normalize3(cross3(up, z), [1, 0, 0]);
  const y = cross3(z, x);
  const matrix = new Float32Array(16);

  matrix[0] = x[0];
  matrix[1] = y[0];
  matrix[2] = z[0];
  matrix[4] = x[1];
  matrix[5] = y[1];
  matrix[6] = z[1];
  matrix[8] = x[2];
  matrix[9] = y[2];
  matrix[10] = z[2];
  matrix[12] = -dot3(x, eye);
  matrix[13] = -dot3(y, eye);
  matrix[14] = -dot3(z, eye);
  matrix[15] = 1;

  return matrix;
}

export function perspectiveMatrix(
  fovyRadians: number,
  aspect: number,
  near: number,
  far: number
): Float32Array {
  const f = 1 / Math.tan(fovyRadians / 2);
  const matrix = new Float32Array(16);

  matrix[0] = f / aspect;
  matrix[5] = f;
  matrix[10] = (far + near) / (near - far);
  matrix[11] = -1;
  matrix[14] = (2 * far * near) / (near - far);

  return matrix;
}

export function orthographicMatrix(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number
): Float32Array {
  const matrix = new Float32Array(16);

  matrix[0] = 2 / (right - left);
  matrix[5] = 2 / (top - bottom);
  matrix[10] = -2 / (far - near);
  matrix[12] = -(right + left) / (right - left);
  matrix[13] = -(top + bottom) / (top - bottom);
  matrix[14] = -(far + near) / (far - near);
  matrix[15] = 1;

  return matrix;
}

export function multiply4(left: Float32Array, right: Float32Array): Float32Array {
  const out = new Float32Array(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      out[column * 4 + row] =
        left[row] * right[column * 4] +
        left[4 + row] * right[column * 4 + 1] +
        left[8 + row] * right[column * 4 + 2] +
        left[12 + row] * right[column * 4 + 3];
    }
  }

  return out;
}

export function invert4(matrix: Float32Array): Float32Array | null {
  const out = new Float32Array(16);
  const m = matrix;
  const b00 = m[0] * m[5] - m[1] * m[4];
  const b01 = m[0] * m[9] - m[1] * m[8];
  const b02 = m[0] * m[13] - m[1] * m[12];
  const b03 = m[4] * m[9] - m[5] * m[8];
  const b04 = m[4] * m[13] - m[5] * m[12];
  const b05 = m[8] * m[13] - m[9] * m[12];
  const b06 = m[2] * m[7] - m[3] * m[6];
  const b07 = m[2] * m[11] - m[3] * m[10];
  const b08 = m[2] * m[15] - m[3] * m[14];
  const b09 = m[6] * m[11] - m[7] * m[10];
  const b10 = m[6] * m[15] - m[7] * m[14];
  const b11 = m[10] * m[15] - m[11] * m[14];
  const det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;

  if (Math.abs(det) <= 1e-12) {
    return null;
  }

  const invDet = 1 / det;
  out[0] = (m[5] * b11 - m[9] * b10 + m[13] * b09) * invDet;
  out[1] = (m[9] * b08 - m[1] * b11 - m[13] * b07) * invDet;
  out[2] = (m[1] * b10 - m[5] * b08 + m[13] * b06) * invDet;
  out[3] = (m[5] * b07 - m[1] * b09 - m[9] * b06) * invDet;
  out[4] = (m[8] * b10 - m[4] * b11 - m[12] * b09) * invDet;
  out[5] = (m[0] * b11 - m[8] * b08 + m[12] * b07) * invDet;
  out[6] = (m[4] * b08 - m[0] * b10 - m[12] * b06) * invDet;
  out[7] = (m[0] * b09 - m[4] * b07 + m[8] * b06) * invDet;
  out[8] = (m[7] * b05 - m[11] * b04 + m[15] * b03) * invDet;
  out[9] = (m[11] * b02 - m[3] * b05 - m[15] * b01) * invDet;
  out[10] = (m[3] * b04 - m[7] * b02 + m[15] * b00) * invDet;
  out[11] = (m[7] * b01 - m[3] * b03 - m[11] * b00) * invDet;
  out[12] = (m[10] * b04 - m[6] * b05 - m[14] * b03) * invDet;
  out[13] = (m[2] * b05 - m[10] * b02 + m[14] * b01) * invDet;
  out[14] = (m[6] * b02 - m[2] * b04 - m[14] * b00) * invDet;
  out[15] = (m[2] * b03 - m[6] * b01 + m[10] * b00) * invDet;

  return out;
}

export function transformPoint4(matrix: Float32Array, point: Vector3Tuple): Vector3Tuple {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

  if (!Number.isFinite(w) || Math.abs(w) <= 1e-12) {
    throw new Error('Cannot transform point with near-zero homogeneous coordinate');
  }

  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
  ];
}

export function transformDirection4(matrix: Float32Array, direction: Vector3Tuple): Vector3Tuple {
  const x = direction[0];
  const y = direction[1];
  const z = direction[2];

  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z,
    matrix[1] * x + matrix[5] * y + matrix[9] * z,
    matrix[2] * x + matrix[6] * y + matrix[10] * z
  ];
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
