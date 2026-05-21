import { numberArg, vectorTuple } from '../attributes';
import { findFirst, type TypeGpuNode } from '../core';
import type { TypeGpuCameraSettings } from '../types';

export const DEFAULT_CAMERA: TypeGpuCameraSettings = {
  position: [9, 7, 13],
  lookAt: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

export function readPerspectiveCamera(root: TypeGpuNode): TypeGpuCameraSettings {
  const camera = findFirst(root, (node) => node.name === 'perspectiveCamera');
  const attributes = camera?.attributes ?? {};

  return {
    position: vectorTuple(attributes.position, DEFAULT_CAMERA.position),
    lookAt: vectorTuple(attributes.lookAt, DEFAULT_CAMERA.lookAt),
    fov: numberArg(attributes.fov, DEFAULT_CAMERA.fov),
    near: numberArg(attributes.near, DEFAULT_CAMERA.near),
    far: numberArg(attributes.far, DEFAULT_CAMERA.far)
  };
}
