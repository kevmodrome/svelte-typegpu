import { clampedNumberArg, numberArg, vectorTuple } from '../attributes';
import { findFirst, type TypeGpuNode } from '../core';
import type {
  TypeGpuCameraController,
  TypeGpuCameraSettings,
  TypeGpuCameraState,
  TypeGpuKeyboardControls,
  TypeGpuPointerControls
} from '../types';

export const DEFAULT_CAMERA: TypeGpuCameraSettings = {
  position: [9, 7, 13],
  lookAt: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 100;
const DEFAULT_POINTER_CONTROLS: TypeGpuPointerControls = {
  dragButton: 'primary',
  rotateSpeed: 1,
  wheel: 'zoom',
  zoomSpeed: 1,
  touch: 'orbit-pinch'
};
const DEFAULT_KEYBOARD_CONTROLS: TypeGpuKeyboardControls = {
  rotateLeft: 'ArrowLeft',
  rotateRight: 'ArrowRight',
  rotateUp: 'ArrowUp',
  rotateDown: 'ArrowDown',
  zoomIn: '+',
  zoomOut: '-',
  step: 0.08
};

export function readPerspectiveCamera(root: TypeGpuNode): TypeGpuCameraSettings {
  return readPerspectiveCameraState(root).settings;
}

export function readPerspectiveCameraState(root: TypeGpuNode): TypeGpuCameraState {
  const camera = findFirst(root, (node) => node.name === 'perspectiveCamera');
  const attributes = camera?.attributes ?? {};

  return {
    node: camera,
    settings: {
      position: vectorTuple(attributes.position, DEFAULT_CAMERA.position),
      lookAt: vectorTuple(attributes.lookAt, DEFAULT_CAMERA.lookAt),
      fov: numberArg(attributes.fov, DEFAULT_CAMERA.fov),
      near: numberArg(attributes.near, DEFAULT_CAMERA.near),
      far: numberArg(attributes.far, DEFAULT_CAMERA.far)
    },
    controller: camera ? readCameraController(camera) : null
  };
}

export function isCameraControlNode(node: TypeGpuNode | undefined): boolean {
  return (
    node?.name === 'perspectiveCamera' ||
    node?.name === 'orbitControls' ||
    node?.name === 'pointerControls' ||
    node?.name === 'keyboardControls'
  );
}

function readCameraController(camera: TypeGpuNode): TypeGpuCameraController | null {
  const orbit = firstChildNamed(camera, 'orbitControls');
  if (!orbit) return null;

  const pointer = firstChildNamed(orbit, 'pointerControls');
  const keyboard = firstChildNamed(orbit, 'keyboardControls');

  if (!pointer && !keyboard) return null;

  const minDistance = clampedNumberArg(
    orbit.attributes.minDistance,
    DEFAULT_MIN_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );
  const maxDistance = clampedNumberArg(
    orbit.attributes.maxDistance,
    DEFAULT_MAX_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );

  return {
    kind: 'orbit',
    minDistance: minDistance <= maxDistance ? minDistance : DEFAULT_MIN_DISTANCE,
    maxDistance: minDistance <= maxDistance ? maxDistance : DEFAULT_MAX_DISTANCE,
    invert: orbit.attributes.invert === true,
    pointer: pointer ? readPointerControls(pointer) : null,
    keyboard: keyboard ? readKeyboardControls(keyboard) : null
  };
}

function readPointerControls(node: TypeGpuNode): TypeGpuPointerControls {
  return {
    dragButton: stringOption(
      node.attributes.dragButton,
      ['primary', 'middle', 'secondary'],
      DEFAULT_POINTER_CONTROLS.dragButton
    ),
    rotateSpeed: clampedNumberArg(
      node.attributes.rotateSpeed,
      DEFAULT_POINTER_CONTROLS.rotateSpeed,
      0,
      100
    ),
    wheel: stringOption(node.attributes.wheel, ['zoom', 'none'], DEFAULT_POINTER_CONTROLS.wheel),
    zoomSpeed: clampedNumberArg(
      node.attributes.zoomSpeed,
      DEFAULT_POINTER_CONTROLS.zoomSpeed,
      0,
      100
    ),
    touch: stringOption(
      node.attributes.touch,
      ['orbit-pinch', 'orbit', 'pinch', 'none'],
      DEFAULT_POINTER_CONTROLS.touch
    )
  };
}

function readKeyboardControls(node: TypeGpuNode): TypeGpuKeyboardControls {
  return {
    rotateLeft: stringArg(node.attributes.rotateLeft, DEFAULT_KEYBOARD_CONTROLS.rotateLeft),
    rotateRight: stringArg(node.attributes.rotateRight, DEFAULT_KEYBOARD_CONTROLS.rotateRight),
    rotateUp: stringArg(node.attributes.rotateUp, DEFAULT_KEYBOARD_CONTROLS.rotateUp),
    rotateDown: stringArg(node.attributes.rotateDown, DEFAULT_KEYBOARD_CONTROLS.rotateDown),
    zoomIn: stringArg(node.attributes.zoomIn, DEFAULT_KEYBOARD_CONTROLS.zoomIn),
    zoomOut: stringArg(node.attributes.zoomOut, DEFAULT_KEYBOARD_CONTROLS.zoomOut),
    step: clampedNumberArg(node.attributes.step, DEFAULT_KEYBOARD_CONTROLS.step, 0, 10)
  };
}

function firstChildNamed(node: TypeGpuNode, name: string): TypeGpuNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }

  return null;
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringOption<const T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback;
}
