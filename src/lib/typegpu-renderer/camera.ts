import { clampedNumberArg, numberArg, vectorTuple } from './attributes';
import { findFirst, type TypeGpuNode } from './core';
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
  TypeGpuOrbitCameraController,
  TypeGpuRay,
  Vector3Tuple
} from './types';

export const DEFAULT_CAMERA: TypeGpuCameraSettings = {
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
  const controllerNode = findFirst(root, (node) => node.name === 'orbitControls');

  return {
    node: camera,
    settings: camera ? readCameraSettings(camera) : DEFAULT_CAMERA,
    controllerNode,
    controller: controllerNode ? readOrbitController(controllerNode) : null
  };
}

export function createViewProjectionMatrix(
  aspect: number,
  camera: TypeGpuCameraSettings = DEFAULT_CAMERA
): Float32Array {
  const view = lookAtMatrix(camera.position, camera.target, [0, 1, 0]);
  const projection =
    camera.projection === 'orthographic'
      ? createOrthographicProjection(aspect, camera.zoom, camera.near, camera.far)
      : perspectiveMatrix((camera.fov * Math.PI) / 180, aspect, camera.near, camera.far);

  return multiply4(projection, view);
}

export function cameraRayFromViewport(input: {
  x: number;
  y: number;
  viewport: { width: number; height: number };
  camera: TypeGpuCameraSettings;
}): TypeGpuRay {
  const ndcX = (input.x / input.viewport.width) * 2 - 1;
  const ndcY = 1 - (input.y / input.viewport.height) * 2;

  if (input.camera.projection === 'orthographic') {
    const inverseViewProjection = invert4(
      createViewProjectionMatrix(input.viewport.width / input.viewport.height, input.camera)
    );
    const origin = transformPoint4(inverseViewProjection, [ndcX, ndcY, -1]);
    const direction = normalize3(subtract3(input.camera.target, input.camera.position), [0, 0, -1]);

    return { origin, direction };
  }

  const forward = normalize3(subtract3(input.camera.target, input.camera.position), [0, 0, -1]);
  const right = normalize3(cross3(forward, [0, 1, 0]), [1, 0, 0]);
  const up = normalize3(cross3(right, forward), [0, 1, 0]);
  const aspect = input.viewport.width / input.viewport.height;
  const halfHeight = Math.tan((input.camera.fov * Math.PI) / 360);
  const halfWidth = halfHeight * aspect;
  const direction = normalize3(
    add3(add3(forward, scale3(right, ndcX * halfWidth)), scale3(up, ndcY * halfHeight)),
    forward
  );

  return {
    origin: [...input.camera.position],
    direction
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

function readCameraSettings(node: TypeGpuNode): TypeGpuCameraSettings {
  if (node.name === 'orthographicCamera') {
    return {
      projection: 'orthographic',
      position: vectorTuple(node.attributes.position, DEFAULT_CAMERA.position),
      target: vectorTuple(node.attributes.target, DEFAULT_CAMERA.target),
      zoom: clampedNumberArg(node.attributes.zoom, 1, 0.0001, Number.MAX_SAFE_INTEGER),
      near: numberArg(node.attributes.near, DEFAULT_CAMERA.near),
      far: numberArg(node.attributes.far, DEFAULT_CAMERA.far)
    };
  }

  return {
    projection: 'perspective',
    position: vectorTuple(node.attributes.position, DEFAULT_CAMERA.position),
    target: vectorTuple(node.attributes.target, DEFAULT_CAMERA.target),
    fov: clampedNumberArg(node.attributes.fov, 45, 0.0001, 179.999),
    near: numberArg(node.attributes.near, DEFAULT_CAMERA.near),
    far: numberArg(node.attributes.far, DEFAULT_CAMERA.far)
  };
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

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}
