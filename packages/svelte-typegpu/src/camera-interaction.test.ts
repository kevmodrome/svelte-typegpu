import { describe, expect, it, vi } from 'vitest';
import { createCameraInteractionController } from './camera-interaction';
import { Dirty } from './dirty';
import type {
  TypeGpuKeyboardControls,
  TypeGpuCameraSettings,
  TypeGpuControlsController,
  TypeGpuOrbitCameraController,
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
  target: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

interface CameraChangeDetail {
  camera: TypeGpuCameraSettings;
}

interface TestSceneControls {
  camera: TypeGpuCameraSettings;
}

const DEFAULT_SCENE_CONTROLS: TestSceneControls = {
  camera
};

function clampSceneControls(controls: TestSceneControls): TestSceneControls {
  return {
    camera: {
      ...controls.camera,
      position: [...controls.camera.position],
      target: [...controls.camera.target]
    }
  };
}

function applyCameraChange(controls: TestSceneControls, detail: CameraChangeDetail): void {
  controls.camera = {
    ...detail.camera,
    position: [...detail.camera.position],
    target: [...detail.camera.target]
  };
}

const pointerControls: TypeGpuPointerControls = {
  dragButton: 'primary',
  rotateSpeed: 1,
  wheel: 'zoom',
  zoomSpeed: 1,
  touch: 'orbit-pinch'
};

const keyboardControls: TypeGpuKeyboardControls = {
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
  moveStep: 0.35,
  smooth: false,
  step: 0.08
};

function sceneState({
  cameraSettings = camera,
  cameraNode = createElement('camera'),
  cameraControllerNode = cameraNode,
  controller = 'orbit',
  pointer = pointerControls,
  keyboard = null
}: {
  cameraSettings?: TypeGpuCameraSettings;
  cameraNode?: TypeGpuNode | null;
  cameraControllerNode?: TypeGpuNode | null;
  controller?: 'orbit' | 'fly' | TypeGpuOrbitCameraController | null;
  pointer?: TypeGpuPointerControls | null | true;
  keyboard?: TypeGpuKeyboardControls | null | true;
} = {}): TypeGpuSceneState {
  return {
    dirty: Dirty.None,
    camera: cameraSettings,
    cameraNode,
    cameraControllerNode,
    cameraController:
      typeof controller === 'object'
        ? controller
        : controller !== null
        ? {
            kind: 'controls',
            mode: controller,
            minDistance: 1,
            maxDistance: 100,
            invert: false,
            pointer: pointer === true ? pointerControls : pointer,
            keyboard: keyboard === true ? keyboardControls : keyboard
          }
        : null,
    scale: 1,
    animationSpeed: 1,
    colorShift: 0,
    lights: [],
    lightsChanged: false,
    drawBatches: [],
    drawBatchesChanged: false,
    renderSettings: {
      clearColor: [0, 0, 0, 1],
      depth: true,
      alphaMode: 'premultiplied'
    },
    interaction: {
      targets: [],
      pick: () => null
    },
    interactionChanged: false,
    liveResourceKeys: {
      geometries: new Set(),
      materials: new Set(),
      textures: new Set(),
      samplers: new Set(),
      pipelines: new Set()
    }
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

function directOrbitControls(
  overrides: Partial<TypeGpuOrbitCameraController> = {}
): TypeGpuOrbitCameraController {
  return {
    kind: 'orbit',
    camera: 'main',
    enabled: true,
    mode: 'orbit',
    target: [0, 0, 0],
    minDistance: 1,
    maxDistance: 100,
    invert: false,
    enablePan: true,
    enableZoom: true,
    enableRotate: true,
    rotateSpeed: 1,
    zoomSpeed: 1,
    keyboard: null,
    ...overrides
  };
}

function fakeFocusableCanvas(): FakeEventTarget & {
  clientHeight: number;
  tabIndex: number;
  focus: ReturnType<typeof vi.fn<() => void>>;
  hasAttribute(name: string): boolean;
} {
  return Object.assign(new FakeEventTarget(), {
    clientHeight: 600,
    tabIndex: -1,
    focus: vi.fn<() => void>(),
    hasAttribute: vi.fn((name: string) => name === 'tabindex' && false)
  });
}

function fakeFrameScheduler(): {
  requestFrame: ReturnType<typeof vi.fn<TestRequestFrame>>;
  cancelFrame: ReturnType<typeof vi.fn<TestCancelFrame>>;
  pendingCount(): number;
  runFrame(time?: number): void;
} {
  const callbacks = new Map<number, FrameRequestCallback>();
  let nextHandle = 42;
  const requestFrame = vi.fn<TestRequestFrame>((nextCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, nextCallback);
    return handle;
  });
  const cancelFrame = vi.fn<TestCancelFrame>((handle) => {
    callbacks.delete(handle);
  });

  return {
    requestFrame,
    cancelFrame,
    pendingCount() {
      return callbacks.size;
    },
    runFrame(time = 100) {
      const next = callbacks.entries().next().value;
      if (!next) return;

      const [handle, callback] = next;

      callbacks.delete(handle);
      callback(time);
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

  it('attaches pointer listeners for direct orbit controls', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(
      sceneState({
        controller: directOrbitControls({
          rotateSpeed: 1.5,
          zoomSpeed: 0.75
        })
      })
    );

    expect(canvas.listenerCount('wheel')).toBe(1);
    expect(canvas.listenerCount('mousedown')).toBe(1);
    expect(windowTarget.listenerCount('mousemove')).toBe(1);
  });

  it('does not attach input listeners for disabled direct orbit controls', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(
      sceneState({
        controller: directOrbitControls({ enabled: false })
      })
    );

    expect(canvas.listenerCount()).toBe(0);
    expect(windowTarget.listenerCount()).toBe(0);
  });

  it('zooms from direct orbit controls and dispatches camerachange from the orbit node', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const orbitNode = createElement('orbitControls');
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

    addEventListener(orbitNode, 'camerachange', (event) => {
      cameraChanges.push(event);
    });

    const scene = sceneState({
      cameraControllerNode: orbitNode,
      controller: directOrbitControls({
        minDistance: 3,
        maxDistance: 6,
        rotateSpeed: 1.25,
        zoomSpeed: 2
      })
    });
    controller.reconcile(scene);
    const wheelEvent = canvas.dispatch<WheelEvent>('wheel', {
      deltaY: 120,
      deltaMode: 0,
      preventDefault: vi.fn()
    } as Partial<WheelEvent>);

    expect(wheelEvent.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[2]).toBe(6);
    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      target: orbitNode,
      originalEvent: wheelEvent,
      detail: {
        camera: nextCamera,
        orbit: {
          radius: 6,
          yaw: expect.any(Number),
          pitch: expect.any(Number)
        }
      }
    });
  });

  it('rotates from direct orbit keyboard controls and dispatches camerachange from the orbit node', () => {
    const canvas = fakeFocusableCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const orbitNode = createElement('orbitControls');
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

    addEventListener(orbitNode, 'camerachange', (event) => {
      cameraChanges.push(event);
    });

    controller.reconcile(
      sceneState({
        cameraControllerNode: orbitNode,
        controller: directOrbitControls({ keyboard: keyboardControls })
      })
    );
    const keyEvent = canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(canvas.tabIndex).toBe(0);
    expect(canvas.listenerCount('keydown')).toBe(1);
    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[0]).toBeLessThan(0);
    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      target: orbitNode,
      originalEvent: keyEvent,
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

  it('uses direct orbit fly keyboard controls for smooth diagonal movement', () => {
    const canvas = fakeFocusableCanvas();
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

    controller.reconcile(
      sceneState({
        controller: directOrbitControls({
          keyboard: { ...keyboardControls, smooth: true },
          mode: 'fly'
        } as Partial<TypeGpuOrbitCameraController>)
      })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'a',
      code: 'KeyA',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(renderer.setCamera).not.toHaveBeenCalled();
    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).toEqual([-0.247487, 0, 4.752513]);
    expect(nextCamera.target).toEqual([-0.247487, 0, -0.247487]);
    expect(frames.pendingCount()).toBe(1);
  });

  it('uses direct orbit fly keyboard controls for rotation and movement in one smooth frame', () => {
    const canvas = fakeFocusableCanvas();
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

    controller.reconcile(
      sceneState({
        controller: directOrbitControls({
          keyboard: { ...keyboardControls, smooth: true },
          mode: 'fly'
        } as Partial<TypeGpuOrbitCameraController>)
      })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[0]).toBeGreaterThan(0);
    expect(nextCamera.position[2]).toBeLessThan(5);
    expect(nextCamera.target[0]).toBeGreaterThan(nextCamera.position[0]);
  });

  it('honors disabled direct orbit rotation while keeping wheel zoom active', () => {
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
      sceneState({
        controller: directOrbitControls({
          enableRotate: false,
          enableZoom: true
        })
      })
    );
    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    expect(renderer.setCamera).not.toHaveBeenCalled();

    canvas.dispatch<WheelEvent>('wheel', { deltaY: 60, deltaMode: 0 } as Partial<WheelEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
  });

  it('attaches scoped canvas listeners for active keyboard controls', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));

    expect(canvas.listenerCount()).toBe(4);
    expect(canvas.listenerCount('keydown')).toBe(1);
    expect(canvas.listenerCount('keyup')).toBe(1);
    expect(canvas.listenerCount('blur')).toBe(1);
    expect(canvas.listenerCount('pointerdown')).toBe(1);
    expect(windowTarget.listenerCount()).toBe(0);
  });

  it('makes the canvas focusable for keyboard controls', () => {
    const canvas = fakeFocusableCanvas();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));

    expect(canvas.tabIndex).toBe(0);
  });

  it('focuses the canvas before keyboard controls are used', () => {
    const canvas = fakeFocusableCanvas();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));
    canvas.dispatch<PointerEvent>('pointerdown');

    expect(canvas.focus).toHaveBeenCalledOnce();
  });

  it('removes keyboard listeners when controls become inactive', () => {
    const canvas = new FakeEventTarget();
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer: fakeRenderer(),
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));
    expect(canvas.listenerCount('keydown')).toBe(1);

    controller.reconcile(sceneState({ controller: null }));

    expect(canvas.listenerCount()).toBe(0);
    expect(windowTarget.listenerCount()).toBe(0);
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
    expect(nextCamera.target).toEqual(camera.target);
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
        ...(scene.cameraController as TypeGpuControlsController),
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

  it('suppresses the next click after mouse drag movement', () => {
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
    windowTarget.dispatch<MouseEvent>('mouseup', { button: 0 } as Partial<MouseEvent>);

    expect(controller.consumeSuppressedClick()).toBe(true);
    expect(controller.consumeSuppressedClick()).toBe(false);
  });

  it('suppresses the next click after small mouse drag movement', () => {
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
      clientX: 13,
      clientY: 20
    } as Partial<MouseEvent>);
    windowTarget.dispatch<MouseEvent>('mouseup', { button: 0 } as Partial<MouseEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    expect(controller.consumeSuppressedClick()).toBe(true);
  });

  it('does not suppress clicks for stationary mouse presses', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window
    });

    controller.reconcile(sceneState({ pointer: true }));
    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mouseup', { button: 0 } as Partial<MouseEvent>);

    expect(controller.consumeSuppressedClick()).toBe(false);
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

  it('rotates the target around the camera position in fly mode', () => {
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

    controller.reconcile(sceneState({ controller: 'fly', pointer: true }));
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
    expect(nextCamera.position).toEqual(camera.position);
    expect(nextCamera.target[0]).toBeGreaterThan(0);
    expect(nextCamera.target[2]).toBeGreaterThan(0);
  });

  it('dispatches camera changes from the controls node', () => {
    const canvas = fakeCanvas();
    const windowTarget = new FakeEventTarget();
    const renderer = fakeRenderer();
    const cameraNode = createElement('camera');
    const controlsNode = createElement('controls');
    const cameraChanges: unknown[] = [];
    const cameraNodeChanges: unknown[] = [];
    const controller = createCameraInteractionController({
      canvas: canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget: windowTarget as unknown as Window,
      requestFrame: (callback: FrameRequestCallback) => {
        callback(100);
        return 42;
      }
    });

    addEventListener(controlsNode, 'camerachange', (event) => {
      cameraChanges.push(event);
    });
    addEventListener(cameraNode, 'camerachange', (event) => {
      cameraNodeChanges.push(event);
    });

    controller.reconcile(
      sceneState({ cameraNode, cameraControllerNode: controlsNode, pointer: null, keyboard: true })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(cameraChanges).toHaveLength(1);
    expect(cameraNodeChanges).toHaveLength(0);
  });

  it('rotates the camera from a keyboard shortcut', () => {
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

    controller.reconcile(sceneState({ cameraNode, pointer: null, keyboard: true }));
    const keyEvent = canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[0]).toBeLessThan(0);
    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      originalEvent: keyEvent,
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

  it('rotates the target from a keyboard shortcut in fly mode', () => {
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

    controller.reconcile(sceneState({ controller: 'fly', pointer: null, keyboard: true }));
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).toEqual(camera.position);
    expect(nextCamera.target[0]).toBeGreaterThan(0);
    expect(nextCamera.target[2]).toBeGreaterThan(0);
  });

  it('moves diagonally from combined smooth movement keys', () => {
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

    controller.reconcile(
      sceneState({
        controller: 'fly',
        pointer: null,
        keyboard: { ...keyboardControls, smooth: true }
      })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'a',
      code: 'KeyA',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).toEqual([-0.247487, 0, 4.752513]);
    expect(nextCamera.target).toEqual([-0.247487, 0, -0.247487]);
    expect(frames.pendingCount()).toBe(1);
  });

  it('normalizes every horizontal smooth movement diagonal', () => {
    const cases = [
      {
        keys: [
          ['w', 'KeyW'],
          ['a', 'KeyA']
        ],
        position: [-0.247487, 0, 4.752513],
        target: [-0.247487, 0, -0.247487]
      },
      {
        keys: [
          ['w', 'KeyW'],
          ['d', 'KeyD']
        ],
        position: [0.247487, 0, 4.752513],
        target: [0.247487, 0, -0.247487]
      },
      {
        keys: [
          ['s', 'KeyS'],
          ['a', 'KeyA']
        ],
        position: [-0.247487, 0, 5.247487],
        target: [-0.247487, 0, 0.247487]
      },
      {
        keys: [
          ['s', 'KeyS'],
          ['d', 'KeyD']
        ],
        position: [0.247487, 0, 5.247487],
        target: [0.247487, 0, 0.247487]
      }
    ] as const;

    for (const testCase of cases) {
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

      controller.reconcile(
        sceneState({
          controller: 'fly',
          pointer: null,
          keyboard: { ...keyboardControls, smooth: true }
        })
      );
      for (const [key, code] of testCase.keys) {
        canvas.dispatch<KeyboardEvent>('keydown', {
          key,
          code,
          preventDefault: vi.fn()
        } as Partial<KeyboardEvent>);
      }
      frames.runFrame();

      const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
      expect(nextCamera.position).toEqual(testCase.position);
      expect(nextCamera.target).toEqual(testCase.target);
    }
  });

  it('rotates and moves during the same smooth keyboard frame', () => {
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

    controller.reconcile(
      sceneState({
        controller: 'fly',
        pointer: null,
        keyboard: { ...keyboardControls, smooth: true }
      })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'ArrowLeft',
      code: 'ArrowLeft',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[0]).toBeGreaterThan(0);
    expect(nextCamera.position[2]).toBeLessThan(5);
    expect(nextCamera.target[0]).toBeGreaterThan(nextCamera.position[0]);
  });

  it('does not replay a stale pointer camera snapshot during smooth keyboard movement', () => {
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

    controller.reconcile(
      sceneState({
        controller: 'fly',
        pointer: true,
        keyboard: { ...keyboardControls, smooth: true }
      })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    canvas.dispatch<MouseEvent>('mousedown', {
      button: 0,
      clientX: 10,
      clientY: 20
    } as Partial<MouseEvent>);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);

    frames.runFrame();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const movedCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(movedCamera.position).not.toEqual(camera.position);

    frames.runFrame();

    expect(renderer.setCamera).toHaveBeenCalledTimes(2);
    const queuedPointerCamera = renderer.setCamera.mock.calls[1][0] as TypeGpuCameraSettings;
    expect(queuedPointerCamera.position).toEqual(movedCamera.position);
  });

  it('stops smooth keyboard animation when held keys are released', () => {
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

    controller.reconcile(
      sceneState({
        controller: 'fly',
        pointer: null,
        keyboard: { ...keyboardControls, smooth: true }
      })
    );
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    canvas.dispatch<KeyboardEvent>('keyup', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);
    frames.runFrame();

    expect(frames.cancelFrame).toHaveBeenCalledWith(42);
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('zooms the camera from a keyboard shortcut', () => {
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

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));
    const keyEvent = canvas.dispatch<KeyboardEvent>('keydown', {
      key: '+',
      code: 'Equal',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position[2]).toBeLessThan(camera.position[2]);
  });

  it('moves the camera and target forward from a keyboard shortcut', () => {
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

    controller.reconcile(sceneState({ cameraNode, pointer: null, keyboard: true }));
    const keyEvent = canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'w',
      code: 'KeyW',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(keyEvent.preventDefault).toHaveBeenCalledOnce();
    expect(renderer.setCamera).toHaveBeenCalledOnce();
    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).toEqual([0, 0, 4.65]);
    expect(nextCamera.target).toEqual([0, 0, -0.35]);
    expect(cameraChanges).toHaveLength(1);
    expect(cameraChanges[0]).toMatchObject({
      originalEvent: keyEvent,
      detail: {
        camera: nextCamera,
        orbit: {
          radius: 5,
          yaw: 0,
          pitch: 0
        }
      }
    });
  });

  it('strafes the camera left relative to its facing direction', () => {
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

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'a',
      code: 'KeyA',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).toEqual([-0.35, 0, 5]);
    expect(nextCamera.target).toEqual([-0.35, 0, 0]);
  });

  it('moves the camera vertically from keyboard shortcuts', () => {
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

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));
    canvas.dispatch<KeyboardEvent>('keydown', {
      key: ' ',
      code: 'Space',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    const nextCamera = renderer.setCamera.mock.calls[0][0] as TypeGpuCameraSettings;
    expect(nextCamera.position).toEqual([0, 0.35, 5]);
    expect(nextCamera.target).toEqual([0, 0.35, 0]);
  });

  it('ignores unrelated keyboard shortcuts', () => {
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

    controller.reconcile(sceneState({ pointer: null, keyboard: true }));
    const keyEvent = canvas.dispatch<KeyboardEvent>('keydown', {
      key: 'q',
      code: 'KeyQ',
      preventDefault: vi.fn()
    } as Partial<KeyboardEvent>);

    expect(keyEvent.preventDefault).not.toHaveBeenCalled();
    expect(frames.requestFrame).not.toHaveBeenCalled();
    expect(renderer.setCamera).not.toHaveBeenCalled();
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
