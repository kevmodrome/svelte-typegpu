import { normalizeCameraSettings } from './camera';
import { lookAtMatrix, normalize3 } from './math3d';
import type { TypeGpuCameraSettings, TypeGpuLight, Vector3Tuple } from './types';

type Bounds = { min: Vector3Tuple; max: Vector3Tuple };

export function shadowCameraDepth(camera: TypeGpuCameraSettings, out: Float32Array, offset = 0): void {
  const { position, target } = normalizeCameraSettings(camera);
  const forward = normalize3([target[0] - position[0], target[1] - position[1], target[2] - position[2]], [0, 0, -1]);
  out.set(forward, offset);
  out[offset + 3] = -(forward[0] * position[0] + forward[1] * position[1] + forward[2] * position[2]);
}

export function localShadowDistance(light: TypeGpuLight, camera: TypeGpuCameraSettings): number {
  if (!(light.shadowDistance! > 0) || !Number.isFinite(light.shadowDistance)) return 0;
  return Math.min(light.shadowDistance!, normalizeCameraSettings(camera).far);
}

/** Camera receivers define XY; all retained scene bounds extend Z toward offscreen casters. */
export function createLocalShadowMatrix(light: TypeGpuLight, input: TypeGpuCameraSettings, aspect: number, bounds: Bounds | null): Float32Array {
  const camera = normalizeCameraSettings(input);
  const far = Math.max(camera.near, localShadowDistance(light, camera));
  const middle = (camera.near + far) / 2;
  const forward = normalize3([camera.target[0] - camera.position[0], camera.target[1] - camera.position[1], camera.target[2] - camera.position[2]], [0, 0, -1]);
  const center = camera.position.map((value, axis) => value + forward[axis] * middle);
  const halfHeight = camera.projection === 'perspective' ? far * Math.tan(camera.fov * Math.PI / 360) : 1 / Math.max(0.0001, camera.zoom);
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  // A sphere keeps map scale invariant under camera rotation. Reserve a texel for snapping/PCF.
  const radius = Math.max(0.01, Math.hypot(halfHeight, halfHeight * safeAspect, (far - camera.near) / 2)) /
    (1 - 2 / Math.max(4, light.shadowMapSize));
  const direction = normalize3(light.direction, [0, -1, 0]);
  const view = lookAtMatrix([0, 0, 0], direction, Math.abs(direction[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1]);
  const lightCenter = [0, 1, 2].map(row => view[row] * center[0] + view[row + 4] * center[1] + view[row + 8] * center[2]);
  const texel = 2 * radius / light.shadowMapSize;
  let minZ = lightCenter[2] - radius, maxZ = lightCenter[2] + radius;
  if (bounds) {
    let lower = 0, upper = 0;
    for (let axis = 0; axis < 3; axis++) {
      const value = view[axis * 4 + 2];
      lower += value * (value >= 0 ? bounds.min[axis] : bounds.max[axis]);
      upper += value * (value >= 0 ? bounds.max[axis] : bounds.min[axis]);
    }
    minZ = Math.min(minZ, lower); maxZ = Math.max(maxZ, upper);
  }
  minZ -= 1; maxZ += 1;
  const matrix = new Float32Array(16);
  for (let axis = 0; axis < 3; axis++) {
    matrix[axis * 4] = view[axis * 4] / radius;
    matrix[axis * 4 + 1] = view[axis * 4 + 1] / radius;
    matrix[axis * 4 + 2] = -view[axis * 4 + 2] / (maxZ - minZ);
  }
  matrix[12] = -Math.round(lightCenter[0] / texel) * texel / radius;
  matrix[13] = -Math.round(lightCenter[1] / texel) * texel / radius;
  matrix[14] = maxZ / (maxZ - minZ);
  matrix[15] = 1;
  return matrix;
}
