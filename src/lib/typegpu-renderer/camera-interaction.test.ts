import { describe, expect, it, vi } from 'vitest';
import { createCameraInteractionController } from './camera-interaction';
import type {
  TypeGpuCameraSettings,
  TypeGpuPointerControls,
  TypeGpuSceneState
} from './types';
import type { TypeGpuNode } from './core';

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

  dispatch(type: string): void {
    const event = { type } as Event;

    for (const listener of this.#listeners.get(type) ?? []) {
      if (typeof listener === 'function') {
        listener(event);
      } else {
        listener.handleEvent(event);
      }
    }
  }

  listenerCount(type?: string): number {
    if (type) return this.#listeners.get(type)?.size ?? 0;

    return [...this.#listeners.values()].reduce((count, listeners) => count + listeners.size, 0);
  }
}

const camera: TypeGpuCameraSettings = {
  position: [9, 7, 13],
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
  cameraNode = {} as TypeGpuNode,
  controller = 'orbit',
  pointer = pointerControls
}: {
  cameraNode?: TypeGpuNode | null;
  controller?: 'orbit' | null;
  pointer?: TypeGpuPointerControls | null;
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
            pointer,
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

function fakeRenderer(): { setCamera: ReturnType<typeof vi.fn> } {
  return {
    setCamera: vi.fn()
  };
}

function fakeFrameScheduler(): {
  requestFrame: ReturnType<typeof vi.fn>;
  cancelFrame: ReturnType<typeof vi.fn>;
  runFrame(): void;
} {
  let callback: FrameRequestCallback | null = null;
  const requestFrame = vi.fn((nextCallback: FrameRequestCallback) => {
    callback = nextCallback;
    return 42;
  });
  const cancelFrame = vi.fn(() => {
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
    canvas.dispatch('wheel');

    expect(frames.requestFrame).toHaveBeenCalledOnce();
    expect(renderer.setCamera).not.toHaveBeenCalled();

    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledWith(scene.camera);
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
    windowTarget.dispatch('touchmove');

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
    canvas.dispatch('wheel');
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
    canvas.dispatch('wheel');
    controller.dispose();

    expect(frames.cancelFrame).toHaveBeenCalledWith(42);

    frames.runFrame();

    expect(renderer.setCamera).not.toHaveBeenCalled();
  });
});
