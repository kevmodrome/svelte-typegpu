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
  projection: 'perspective',
  position: [9, 7, 13],
  target: [0, 0, 0],
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
  moveForward: 'KeyW',
  moveBackward: 'KeyS',
  moveLeft: 'KeyA',
  moveRight: 'KeyD',
  moveUp: 'Space',
  moveDown: 'KeyC',
  step: 0.08,
  moveStep: 0.35,
  smooth: false
};

export function readPerspectiveCamera(root: TypeGpuNode): TypeGpuCameraSettings {
  const { position, target, fov, near, far } = readPerspectiveCameraState(root).settings;

  return { position, target, fov: fov ?? 45, near, far };
}

export function readPerspectiveCameraState(root: TypeGpuNode): TypeGpuCameraState {
  const camera = findFirst(root, (node) => node.name === 'perspectiveCamera');

  return readPerspectiveCameraNodeState(camera);
}

export function readPerspectiveCameraNodeState(camera: TypeGpuNode | null): TypeGpuCameraState {
  const pose = camera ? firstChildNamed(camera, 'cameraPose') : null;
  const lens = camera ? firstChildNamed(camera, 'cameraLens') : null;
  const controls = camera ? firstChildNamed(camera, 'controls') : null;
  const poseAttributes = pose?.attributes ?? {};
  const lensAttributes = lens?.attributes ?? {};

  return {
    node: camera,
    settings: {
      projection: 'perspective',
      position: vectorTuple(poseAttributes.position, DEFAULT_CAMERA.position),
      target: vectorTuple(poseAttributes.target, DEFAULT_CAMERA.target),
      fov: numberArg(lensAttributes.fov, 45),
      near: numberArg(lensAttributes.near, DEFAULT_CAMERA.near),
      far: numberArg(lensAttributes.far, DEFAULT_CAMERA.far)
    },
    controllerNode: controls,
    controller: controls ? readCameraController(controls) : null
  };
}

export function isCameraControlNode(node: TypeGpuNode | undefined): boolean {
  return (
    node?.name === 'perspectiveCamera' ||
    node?.name === 'cameraPose' ||
    node?.name === 'cameraLens' ||
    node?.name === 'controls' ||
    node?.name === 'pointerControls' ||
    node?.name === 'keyboardControls'
  );
}

function readCameraController(controls: TypeGpuNode): TypeGpuCameraController | null {
  const pointer = firstChildNamed(controls, 'pointerControls');
  const keyboard = firstChildNamed(controls, 'keyboardControls');

  if (!pointer && !keyboard) return null;

  const minDistance = clampedNumberArg(
    controls.attributes.minDistance,
    DEFAULT_MIN_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );
  const maxDistance = clampedNumberArg(
    controls.attributes.maxDistance,
    DEFAULT_MAX_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );

  return {
    kind: 'controls',
    mode: stringOption(controls.attributes.mode, ['orbit', 'fly'], 'orbit'),
    minDistance: minDistance <= maxDistance ? minDistance : DEFAULT_MIN_DISTANCE,
    maxDistance: minDistance <= maxDistance ? maxDistance : DEFAULT_MAX_DISTANCE,
    invert: controls.attributes.invert === true,
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
    moveForward: stringArg(node.attributes.moveForward, DEFAULT_KEYBOARD_CONTROLS.moveForward),
    moveBackward: stringArg(node.attributes.moveBackward, DEFAULT_KEYBOARD_CONTROLS.moveBackward),
    moveLeft: stringArg(node.attributes.moveLeft, DEFAULT_KEYBOARD_CONTROLS.moveLeft),
    moveRight: stringArg(node.attributes.moveRight, DEFAULT_KEYBOARD_CONTROLS.moveRight),
    moveUp: stringArg(node.attributes.moveUp, DEFAULT_KEYBOARD_CONTROLS.moveUp),
    moveDown: stringArg(node.attributes.moveDown, DEFAULT_KEYBOARD_CONTROLS.moveDown),
    step: clampedNumberArg(node.attributes.step, DEFAULT_KEYBOARD_CONTROLS.step, 0, 10),
    moveStep: clampedNumberArg(node.attributes.moveStep, DEFAULT_KEYBOARD_CONTROLS.moveStep, 0, 100),
    smooth: node.attributes.smooth === true
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
