import { dispatchNodeEvent } from './core';
import {
  cameraFromOrbit,
  deriveOrbitState,
  normalizeWheelDelta,
  rotateOrbit,
  type TypeGpuOrbitState,
  zoomOrbit
} from './camera-orbit';
import type { TypeGpuRenderer } from './gpu-renderer';
import type {
  TypeGpuCameraSettings,
  TypeGpuKeyboardControls,
  TypeGpuPointerControls,
  TypeGpuPointerDragButton,
  TypeGpuSceneState
} from './types';

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;
type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;
type ListenerRegistration = [string, EventListener, AddEventListenerOptions?];
type TypeGpuCameraRenderer = Pick<TypeGpuRenderer, 'setCamera'>;

const KEYBOARD_ROTATE_SENSITIVITY = 0.005;
const KEYBOARD_ZOOM_SENSITIVITY = 0.05;

const defaultRequestFrame: RequestFrame = (callback) => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }

  return globalThis.setTimeout(
    () => callback(globalThis.performance?.now() ?? Date.now()),
    16
  ) as unknown as number;
};

const defaultCancelFrame: CancelFrame = (handle) => {
  if (typeof globalThis.cancelAnimationFrame === 'function') {
    globalThis.cancelAnimationFrame(handle);
    return;
  }

  globalThis.clearTimeout(handle);
};

export interface TypeGpuCameraInteractionOptions {
  canvas: HTMLCanvasElement;
  renderer: TypeGpuCameraRenderer;
  windowTarget?: ListenerTarget;
  requestFrame?: RequestFrame;
  cancelFrame?: CancelFrame;
}

export interface TypeGpuCameraInteractionController {
  reconcile(scene: TypeGpuSceneState): void;
  consumeSuppressedClick(): boolean;
  dispose(): void;
}

export function createCameraInteractionController({
  canvas,
  renderer,
  windowTarget = globalThis.window as ListenerTarget,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame
}: TypeGpuCameraInteractionOptions): TypeGpuCameraInteractionController {
  let pointerAttached = false;
  let keyboardAttached = false;
  let disposed = false;
  let frame: number | null = null;
  let framePending = false;
  let keyboardFrame: number | null = null;
  let keyboardFramePending = false;
  let activeScene: TypeGpuSceneState | null = null;
  let activePointerControls: TypeGpuPointerControls | null = null;
  let activeKeyboardControls: TypeGpuKeyboardControls | null = null;
  let orbit: TypeGpuOrbitState | null = null;
  let lastEvent: Event | undefined;
  let lastKeyboardEvent: KeyboardEvent | undefined;
  const pressedKeyboardCommands = new Set<KeyboardCameraCommand>();
  let dragging = false;
  let suppressNextClick = false;
  let dragStartPosition: { x: number; y: number } | null = null;
  let previousPointerPosition: { x: number; y: number } | null = null;
  let lastPinchDistance: number | null = null;
  let activeTouchGesture: 'orbit' | 'pinch' | null = null;

  const commitCameraUpdate = (
    camera: TypeGpuCameraSettings,
    eventOrbit: Pick<TypeGpuOrbitState, 'radius' | 'yaw' | 'pitch'>,
    event: Event | undefined
  ) => {
    if (!activeScene?.cameraControllerNode) return;

    const controlsNode = activeScene.cameraControllerNode;

    renderer.setCamera(camera);
    dispatchNodeEvent(controlsNode, 'camerachange', {
      detail: {
        camera,
        orbit: eventOrbit
      },
      originalEvent: event
    });
    activeScene.camera = camera;
  };

  const queueCameraUpdate = (event: Event) => {
    if (!activeScene || !orbit) return;

    lastEvent = event;

    if (framePending) return;

    framePending = true;
    const nextFrame = requestFrame(() => {
      framePending = false;
      frame = null;
      if (
        disposed ||
        !hasAttachedInput() ||
        !activeScene?.cameraControllerNode ||
        !orbit
      ) {
        return;
      }

      const camera = cameraFromOrbit(orbit, activeScene.camera);
      const eventOrbit = {
        radius: orbit.radius,
        yaw: orbit.yaw,
        pitch: orbit.pitch
      };
      const originalEvent = lastEvent;

      commitCameraUpdate(camera, eventOrbit, originalEvent);
    });

    if (framePending) {
      frame = nextFrame;
    }
  };

  const cancelPendingCameraUpdate = () => {
    if (framePending && frame !== null) {
      cancelFrame(frame);
    }

    frame = null;
    framePending = false;
    lastEvent = undefined;
  };

  const commitCurrentCameraUpdate = (event: Event | undefined) => {
    if (disposed || !hasAttachedInput() || !activeScene?.cameraControllerNode || !orbit) return;

    commitCameraUpdate(
      cameraFromOrbit(orbit, activeScene.camera),
      {
        radius: orbit.radius,
        yaw: orbit.yaw,
        pitch: orbit.pitch
      },
      event
    );
  };

  const cancelKeyboardFrame = () => {
    if (keyboardFramePending && keyboardFrame !== null) {
      cancelFrame(keyboardFrame);
    }

    keyboardFrame = null;
    keyboardFramePending = false;
  };

  const resetKeyboardState = () => {
    pressedKeyboardCommands.clear();
    lastKeyboardEvent = undefined;
    cancelKeyboardFrame();
  };

  const scheduleKeyboardFrame = () => {
    if (keyboardFramePending || pressedKeyboardCommands.size === 0) return;

    keyboardFramePending = true;
    const nextFrame = requestFrame(() => {
      keyboardFramePending = false;
      keyboardFrame = null;

      if (
        disposed ||
        !activeScene ||
        !activeKeyboardControls?.smooth ||
        !orbit ||
        pressedKeyboardCommands.size === 0
      ) {
        return;
      }

      if (applyKeyboardCommands(pressedKeyboardCommands)) {
        commitCurrentCameraUpdate(lastKeyboardEvent);
      }

      scheduleKeyboardFrame();
    });

    if (keyboardFramePending) {
      keyboardFrame = nextFrame;
    }
  };

  const resetGestureState = () => {
    dragging = false;
    dragStartPosition = null;
    previousPointerPosition = null;
    lastPinchDistance = null;
    activeTouchGesture = null;
  };

  const markClickSuppression = (x: number, y: number) => {
    if (!dragStartPosition) return;

    if (x !== dragStartPosition.x || y !== dragStartPosition.y) {
      suppressNextClick = true;
    }
  };

  const onWheel = (event: Event) => {
    const wheelEvent = event as WheelEvent;
    if (!activeScene || !activePointerControls || !orbit || activePointerControls.wheel === 'none') {
      return;
    }

    wheelEvent.preventDefault();
    orbit = zoomOrbit(
      orbit,
      normalizeWheelDelta(wheelEvent.deltaY, wheelEvent.deltaMode, canvas.clientHeight),
      {
        minDistance: activeScene.cameraController!.minDistance,
        maxDistance: activeScene.cameraController!.maxDistance,
        zoomSpeed: activePointerControls.zoomSpeed
      }
    );
    queueCameraUpdate(wheelEvent);
  };

  const onMouseDown = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (
      !activePointerControls ||
      !orbit ||
      mouseEvent.button !== buttonNumber(activePointerControls.dragButton)
    ) {
      return;
    }

    mouseEvent.preventDefault();
    suppressNextClick = false;
    dragging = true;
    dragStartPosition = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    previousPointerPosition = { x: mouseEvent.clientX, y: mouseEvent.clientY };
  };

  const onMouseMove = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (!dragging || !activeScene || !activePointerControls || !orbit || !previousPointerPosition) {
      return;
    }

    markClickSuppression(mouseEvent.clientX, mouseEvent.clientY);

    if ((mouseEvent.buttons & buttonMask(activePointerControls.dragButton)) === 0) {
      dragging = false;
      dragStartPosition = null;
      previousPointerPosition = null;
      return;
    }

    mouseEvent.preventDefault();
    const dx = mouseEvent.clientX - previousPointerPosition.x;
    const dy = mouseEvent.clientY - previousPointerPosition.y;
    previousPointerPosition = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    orbit = rotateCamera(orbit, activeScene, dx, dy, activePointerControls.rotateSpeed);
    queueCameraUpdate(mouseEvent);
  };

  const onMouseUp = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (
      activePointerControls &&
      mouseEvent.button !== buttonNumber(activePointerControls.dragButton)
    ) {
      return;
    }

    dragging = false;
    dragStartPosition = null;
    previousPointerPosition = null;
  };

  const onContextMenu = (event: Event) => {
    if (activePointerControls?.dragButton === 'secondary') {
      event.preventDefault();
    }
  };

  const onTouchStart = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (!activePointerControls || !orbit) return;

    if (touchEvent.touches.length === 1 && allowsTouchOrbit(activePointerControls)) {
      touchEvent.preventDefault();
      suppressNextClick = false;
      activeTouchGesture = 'orbit';
      previousPointerPosition = touchPosition(touchEvent.touches[0]);
      dragStartPosition = previousPointerPosition;
      lastPinchDistance = null;
      return;
    }

    if (touchEvent.touches.length >= 2 && allowsTouchPinch(activePointerControls)) {
      touchEvent.preventDefault();
      suppressNextClick = false;
      activeTouchGesture = 'pinch';
      previousPointerPosition = null;
      lastPinchDistance = pinchDistance(touchEvent.touches[0], touchEvent.touches[1]);
      return;
    }

    resetGestureState();
  };

  const onTouchMove = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (!activeScene || !activePointerControls || !orbit) return;

    if (
      activeTouchGesture === 'orbit' &&
      touchEvent.touches.length === 1 &&
      allowsTouchOrbit(activePointerControls)
    ) {
      touchEvent.preventDefault();
      const position = touchPosition(touchEvent.touches[0]);
      markClickSuppression(position.x, position.y);
      if (!previousPointerPosition) {
        previousPointerPosition = position;
        return;
      }

      const dx = position.x - previousPointerPosition.x;
      const dy = position.y - previousPointerPosition.y;
      previousPointerPosition = position;
      lastPinchDistance = null;
      orbit = rotateCamera(orbit, activeScene, dx, dy, activePointerControls.rotateSpeed);
      queueCameraUpdate(touchEvent);
      return;
    }

    if (
      activeTouchGesture === 'pinch' &&
      touchEvent.touches.length >= 2 &&
      allowsTouchPinch(activePointerControls)
    ) {
      touchEvent.preventDefault();
      suppressNextClick = true;
      const distance = pinchDistance(touchEvent.touches[0], touchEvent.touches[1]);
      if (lastPinchDistance !== null) {
        orbit = zoomOrbit(orbit, lastPinchDistance - distance, {
          minDistance: activeScene.cameraController!.minDistance,
          maxDistance: activeScene.cameraController!.maxDistance,
          zoomSpeed: activePointerControls.zoomSpeed
        });
        queueCameraUpdate(touchEvent);
      }
      lastPinchDistance = distance;
      previousPointerPosition = null;
    }
  };

  const onTouchEnd = () => {
    resetGestureState();
  };

  const applyKeyboardCommands = (commands: ReadonlySet<KeyboardCameraCommand>): boolean => {
    if (!activeScene || !activeKeyboardControls || !orbit) return false;

    let nextOrbit = orbit;
    const step = keyboardStep(activeKeyboardControls);
    const yawDelta = commandDirection(commands, 'rotateRight', 'rotateLeft') * step;
    const pitchDelta = commandDirection(commands, 'rotateUp', 'rotateDown') * step;

    if (yawDelta !== 0 || pitchDelta !== 0) {
      nextOrbit = rotateCameraByKeyboardStep(nextOrbit, activeScene, yawDelta, pitchDelta);
    }

    const zoomDelta = commandDirection(commands, 'zoomOut', 'zoomIn') * step;
    if (zoomDelta !== 0) {
      const controller = activeScene.cameraController!;
      nextOrbit = zoomOrbit(nextOrbit, keyboardZoomDelta(nextOrbit, zoomDelta), {
        minDistance: controller.minDistance,
        maxDistance: controller.maxDistance,
        zoomSpeed: 1
      });
    }

    const movement = keyboardMovementVector(nextOrbit, commands, activeKeyboardControls);
    if (!vectorEqual(movement, [0, 0, 0])) {
      nextOrbit = translateOrbit(nextOrbit, movement);
    }

    if (orbitStateEqual(orbit, nextOrbit)) {
      return false;
    }

    orbit = nextOrbit;
    return true;
  };

  const onKeyDown = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (!activeScene || !activeKeyboardControls || !orbit) return;

    const command = keyboardCommandForEvent(keyboardEvent, activeKeyboardControls);
    if (!command) return;

    keyboardEvent.preventDefault();
    pressedKeyboardCommands.add(command);
    lastKeyboardEvent = keyboardEvent;

    if (activeKeyboardControls.smooth) {
      scheduleKeyboardFrame();
      return;
    }

    if (applyKeyboardCommands(pressedKeyboardCommands)) {
      queueCameraUpdate(keyboardEvent);
    }
  };

  const onKeyUp = (event: Event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (!activeKeyboardControls) return;

    const command = keyboardCommandForEvent(keyboardEvent, activeKeyboardControls);
    if (!command) return;

    keyboardEvent.preventDefault();
    pressedKeyboardCommands.delete(command);
    lastKeyboardEvent = keyboardEvent;

    if (pressedKeyboardCommands.size === 0) {
      cancelKeyboardFrame();
    }
  };

  const onKeyboardBlur = () => {
    resetKeyboardState();
  };

  const onKeyboardPointerDown = () => {
    if (!activeKeyboardControls || typeof canvas.focus !== 'function') return;

    canvas.focus();
  };

  const pointerCanvasListeners: ListenerRegistration[] = [
    ['wheel', onWheel, { passive: false }],
    ['mousedown', onMouseDown, { passive: false }],
    ['contextmenu', onContextMenu, { passive: false }],
    ['touchstart', onTouchStart, { passive: false }],
    ['touchmove', onTouchMove, { passive: false }]
  ];
  const pointerWindowListeners: ListenerRegistration[] = [
    ['mousemove', onMouseMove, { passive: false }],
    ['mouseup', onMouseUp],
    ['touchmove', onTouchMove, { passive: false }],
    ['touchend', onTouchEnd],
    ['touchcancel', onTouchEnd]
  ];
  const keyboardCanvasListeners: ListenerRegistration[] = [
    ['keydown', onKeyDown],
    ['keyup', onKeyUp],
    ['blur', onKeyboardBlur],
    ['pointerdown', onKeyboardPointerDown]
  ];

  function attachPointer(): void {
    if (pointerAttached) return;

    for (const [type, listener, options] of pointerCanvasListeners) {
      canvas.addEventListener(type, listener, options);
    }

    for (const [type, listener, options] of pointerWindowListeners) {
      windowTarget.addEventListener(type, listener, options);
    }

    pointerAttached = true;
  }

  function detachPointer(): void {
    if (!pointerAttached) return;

    for (const [type, listener] of pointerCanvasListeners) {
      canvas.removeEventListener(type, listener);
    }

    for (const [type, listener] of pointerWindowListeners) {
      windowTarget.removeEventListener(type, listener);
    }

    pointerAttached = false;
    resetGestureState();
  }

  function attachKeyboard(): void {
    if (keyboardAttached) return;

    ensureCanvasFocusable();
    for (const [type, listener, options] of keyboardCanvasListeners) {
      canvas.addEventListener(type, listener, options);
    }

    keyboardAttached = true;
  }

  function detachKeyboard(): void {
    if (!keyboardAttached) return;

    for (const [type, listener] of keyboardCanvasListeners) {
      canvas.removeEventListener(type, listener);
    }

    keyboardAttached = false;
    resetKeyboardState();
  }

  function deactivate(): void {
    cancelPendingCameraUpdate();
    resetKeyboardState();
    activeScene = null;
    activePointerControls = null;
    activeKeyboardControls = null;
    orbit = null;
    suppressNextClick = false;
    detachPointer();
    detachKeyboard();
    resetGestureState();
  }

  function hasAttachedInput(): boolean {
    return pointerAttached || keyboardAttached;
  }

  function ensureCanvasFocusable(): void {
    if (typeof canvas.hasAttribute === 'function' && canvas.hasAttribute('tabindex')) {
      return;
    }

    canvas.tabIndex = 0;
  }

  return {
    consumeSuppressedClick() {
      const suppressed = suppressNextClick;
      suppressNextClick = false;
      return suppressed;
    },
    reconcile(nextScene) {
      if (disposed) return;

      const cameraController = nextScene.cameraController;
      if (
        nextScene.cameraNode !== null &&
        nextScene.cameraControllerNode !== null &&
        cameraController?.kind === 'controls' &&
        (cameraController.pointer !== null || cameraController.keyboard !== null)
      ) {
        const sameCameraState =
          activeScene !== null && hasSameInteractiveCameraState(activeScene, nextScene);

        if (activeScene !== null && !sameCameraState) {
          cancelPendingCameraUpdate();
          resetGestureState();
          resetKeyboardState();
        }

        activeScene = nextScene;
        activePointerControls = cameraController.pointer;
        activeKeyboardControls = cameraController.keyboard;
        if (!sameCameraState || !framePending) {
          orbit = deriveOrbitState(nextScene.camera, {
            minDistance: cameraController.minDistance,
            maxDistance: cameraController.maxDistance
          });
        }
        if (cameraController.pointer) {
          attachPointer();
        } else {
          detachPointer();
        }

        if (cameraController.keyboard) {
          attachKeyboard();
        } else {
          detachKeyboard();
        }
      } else {
        deactivate();
      }
    },
    dispose() {
      if (disposed) return;

      disposed = true;
      deactivate();
    }
  };
}

function buttonNumber(button: TypeGpuPointerDragButton): number {
  switch (button) {
    case 'middle':
      return 1;
    case 'secondary':
      return 2;
    case 'primary':
    default:
      return 0;
  }
}

function buttonMask(button: TypeGpuPointerDragButton): number {
  switch (button) {
    case 'middle':
      return 4;
    case 'secondary':
      return 2;
    case 'primary':
    default:
      return 1;
  }
}

function hasSameInteractiveCameraState(
  previous: TypeGpuSceneState,
  next: TypeGpuSceneState
): boolean {
  return (
    previous.cameraNode === next.cameraNode &&
    previous.cameraControllerNode === next.cameraControllerNode &&
    cameraSettingsEqual(previous.camera, next.camera) &&
    previous.cameraController?.kind === 'controls' &&
    next.cameraController?.kind === 'controls' &&
    previous.cameraController.mode === next.cameraController.mode &&
    previous.cameraController.minDistance === next.cameraController.minDistance &&
    previous.cameraController.maxDistance === next.cameraController.maxDistance &&
    previous.cameraController.invert === next.cameraController.invert &&
    pointerControlsEqual(previous.cameraController.pointer, next.cameraController.pointer) &&
    keyboardControlsEqual(previous.cameraController.keyboard, next.cameraController.keyboard)
  );
}

function cameraSettingsEqual(
  previous: TypeGpuCameraSettings,
  next: TypeGpuCameraSettings
): boolean {
  return (
    vectorEqual(previous.position, next.position) &&
    vectorEqual(previous.target, next.target) &&
    previous.fov === next.fov &&
    previous.near === next.near &&
    previous.far === next.far
  );
}

function pointerControlsEqual(
  previous: TypeGpuPointerControls | null,
  next: TypeGpuPointerControls | null
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.dragButton === next.dragButton &&
    previous.rotateSpeed === next.rotateSpeed &&
    previous.wheel === next.wheel &&
    previous.zoomSpeed === next.zoomSpeed &&
    previous.touch === next.touch
  );
}

function keyboardControlsEqual(
  previous: TypeGpuKeyboardControls | null,
  next: TypeGpuKeyboardControls | null
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;

  return (
    previous.rotateLeft === next.rotateLeft &&
    previous.rotateRight === next.rotateRight &&
    previous.rotateUp === next.rotateUp &&
    previous.rotateDown === next.rotateDown &&
    previous.zoomIn === next.zoomIn &&
    previous.zoomOut === next.zoomOut &&
    previous.moveForward === next.moveForward &&
    previous.moveBackward === next.moveBackward &&
    previous.moveLeft === next.moveLeft &&
    previous.moveRight === next.moveRight &&
    previous.moveUp === next.moveUp &&
    previous.moveDown === next.moveDown &&
    previous.step === next.step &&
    previous.moveStep === next.moveStep &&
    previous.smooth === next.smooth
  );
}

function vectorEqual(
  previous: [number, number, number],
  next: [number, number, number]
): boolean {
  return previous[0] === next[0] && previous[1] === next[1] && previous[2] === next[2];
}

function allowsTouchOrbit(pointer: TypeGpuPointerControls): boolean {
  return pointer.touch === 'orbit' || pointer.touch === 'orbit-pinch';
}

function allowsTouchPinch(pointer: TypeGpuPointerControls): boolean {
  return pointer.touch === 'pinch' || pointer.touch === 'orbit-pinch';
}

function touchPosition(touch: Touch): { x: number; y: number } {
  return { x: touch.clientX, y: touch.clientY };
}

function pinchDistance(first: Touch, second: Touch): number {
  return Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
}

type KeyboardCameraCommand =
  | 'rotateLeft'
  | 'rotateRight'
  | 'rotateUp'
  | 'rotateDown'
  | 'zoomIn'
  | 'zoomOut'
  | 'moveForward'
  | 'moveBackward'
  | 'moveLeft'
  | 'moveRight'
  | 'moveUp'
  | 'moveDown';

function keyboardCommandForEvent(
  event: KeyboardEvent,
  controls: TypeGpuKeyboardControls
): KeyboardCameraCommand | null {
  if (event.altKey || event.ctrlKey || event.metaKey) return null;

  const commands: KeyboardCameraCommand[] = [
    'rotateLeft',
    'rotateRight',
    'rotateUp',
    'rotateDown',
    'zoomIn',
    'zoomOut',
    'moveForward',
    'moveBackward',
    'moveLeft',
    'moveRight',
    'moveUp',
    'moveDown'
  ];

  return commands.find((command) => matchesShortcut(event, controls[command])) ?? null;
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
  return event.key === shortcut || event.code === shortcut;
}

function rotateCameraByKeyboardStep(
  orbit: TypeGpuOrbitState,
  scene: TypeGpuSceneState,
  yawDelta: number,
  pitchDelta: number
): TypeGpuOrbitState {
  return rotateCamera(
    orbit,
    scene,
    -yawDelta / KEYBOARD_ROTATE_SENSITIVITY,
    pitchDelta / KEYBOARD_ROTATE_SENSITIVITY,
    1
  );
}

function rotateCamera(
  orbit: TypeGpuOrbitState,
  scene: TypeGpuSceneState,
  dx: number,
  dy: number,
  rotateSpeed: number
): TypeGpuOrbitState {
  const controller = scene.cameraController;
  if (!controller || controller.kind !== 'controls') return orbit;

  const rotated = rotateOrbit(orbit, dx, dy, {
    minDistance: controller.minDistance,
    maxDistance: controller.maxDistance,
    invert: controller.invert,
    rotateSpeed
  });

  if (controller.mode === 'fly') {
    return pinOrbitToCameraPosition(rotated, cameraFromOrbit(orbit, scene.camera).position);
  }

  return rotated;
}

function pinOrbitToCameraPosition(
  orbit: TypeGpuOrbitState,
  position: [number, number, number]
): TypeGpuOrbitState {
  const displacement = orbitDisplacement(orbit);

  return {
    ...orbit,
    target: [
      roundToSix(position[0] - displacement[0]),
      roundToSix(position[1] - displacement[1]),
      roundToSix(position[2] - displacement[2])
    ]
  };
}

function orbitDisplacement(orbit: TypeGpuOrbitState): [number, number, number] {
  const cosPitch = Math.cos(orbit.pitch);

  return [
    roundToSix(orbit.radius * Math.sin(orbit.yaw) * cosPitch),
    roundToSix(orbit.radius * Math.sin(orbit.pitch)),
    roundToSix(orbit.radius * Math.cos(orbit.yaw) * cosPitch)
  ];
}

function keyboardZoomDelta(orbit: TypeGpuOrbitState, step: number): number {
  return (orbit.radius * step) / KEYBOARD_ZOOM_SENSITIVITY;
}

function keyboardStep(controls: TypeGpuKeyboardControls): number {
  return Number.isFinite(controls.step) ? Math.max(0, controls.step) : 0;
}

function keyboardMoveStep(controls: TypeGpuKeyboardControls): number {
  return Number.isFinite(controls.moveStep) ? Math.max(0, controls.moveStep) : 0;
}

function commandDirection(
  commands: ReadonlySet<KeyboardCameraCommand>,
  positive: KeyboardCameraCommand,
  negative: KeyboardCameraCommand
): number {
  return (commands.has(positive) ? 1 : 0) - (commands.has(negative) ? 1 : 0);
}

function orbitStateEqual(previous: TypeGpuOrbitState, next: TypeGpuOrbitState): boolean {
  return (
    previous.radius === next.radius &&
    previous.yaw === next.yaw &&
    previous.pitch === next.pitch &&
    vectorEqual(previous.target, next.target)
  );
}

function keyboardMovementVector(
  orbit: TypeGpuOrbitState,
  commands: ReadonlySet<KeyboardCameraCommand>,
  controls: TypeGpuKeyboardControls
): [number, number, number] {
  const step = keyboardMoveStep(controls);
  const forward: [number, number, number] = [-Math.sin(orbit.yaw), 0, -Math.cos(orbit.yaw)];
  const left: [number, number, number] = [forward[2], 0, -forward[0]];
  const forwardDirection = commandDirection(commands, 'moveForward', 'moveBackward');
  const leftDirection = commandDirection(commands, 'moveLeft', 'moveRight');
  const verticalDirection = commandDirection(commands, 'moveUp', 'moveDown');
  const combined: [number, number, number] = [
    forward[0] * forwardDirection + left[0] * leftDirection,
    verticalDirection,
    forward[2] * forwardDirection + left[2] * leftDirection
  ];
  const length = Math.hypot(combined[0], combined[1], combined[2]);

  if (length === 0 || step === 0) {
    return [0, 0, 0];
  }

  return scaleVector([combined[0] / length, combined[1] / length, combined[2] / length], step);
}

function translateOrbit(
  orbit: TypeGpuOrbitState,
  displacement: [number, number, number]
): TypeGpuOrbitState {
  return {
    ...orbit,
    target: [
      roundToSix(orbit.target[0] + displacement[0]),
      roundToSix(orbit.target[1] + displacement[1]),
      roundToSix(orbit.target[2] + displacement[2])
    ]
  };
}

function scaleVector(vector: [number, number, number], scale: number): [number, number, number] {
  return [
    roundToSix(vector[0] * scale),
    roundToSix(vector[1] * scale),
    roundToSix(vector[2] * scale)
  ];
}

function roundToSix(value: number): number {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
}
