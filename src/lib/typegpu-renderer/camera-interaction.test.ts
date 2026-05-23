import { describe, expect, it, vi } from 'vitest';
import {
  applyCameraChange,
  clampSceneControls,
  DEFAULT_SCENE_CONTROLS,
  type CameraChangeDetail
} from '../scene-controls';
import { createCameraInteractionController } from './camera-interaction';
import type {
  TypeGpuCameraSettings,
  TypeGpuPointerControls,
  TypeGpuSceneState
} from './types';
import { addEventListener, createElement, type TypeGpuNode } from './core';

class FakeEventTarget {
  #listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
  #listenerOptions = new Map<string, AddEventListenerOptions | boolean | undefined>();

  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean
  ): void {
    if (!listener) return;

    let listeners = this.#listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.#listeners.set(type, listeners);
    }

    listeners.add(listener);
    this.#listenerOptions.set(type, options);
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

  listenerOptions(type: string): AddEventListenerOptions | boolean | undefined {
    return this.#listenerOptions.get(type);
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
  cameraSettings = camera,
  cameraNode = createElement('camera'),
  controller = 'orbit',
  pointer = pointerControls
}: {
  cameraSettings?: TypeGpuCameraSettings;
  cameraNode?: TypeGpuNode | null;
  controller?: 'orbit' | null;
  pointer?: TypeGpuPointerControls | null | true;
} = {}): TypeGpuSceneState {
  return {
    camera: cameraSettings,
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
    expect(canvas.listenerCount('contextmenu')).toBe(1);
    expect(canvas.listenerCount('touchstart')).toBe(1);
    expect(canvas.listenerCount('touchmove')).toBe(1);
    expect(windowTarget.listenerCount('mousemove')).toBe(1);
    expect(windowTarget.listenerCount('mouseup')).toBe(1);
    expect(windowTarget.listenerCount('touchmove')).toBe(1);
    expect(windowTarget.listenerCount('touchend')).toBe(1);
    expect(windowTarget.listenerCount('touchcancel')).toBe(1);
    expect(canvas.listenerOptions('wheel')).toEqual({ passive: false });
    expect(canvas.listenerOptions('mousedown')).toEqual({ passive: false });
    expect(canvas.listenerOptions('contextmenu')).toEqual({ passive: false });
    expect(canvas.listenerOptions('touchstart')).toEqual({ passive: false });
    expect(canvas.listenerOptions('touchmove')).toEqual({ passive: false });
    expect(windowTarget.listenerOptions('mousemove')).toEqual({ passive: false });
    expect(windowTarget.listenerOptions('touchmove')).toEqual({ passive: false });
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
    expect(canvas.listenerCount()).toBe(5);
    expect(windowTarget.listenerCount()).toBe(5);

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
    expect(canvas.listenerCount()).toBe(5);
    expect(windowTarget.listenerCount()).toBe(5);

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

    const scene = sceneState({ cameraNode, pointer: true });
    controller.reconcile(scene);
    const wheelEvent = canvas.dispatch<WheelEvent>('wheel', {
      deltaY: 60,
      deltaMode: 0,
      preventDefault: vi.fn()
    } as Partial<WheelEvent>);

    expect(wheelEvent.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.lookAt).toEqual(camera.lookAt);
    expect(nextCamera.fov).toBe(camera.fov);
    expect(nextCamera.near).toBe(camera.near);
    expect(nextCamera.far).toBe(camera.far);
    expect(nextCamera.position[2]).toBeGreaterThan(5);
    expect(scene.camera).toEqual(nextCamera);

    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      type: 'camerachange',
      originalEvent: wheelEvent,
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

  it('cancels pending camera work when replaced by another active scene', () => {
    const canvas = fakeCanvas();
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
    const firstScene = sceneState();
    const secondScene = sceneState({
      cameraNode: createElement('camera'),
      pointer: true
    });
    secondScene.camera = {
      ...camera,
      position: [0, 0, 12],
      far: 250
    };

    controller.reconcile(firstScene);
    canvas.dispatch<WheelEvent>('wheel', { deltaY: 60, deltaMode: 0 } as Partial<WheelEvent>);
    controller.reconcile(secondScene);
    frames.runFrame();

    expect(frames.cancelFrame).toHaveBeenCalledWith(42);
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('keeps pending orbit state when the same camera reconciles before frame flush', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const frames = fakeFrameScheduler();
    const cameraNode = createElement('camera');
    const cameraChanges: unknown[] = [];
    const scene = sceneState({ cameraNode, pointer: true });
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: frames.requestFrame,
      cancelFrame: frames.cancelFrame
    });

    addEventListener(cameraNode, 'camerachange', (event) => {
      cameraChanges.push(event);
    });

    controller.reconcile(scene);
    canvas.dispatch<WheelEvent>('wheel', { deltaY: 60, deltaMode: 0 } as Partial<WheelEvent>);
    controller.reconcile({
      ...scene,
      cameraController: {
        ...scene.cameraController!,
        pointer: { ...pointerControls }
      }
    });
    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[2]).toBeGreaterThan(5);
    expect(cameraChanges).toHaveLength(1);
    expect(
      (cameraChanges[0] as { detail: { orbit: { radius: number } } }).detail.orbit.radius
    ).toBeGreaterThan(5);
  });

  it('resets stale drag state when replaced by another active scene', () => {
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
    const firstScene = sceneState();
    const secondScene = sceneState({
      cameraNode: createElement('camera'),
      pointer: true
    });
    secondScene.camera = {
      ...camera,
      position: [0, 0, 12]
    };

    controller.reconcile(firstScene);
    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    controller.reconcile(secondScene);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('stops mouse drag if the button is no longer pressed', () => {
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
    const releasedMove = windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 0,
      clientX: 110,
      clientY: 20,
      preventDefault: vi.fn()
    } as Partial<MouseEvent>);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 130,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(releasedMove.preventDefault).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
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
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[0]).toBeLessThan(0);
  });

  it('continues dragging after app camera-change state is reconciled', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const cameraNode = createElement('camera');
    const controls = clampSceneControls({
      ...DEFAULT_SCENE_CONTROLS,
      camera
    });
    const scene = sceneState({ cameraNode, pointer: true });
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
      applyCameraChange(controls, event.detail as CameraChangeDetail);
    });

    controller.reconcile(scene);
    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    expect(controls.camera.position).toEqual(renderer.setCamera.mock.calls[0][0].position);

    controller.reconcile(
      sceneState({
        cameraSettings: controls.camera,
        cameraNode,
        pointer: true
      })
    );
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 130,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).toHaveBeenCalledTimes(2);
  });

  it('rotates the camera from middle mouse drag', () => {
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

    controller.reconcile(
      sceneState({ pointer: { ...pointerControls, dragButton: 'middle' } })
    );
    canvas.dispatch<MouseEvent>('mousedown', { button: 1, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 4,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
  });

  it('rotates the camera from secondary mouse drag', () => {
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

    controller.reconcile(
      sceneState({ pointer: { ...pointerControls, dragButton: 'secondary' } })
    );
    canvas.dispatch<MouseEvent>('mousedown', { button: 2, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 2,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
  });

  it('prevents the context menu for secondary mouse drag controls only', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState({ pointer: true }));
    const primaryContextMenu = canvas.dispatch<MouseEvent>('contextmenu', {
      preventDefault: vi.fn()
    } as Partial<MouseEvent>);

    controller.reconcile(
      sceneState({ pointer: { ...pointerControls, dragButton: 'secondary' } })
    );
    const secondaryContextMenu = canvas.dispatch<MouseEvent>('contextmenu', {
      preventDefault: vi.fn()
    } as Partial<MouseEvent>);

    expect(primaryContextMenu.preventDefault).not.toHaveBeenCalled();
    expect(secondaryContextMenu.preventDefault).toHaveBeenCalledOnce();
  });

  it('rotates the camera from one-finger touch movement', () => {
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
    canvas.dispatch<TouchEvent>('touchstart', {
      touches: [{ clientX: 10, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);
    const touchMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 110, clientY: 20 }],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);

    expect(touchMove.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).not.toEqual(camera.position);
    expect(nextCamera.position[0]).toBeLessThan(0);
    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      originalEvent: touchMove,
      detail: {
        camera: nextCamera
      }
    });
  });

  it('zooms the camera from two-finger pinch movement', () => {
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
    canvas.dispatch<TouchEvent>('touchstart', {
      touches: [
        { clientX: 0, clientY: 0 },
        { clientX: 100, clientY: 0 }
      ]
    } as unknown as Partial<TouchEvent>);
    const touchMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [
        { clientX: 0, clientY: 0 },
        { clientX: 140, clientY: 0 }
      ],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);

    expect(touchMove.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).not.toEqual(camera.position);
    expect(nextCamera.position[2]).toBeLessThan(5);
    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      originalEvent: touchMove,
      detail: {
        camera: nextCamera,
        orbit: {
          radius: expect.any(Number)
        }
      }
    });
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

  it('ignores window touchmove before a canvas touchstart starts a gesture', () => {
    const canvas = fakeCanvas();
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

    controller.reconcile(sceneState({ pointer: true }));
    const firstMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 30, clientY: 20 }],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);
    const secondMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [
        { clientX: 0, clientY: 0 },
        { clientX: 120, clientY: 0 }
      ],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);

    expect(firstMove.preventDefault).not.toHaveBeenCalled();
    expect(secondMove.preventDefault).not.toHaveBeenCalled();
    expect(frames.requestFrame).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('ignores window touchmove after a touch gesture fully ends', () => {
    const canvas = fakeCanvas();
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

    controller.reconcile(sceneState({ pointer: true }));
    canvas.dispatch<TouchEvent>('touchstart', {
      touches: [{ clientX: 10, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);
    windowTarget.dispatch<TouchEvent>('touchend', {
      touches: []
    } as unknown as Partial<TouchEvent>);
    const touchMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 40, clientY: 20 }],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);

    expect(touchMove.preventDefault).not.toHaveBeenCalled();
    expect(frames.requestFrame).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('clears touch gesture state on touchcancel', () => {
    const canvas = fakeCanvas();
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

    controller.reconcile(sceneState({ pointer: true }));
    canvas.dispatch<TouchEvent>('touchstart', {
      touches: [{ clientX: 10, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);
    windowTarget.dispatch<TouchEvent>('touchcancel', {
      touches: []
    } as unknown as Partial<TouchEvent>);
    const touchMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 40, clientY: 20 }],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);

    expect(touchMove.preventDefault).not.toHaveBeenCalled();
    expect(frames.requestFrame).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('does not continue pinch as orbit after touchend leaves one touch', () => {
    const canvas = fakeCanvas();
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

    controller.reconcile(sceneState({ pointer: true }));
    canvas.dispatch<TouchEvent>('touchstart', {
      touches: [
        { clientX: 0, clientY: 0 },
        { clientX: 100, clientY: 0 }
      ]
    } as unknown as Partial<TouchEvent>);
    windowTarget.dispatch<TouchEvent>('touchend', {
      touches: [{ clientX: 0, clientY: 0 }]
    } as unknown as Partial<TouchEvent>);
    const touchMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 40, clientY: 0 }],
      preventDefault: vi.fn()
    } as unknown as Partial<TouchEvent>);

    expect(touchMove.preventDefault).not.toHaveBeenCalled();
    expect(frames.requestFrame).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('ignores touch input when touch controls are disabled', () => {
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
    const disabledTouch = { ...pointerControls, touch: 'none' as const };

    controller.reconcile(sceneState({ pointer: disabledTouch }));
    const touchStart = canvas.dispatch<TouchEvent>('touchstart', {
      touches: [{ clientX: 10, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);
    const touchMove = windowTarget.dispatch<TouchEvent>('touchmove', {
      touches: [{ clientX: 30, clientY: 20 }]
    } as unknown as Partial<TouchEvent>);

    expect(touchStart.preventDefault).not.toHaveBeenCalled();
    expect(touchMove.preventDefault).not.toHaveBeenCalled();
    expect(frames.requestFrame).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
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
