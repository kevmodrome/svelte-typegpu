import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuSceneState } from './types';

type RequestFrame = (callback: FrameRequestCallback) => number;
type CancelFrame = (handle: number) => void;
type ListenerTarget = Pick<Window, 'addEventListener' | 'removeEventListener'>;

const defaultRequestFrame: RequestFrame = (callback) => {
  if (typeof globalThis.requestAnimationFrame === 'function') {
    return globalThis.requestAnimationFrame(callback);
  }

  return globalThis.setTimeout(() => callback(globalThis.performance?.now() ?? Date.now()), 16);
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
  renderer: TypeGpuRenderer;
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
  let scene: TypeGpuSceneState | null = null;

  const scheduleCameraUpdate = () => {
    if (frame !== null) return;

    frame = requestFrame(() => {
      frame = null;
      if (disposed || !scene) return;

      renderer.setCamera(scene.camera);
    });
  };

  const noop = () => {};
  const onCameraInput = () => scheduleCameraUpdate();
  const canvasListeners: [string, EventListener][] = [
    ['wheel', onCameraInput],
    ['mousedown', noop],
    ['touchstart', noop],
    ['touchmove', onCameraInput]
  ];
  const windowListeners: [string, EventListener][] = [
    ['mousemove', noop],
    ['mouseup', noop],
    ['touchmove', onCameraInput],
    ['touchend', noop]
  ];

  function attach(): void {
    if (attached) return;

    for (const [type, listener] of canvasListeners) {
      canvas.addEventListener(type, listener);
    }

    for (const [type, listener] of windowListeners) {
      windowTarget.addEventListener(type, listener);
    }

    attached = true;
  }

  function detach(): void {
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

      scene = nextScene;

      if (hasActivePointerControls(nextScene)) {
        attach();
      } else {
        detach();
      }
    },
    dispose() {
      if (disposed) return;

      disposed = true;
      detach();

      if (frame !== null) {
        cancelFrame(frame);
        frame = null;
      }

      scene = null;
    }
  };
}

function hasActivePointerControls(scene: TypeGpuSceneState): boolean {
  return (
    scene.cameraNode !== null &&
    scene.cameraController?.kind === 'orbit' &&
    scene.cameraController.pointer !== null
  );
}
