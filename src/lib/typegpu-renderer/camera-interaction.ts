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
  TypeGpuPointerControls,
  TypeGpuPointerDragButton,
  TypeGpuSceneState
} from './types';

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;
type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;
type ListenerRegistration = [string, EventListener, AddEventListenerOptions?];
type TypeGpuCameraRenderer = Pick<TypeGpuRenderer, 'setCamera'>;

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
  dispose(): void;
}

export function createCameraInteractionController({
  canvas,
  renderer,
  windowTarget = globalThis.window as ListenerTarget,
  requestFrame = defaultRequestFrame,
  cancelFrame = defaultCancelFrame
}: TypeGpuCameraInteractionOptions): TypeGpuCameraInteractionController {
  let attached = false;
  let disposed = false;
  let frame: number | null = null;
  let framePending = false;
  let activeScene: TypeGpuSceneState | null = null;
  let activePointerControls: TypeGpuPointerControls | null = null;
  let orbit: TypeGpuOrbitState | null = null;
  let nextCamera: TypeGpuCameraSettings | null = null;
  let lastEvent: Event | undefined;
  let dragging = false;
  let previousPointerPosition: { x: number; y: number } | null = null;
  let lastPinchDistance: number | null = null;

  const queueCameraUpdate = (event: Event) => {
    if (!activeScene || !orbit) return;

    nextCamera = cameraFromOrbit(orbit, activeScene.camera);
    lastEvent = event;

    if (framePending) return;

    framePending = true;
    const nextFrame = requestFrame(() => {
      framePending = false;
      frame = null;
      if (disposed || !attached || !activeScene?.cameraNode || !orbit || !nextCamera) return;

      const camera = nextCamera;
      const cameraNode = activeScene.cameraNode;
      const eventOrbit = {
        radius: orbit.radius,
        yaw: orbit.yaw,
        pitch: orbit.pitch
      };
      const originalEvent = lastEvent;

      nextCamera = null;
      renderer.setCamera(camera);
      dispatchNodeEvent(cameraNode, 'camerachange', {
        detail: {
          camera,
          orbit: eventOrbit
        },
        originalEvent
      });
      activeScene.camera = camera;
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
    nextCamera = null;
    lastEvent = undefined;
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
    dragging = true;
    previousPointerPosition = { x: mouseEvent.clientX, y: mouseEvent.clientY };
  };

  const onMouseMove = (event: Event) => {
    const mouseEvent = event as MouseEvent;
    if (!dragging || !activeScene || !activePointerControls || !orbit || !previousPointerPosition) {
      return;
    }

    mouseEvent.preventDefault();
    const dx = mouseEvent.clientX - previousPointerPosition.x;
    const dy = mouseEvent.clientY - previousPointerPosition.y;
    previousPointerPosition = { x: mouseEvent.clientX, y: mouseEvent.clientY };
    orbit = rotateOrbit(orbit, dx, dy, {
      minDistance: activeScene.cameraController!.minDistance,
      maxDistance: activeScene.cameraController!.maxDistance,
      invert: activeScene.cameraController!.invert,
      rotateSpeed: activePointerControls.rotateSpeed
    });
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
    previousPointerPosition = null;
  };

  const onTouchStart = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (!activePointerControls || !orbit) return;

    if (touchEvent.touches.length === 1 && allowsTouchOrbit(activePointerControls)) {
      touchEvent.preventDefault();
      previousPointerPosition = touchPosition(touchEvent.touches[0]);
      lastPinchDistance = null;
      return;
    }

    if (touchEvent.touches.length >= 2 && allowsTouchPinch(activePointerControls)) {
      touchEvent.preventDefault();
      previousPointerPosition = null;
      lastPinchDistance = pinchDistance(touchEvent.touches[0], touchEvent.touches[1]);
    }
  };

  const onTouchMove = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (!activeScene || !activePointerControls || !orbit) return;

    if (touchEvent.touches.length === 1 && allowsTouchOrbit(activePointerControls)) {
      touchEvent.preventDefault();
      const position = touchPosition(touchEvent.touches[0]);
      if (!previousPointerPosition) {
        previousPointerPosition = position;
        return;
      }

      const dx = position.x - previousPointerPosition.x;
      const dy = position.y - previousPointerPosition.y;
      previousPointerPosition = position;
      lastPinchDistance = null;
      orbit = rotateOrbit(orbit, dx, dy, {
        minDistance: activeScene.cameraController!.minDistance,
        maxDistance: activeScene.cameraController!.maxDistance,
        invert: activeScene.cameraController!.invert,
        rotateSpeed: activePointerControls.rotateSpeed
      });
      queueCameraUpdate(touchEvent);
      return;
    }

    if (touchEvent.touches.length >= 2 && allowsTouchPinch(activePointerControls)) {
      touchEvent.preventDefault();
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

  const onTouchEnd = (event: Event) => {
    const touchEvent = event as TouchEvent;
    if (
      activePointerControls &&
      touchEvent.touches.length === 1 &&
      allowsTouchOrbit(activePointerControls)
    ) {
      previousPointerPosition = touchPosition(touchEvent.touches[0]);
      lastPinchDistance = null;
      return;
    }

    dragging = false;
    previousPointerPosition = null;
    lastPinchDistance = null;
  };

  const canvasListeners: ListenerRegistration[] = [
    ['wheel', onWheel, { passive: false }],
    ['mousedown', onMouseDown],
    ['touchstart', onTouchStart, { passive: false }],
    ['touchmove', onTouchMove, { passive: false }]
  ];
  const windowListeners: ListenerRegistration[] = [
    ['mousemove', onMouseMove],
    ['mouseup', onMouseUp],
    ['touchmove', onTouchMove, { passive: false }],
    ['touchend', onTouchEnd]
  ];

  function attach(): void {
    if (attached) return;

    for (const [type, listener, options] of canvasListeners) {
      canvas.addEventListener(type, listener, options);
    }

    for (const [type, listener, options] of windowListeners) {
      windowTarget.addEventListener(type, listener, options);
    }

    attached = true;
  }

  function detach(): void {
    cancelPendingCameraUpdate();
    activeScene = null;
    activePointerControls = null;
    orbit = null;
    dragging = false;
    previousPointerPosition = null;
    lastPinchDistance = null;

    if (!attached) return;

    for (const [type, listener] of canvasListeners) {
      canvas.removeEventListener(type, listener);
    }

    for (const [type, listener] of windowListeners) {
      windowTarget.removeEventListener(type, listener);
    }

    attached = false;
  }

  return {
    reconcile(nextScene) {
      if (disposed) return;

      const cameraController = nextScene.cameraController;
      if (
        nextScene.cameraNode !== null &&
        cameraController?.kind === 'orbit' &&
        cameraController.pointer !== null
      ) {
        if (activeScene !== null && activeScene !== nextScene) {
          cancelPendingCameraUpdate();
        }

        activeScene = nextScene;
        activePointerControls = cameraController.pointer;
        orbit = deriveOrbitState(nextScene.camera, {
          minDistance: cameraController.minDistance,
          maxDistance: cameraController.maxDistance
        });
        attach();
      } else {
        detach();
      }
    },
    dispose() {
      if (disposed) return;

      disposed = true;
      detach();
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
