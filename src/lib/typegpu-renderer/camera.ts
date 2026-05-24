import { clampedNumberArg, numberArg, vectorTuple } from './attributes';
import { findFirst, type TypeGpuNode } from './core';
import { readLegacyPerspectiveCameraControllerState } from './legacy-camera';
import {
  add3,
  cross3,
  invert4,
  lookAtMatrix,
  multiply4,
  normalize3,
  orthographicMatrix,
  perspectiveMatrix,
  scale3,
  subtract3,
  transformPoint4
} from './math3d';
import type {
  TypeGpuCameraController,
  TypeGpuCameraSettings,
  TypeGpuCameraState,
  TypeGpuNormalizedCameraSettings,
  TypeGpuOrbitCameraController,
  TypeGpuRay,
  Vector3Tuple
} from './types';

export const DEFAULT_CAMERA: TypeGpuNormalizedCameraSettings = {
  projection: 'perspective',
  position: [9, 7, 13],
  target: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 100;

export function readCameraState(root: TypeGpuNode): TypeGpuCameraState {
  const camera = findActiveCamera(root);
  const orbitControllerNode = findFirst(root, (node) => node.name === 'orbitControls');
  const legacyState =
    camera?.name === 'perspectiveCamera'
      ? readLegacyPerspectiveCameraControllerState(camera)
      : null;
  const controllerNode = orbitControllerNode ?? legacyState?.controllerNode ?? null;

  return {
    node: camera,
    settings: camera ? readCameraSettings(camera) : DEFAULT_CAMERA,
    controllerNode,
    controller: orbitControllerNode
      ? readOrbitController(orbitControllerNode)
      : legacyState?.controller ?? null
  };
}

export function createViewProjectionMatrix(
  aspect: number,
  camera: TypeGpuCameraSettings = DEFAULT_CAMERA
): Float32Array {
  const normalizedCamera = normalizeCameraSettings(camera);
  const normalizedAspect = isFinitePositive(aspect) ? aspect : 1;
  const view = lookAtMatrix(normalizedCamera.position, normalizedCamera.target, [0, 1, 0]);
  const projection =
    normalizedCamera.projection === 'orthographic'
      ? createOrthographicProjection(
          normalizedAspect,
          normalizedCamera.zoom,
          normalizedCamera.near,
          normalizedCamera.far
        )
      : perspectiveMatrix(
          (normalizedCamera.fov * Math.PI) / 180,
          normalizedAspect,
          normalizedCamera.near,
          normalizedCamera.far
        );

  return multiply4(projection, view);
}

export function cameraRayFromViewport(input: {
  x: number;
  y: number;
  viewport: { width: number; height: number };
  camera: TypeGpuCameraSettings;
}): TypeGpuRay {
  if (!isFinitePositive(input.viewport.width) || !isFinitePositive(input.viewport.height)) {
    throw new Error('Viewport dimensions must be finite positive numbers');
  }

  const camera = normalizeCameraSettings(input.camera);
  const ndcX = (input.x / input.viewport.width) * 2 - 1;
  const ndcY = 1 - (input.y / input.viewport.height) * 2;

  if (camera.projection === 'orthographic') {
    const inverseViewProjection = invert4(
      createViewProjectionMatrix(input.viewport.width / input.viewport.height, camera)
    );
    if (!inverseViewProjection) {
      throw new Error('Camera view-projection matrix is not invertible');
    }
    const origin = transformPoint4(inverseViewProjection, [ndcX, ndcY, -1]);
    const direction = normalize3(subtract3(camera.target, camera.position), [0, 0, -1]);

    return { origin, direction };
  }

  const forward = normalize3(subtract3(camera.target, camera.position), [0, 0, -1]);
  const right = normalize3(cross3(forward, [0, 1, 0]), [1, 0, 0]);
  const up = normalize3(cross3(right, forward), [0, 1, 0]);
  const aspect = input.viewport.width / input.viewport.height;
  const halfHeight = Math.tan((camera.fov * Math.PI) / 360);
  const halfWidth = halfHeight * aspect;
  const direction = normalize3(
    add3(add3(forward, scale3(right, ndcX * halfWidth)), scale3(up, ndcY * halfHeight)),
    forward
  );

  return {
    origin: [...camera.position],
    direction
  };
}

export function normalizeCameraSettings(
  camera: TypeGpuCameraSettings = DEFAULT_CAMERA
): TypeGpuNormalizedCameraSettings {
  const [near, far] = normalizeClipPlanes(camera.near, camera.far);

  if (camera.projection === 'orthographic') {
    return {
      projection: 'orthographic',
      position: vectorTuple(camera.position, DEFAULT_CAMERA.position),
      target: vectorTuple(camera.target, DEFAULT_CAMERA.target),
      zoom: isFinitePositive(camera.zoom) ? camera.zoom : 1,
      near,
      far
    };
  }

  return {
    projection: 'perspective',
    position: vectorTuple(camera.position, DEFAULT_CAMERA.position),
    target: vectorTuple(camera.target, DEFAULT_CAMERA.target),
    fov: Number.isFinite(camera.fov) && camera.fov > 0 && camera.fov < 180 ? camera.fov : 45,
    near,
    far
  };
}

function findActiveCamera(root: TypeGpuNode): TypeGpuNode | null {
  let firstCamera: TypeGpuNode | null = null;
  let activeCamera: TypeGpuNode | null = null;

  walk(root, (node) => {
    if (node.name !== 'perspectiveCamera' && node.name !== 'orthographicCamera') return;

    firstCamera ??= node;
    if (node.attributes.active === true) {
      activeCamera ??= node;
    }
  });

  return activeCamera ?? firstCamera;
}

function readCameraSettings(node: TypeGpuNode): TypeGpuNormalizedCameraSettings {
  if (node.name === 'orthographicCamera') {
    return normalizeCameraSettings({
      projection: 'orthographic',
      position: vectorTuple(node.attributes.position, DEFAULT_CAMERA.position),
      target: vectorTuple(node.attributes.target, DEFAULT_CAMERA.target),
      zoom: numberArg(node.attributes.zoom, 1),
      near: numberArg(node.attributes.near, DEFAULT_CAMERA.near),
      far: numberArg(node.attributes.far, DEFAULT_CAMERA.far)
    });
  }

  const pose = firstChildNamed(node, 'cameraPose');
  const lens = firstChildNamed(node, 'cameraLens');
  const poseAttributes = pose?.attributes ?? node.attributes;
  const lensAttributes = lens?.attributes ?? node.attributes;
  const position = vectorTuple(poseAttributes.position, DEFAULT_CAMERA.position);
  const target = vectorTuple(poseAttributes.target, DEFAULT_CAMERA.target);

  return normalizeCameraSettings({
    projection: 'perspective',
    position,
    target,
    fov: numberArg(lensAttributes.fov, 45),
    near: numberArg(lensAttributes.near, DEFAULT_CAMERA.near),
    far: numberArg(lensAttributes.far, DEFAULT_CAMERA.far)
  });
}

function readOrbitController(node: TypeGpuNode): TypeGpuCameraController {
  const minDistance = clampedNumberArg(
    node.attributes.minDistance,
    DEFAULT_MIN_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );
  const maxDistance = clampedNumberArg(
    node.attributes.maxDistance,
    DEFAULT_MAX_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );
  const controller: TypeGpuOrbitCameraController = {
    kind: 'orbit',
    camera: stringOrNull(node.attributes.camera),
    enabled: node.attributes.enabled !== false,
    target: vectorTuple(node.attributes.target, DEFAULT_CAMERA.target),
    minDistance: minDistance <= maxDistance ? minDistance : DEFAULT_MIN_DISTANCE,
    maxDistance: minDistance <= maxDistance ? maxDistance : DEFAULT_MAX_DISTANCE,
    enablePan: node.attributes.enablePan !== false,
    enableZoom: node.attributes.enableZoom !== false,
    enableRotate: node.attributes.enableRotate !== false,
    rotateSpeed: clampedNumberArg(node.attributes.rotateSpeed, 1, 0, 100),
    zoomSpeed: clampedNumberArg(node.attributes.zoomSpeed, 1, 0, 100)
  };

  return controller;
}

function createOrthographicProjection(
  aspect: number,
  zoom: number,
  near: number,
  far: number
): Float32Array {
  const safeZoom = Math.max(0.0001, zoom);
  const halfHeight = 1 / safeZoom;
  const halfWidth = halfHeight * aspect;

  return orthographicMatrix(-halfWidth, halfWidth, -halfHeight, halfHeight, near, far);
}

function walk(node: TypeGpuNode, visit: (node: TypeGpuNode) => void): void {
  visit(node);
  for (let child = node.firstChild; child; child = child.nextSibling) {
    walk(child, visit);
  }
}

function firstChildNamed(node: TypeGpuNode, name: string): TypeGpuNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }

  return null;
}

function isFinitePositive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function normalizeClipPlanes(near: number, far: number): [number, number] {
  if (isFinitePositive(near) && Number.isFinite(far) && far > near) {
    return [near, far];
  }

  return [DEFAULT_CAMERA.near, DEFAULT_CAMERA.far];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
