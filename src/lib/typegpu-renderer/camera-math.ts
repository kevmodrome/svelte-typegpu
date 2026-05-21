import type { TypeGpuCameraSettings } from './types';

export function createViewProjectionMatrix(
  aspect: number,
  camera: TypeGpuCameraSettings = defaultCameraSettings()
): Float32Array {
  return multiplyMatrices(
    perspectiveMatrix((camera.fov * Math.PI) / 180, aspect, camera.near, camera.far),
    lookAtMatrix(camera.position, camera.lookAt, [0, 1, 0])
  );
}

function defaultCameraSettings(): TypeGpuCameraSettings {
  return {
    position: [9, 7, 13],
    lookAt: [0, 0, 0],
    fov: 45,
    near: 0.1,
    far: 100
  };
}

function perspectiveMatrix(fovy: number, aspect: number, near: number, far: number): Float32Array {
  const f = 1 / Math.tan(fovy / 2);
  const matrix = new Float32Array(16);

  matrix[0] = f / aspect;
  matrix[5] = f;
  matrix[10] = (far + near) / (near - far);
  matrix[11] = -1;
  matrix[14] = (2 * far * near) / (near - far);

  return matrix;
}

function lookAtMatrix(
  eye: [number, number, number],
  center: [number, number, number],
  up: [number, number, number]
): Float32Array {
  const z = normalize([eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]);
  const x = normalize(cross(up, z));
  const y = cross(z, x);
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
  matrix[12] = -dot(x, eye);
  matrix[13] = -dot(y, eye);
  matrix[14] = -dot(z, eye);
  matrix[15] = 1;

  return matrix;
}

function multiplyMatrices(left: Float32Array, right: Float32Array): Float32Array {
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

function normalize(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector) || 1;
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function cross(
  left: [number, number, number],
  right: [number, number, number]
): [number, number, number] {
  return [
    left[1] * right[2] - left[2] * right[1],
    left[2] * right[0] - left[0] * right[2],
    left[0] * right[1] - left[1] * right[0]
  ];
}

function dot(left: [number, number, number], right: [number, number, number]): number {
  return left[0] * right[0] + left[1] * right[1] + left[2] * right[2];
}
