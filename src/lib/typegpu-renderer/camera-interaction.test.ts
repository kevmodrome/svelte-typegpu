import { describe, expect, it, vi } from 'vitest';
import { createCameraInteractionController } from './camera-interaction';
import type {
  TypeGpuCameraSettings,
  TypeGpuPointerControls,
  TypeGpuSceneState
} from './types';
import { addEventListener, createElement, type TypeGpuNode } from './core';

class FakeEventTarget {
  #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;

    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    listeners.add(listener);
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null): void {
    if (!listener) return;

    const listeners = this.#listeners.get(type);
    listeners?.delete(listener);
  }

  dispatch<T extends Event>(type: string, init: Partial<T> = {}): T {
    const event = { type, preventDefault: vi.fn(), ...init } as unknown as T;

    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }

    return event;
  }

  listenerCount(type?: string): number {
    if (type) return this.#listeners.get(type)?.size ?? 0;

    return [...this.#listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

const camera: TypeGpuCameraSettings = {
  position: [0, 0, 5],
  lookAt: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

const pointerControls: TypeGpuPointerControls = {
  dragButton: 'primary',
  rotateSpeed: 1,
  wheel: 'zoom',
  zoomSpeed: 1,
  touch: 'orbit-pinch'
};

function sceneState({
  cameraNode = createElement('camera'),
  controller = 'orbit',
  pointer = pointerControls
}: {
  cameraNode?: TypeGpuNode | null;
  controller?: 'orbit' | null;
  pointer?: TypeGpuPointerControls | null | true;
} = {}): TypeGpuSceneState {
  return {
    camera,
    cameraNode,
    cameraController:
      controller === 'orbit'
        ? {
            kind: 'orbit',
            minDistance: 1,
            maxDistance: 100,
            invert: false,
            pointer: pointer === true ? pointerControls : pointer,
            keyboard: null
          }
        : null,
    scale: 1,
    animationSpeed: 1,
    colorShift: 0,
    lights: [],
    lightsChanged: false,
    drawBatches: []
  };
}

type SetCameraMock = ReturnType<typeof vi.fn<(camera: TypeGpuCameraSettings) => void>>;
type TestRequestFrame = (callback: FrameRequestCallback) => number;
type TestCancelFrame = (handle: number) => void;

function fakeRenderer(): { setCamera: SetCameraMock } {
  return {
    setCamera: vi.fn<(camera: TypeGpuCameraSettings) => void>()
  };
}

function fakeCanvas(): FakeEventTarget & { clientHeight: number } {
  return Object.assign(new FakeEventTarget(), { clientHeight: 600 });
}

function fakeFrameScheduler(): {
  requestFrame: ReturnType<typeof vi.fn<TestRequestFrame>>;
  cancelFrame: ReturnType<typeof vi.fn<TestCancelFrame>>;
  runFrame(): void;
} {
  let callback: FrameRequestCallback | null = null;
  const requestFrame = vi.fn<TestRequestFrame>((nextCallback) => {
    callback = nextCallback;
    return 42;
  });
  const cancelFrame = vi.fn<TestCancelFrame>(() => {
    callback = null;
  });

  return {
    requestFrame,
    cancelFrame,
    runFrame() {
      callback?.(100);
    }
  };
}

describe('TypeGPU camera interaction controller', () => {
  it('attaches pointer listeners only for active pointer controls', () => {
    const inactiveCanvas = new FakeEventTarget();
    const inactiveWindow = new FakeEventTarget();
    const inactive = createCameraInteractionController({
      canvas: inactiveCanvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: inactiveWindow as unknown as Window
    });

    inactive.reconcile(sceneState({ controller: null }));
    expect(inactiveCanvas.listenerCount()).toBe(0);
    expect(inactiveWindow.listenerCount()).toBe(0);

    inactive.reconcile(sceneState({ pointer: null }));
    expect(inactiveCanvas.listenerCount()).toBe(0);
    expect(inactiveWindow.listenerCount()).toBe(0);

    inactive.reconcile(sceneState({ cameraNode: null }));
    expect(inactiveCanvas.listenerCount()).toBe(0);
    expect(inactiveWindow.listenerCount()).toBe(0);

    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const active = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    active.reconcile(sceneState());

    expect(canvas.listenerCount('wheel')).toBe(1);
    expect(canvas.listenerCount('mousedown')).toBe(1);
    expect(canvas.listenerCount('touchstart')).toBe(1);
    expect(canvas.listenerCount('touchmove')).toBe(1);
    expect(windowTarget.listenerCount('mousemove')).toBe(1);
    expect(windowTarget.listenerCount('mouseup')).toBe(1);
    expect(windowTarget.listenerCount('touchmove')).toBe(1);
    expect(windowTarget.listenerCount('touchend')).toBe(1);
  });

  it('removes listeners when reconciled with no active pointer controls', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState());
    expect(canvas.listenerCount()).toBe(4);
    expect(windowTarget.listenerCount()).toBe(4);

    controller.reconcile(sceneState({ pointer: null }));

    expect(canvas.listenerCount()).toBe(0);
    expect(windowTarget.listenerCount()).toBe(0);
  });

  it('removes listeners on dispose', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState());
    expect(canvas.listenerCount()).toBe(4);
    expect(windowTarget.listenerCount()).toBe(4);

    controller.dispose();

    expect(canvas.listenerCount()).toBe(0);
    expect(windowTarget.listenerCount()).toBe(0);
  });

  it('schedules a camera update from wheel input', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const frames = fakeFrameScheduler();
    const scene = sceneState();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame
    });

    controller.reconcile(scene);
    canvas.dispatch<WheelEvent>('wheel', { deltaY: 0, deltaMode: 0 } as Partial<WheelEvent>);

    expect(frames.requestFrame).toHaveBeenCalledOnce();
    expect(renderer.setCamera).not.toHaveBeenCalled();

    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledWith(scene.camera);
  });

  it('zooms the camera from wheel input and dispatches camerachange', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const cameraNode = createElement('camera');
    const cameraChanges: unknown[] = [];
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: (callback: FrameRequestCallback) => {
        callback(100);
        return 42;
      }
    });

    addEventListener(cameraNode, 'camerachange', (event) => {
      cameraChanges.push(event);
    });

    controller.reconcile(sceneState({ cameraNode, pointer: true }));
    canvas.dispatch<WheelEvent>('wheel', {
      deltaY: 60,
      deltaMode: 0,
      preventDefault: vi.fn()
    } as Partial<WheelEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.lookAt).toEqual(camera.lookAt);
    expect(nextCamera.fov).toBe(camera.fov);
    expect(nextCamera.near).toBe(camera.near);
    expect(nextCamera.far).toBe(camera.far);
    expect(nextCamera.position[2]).toBeGreaterThan(5);

    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      type: 'camerachange',
      detail: {
        camera: nextCamera,
        orbit: {
          radius: expect.any(Number),
          yaw: expect.any(Number),
          pitch: expect.any(Number)
        }
      }
    });
  });

  it('rotates the camera from primary mouse drag', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: (callback: FrameRequestCallback) => {
        callback(100);
        return 42;
      }
    });

    controller.reconcile(sceneState({ pointer: true }));
    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mousemove', { clientX: 110, clientY: 20 } as Partial<
      MouseEvent
    >);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[0]).toBeLessThan(0);
  });

  it('schedules a camera update from touchmove input', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const frames = fakeFrameScheduler();
    const scene = sceneState();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame
    });

    controller.reconcile(scene);
    canvas.dispatch<TouchEvent>('touchstart', {
      touches: [{ clientX: 10, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);
    windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 10, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);

    expect(frames.requestFrame).toHaveBeenCalledOnce();
    expect(renderer.setCamera).not.toHaveBeenCalled();

    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledWith(scene.camera);
  });

  it('cancels a pending camera update when controls become inactive', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const frames = fakeFrameScheduler();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame
    });

    controller.reconcile(sceneState());
    canvas.dispatch<WheelEvent>('wheel', { deltaY: 0, deltaMode: 0 } as Partial<WheelEvent>);
    controller.reconcile(sceneState({ pointer: null }));

    expect(frames.cancelFrame).toHaveBeenCalledWith(42);

    frames.runFrame();

    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('cancels a pending camera update on dispose', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const frames = fakeFrameScheduler();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame
    });

    controller.reconcile(sceneState());
    canvas.dispatch<WheelEvent>('wheel', { deltaY: 0, deltaMode: 0 } as Partial<WheelEvent>);
    controller.dispose();

    expect(frames.cancelFrame).toHaveBeenCalledWith(42);

    frames.runFrame();

    expect(renderer.setCamera).not.toHaveBeenCalled();
  });
});
