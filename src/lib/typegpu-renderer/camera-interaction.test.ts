import { describe, expect, it, vi } from 'vitest';
import { createCameraInteractionController } from './camera-interaction';
import type { TypeGpuRenderer } from './gpu-renderer';
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

function fakeRenderer(): TypeGpuRenderer {
  return {
    setScene: vi.fn(),
    setCamera: vi.fn(),
    dispose: vi.fn()
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
});
