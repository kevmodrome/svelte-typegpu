import { describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, addEventListener, insert, setAttribute } from './core';
import { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuLoadedModel } from './glb-loader';
import { Dirty, hasDirty } from './dirty';

class FakeCanvas {
  clientWidth = 800;
  clientHeight = 600;
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
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

    this.#listeners.get(type)?.delete(listener);
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
}

function fakeRenderer(): TypeGpuRenderer {
  return {
    setScene: vi.fn(),
    setCamera: vi.fn(),
    invalidate: vi.fn(),
    renderFrame: vi.fn(),
    getRenderSize: vi.fn(() => ({ width: 0, height: 0 })),
    dispose: vi.fn()
  };
}

function loadedModel(key: string): TypeGpuLoadedModel {
  return { key, meshes: [] };
}

describe('TypeGPU Svelte renderer runtime', () => {
  it('does not route a click after orbit dragging the canvas', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const mesh = createElement('mesh');
    const onMeshClick = vi.fn();
    const canvas = new FakeCanvas();
    const windowTarget = new FakeCanvas();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer(),
      windowTarget as unknown as Window
    );

    addEventListener(mesh, 'click', onMeshClick);
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root);
    await Promise.resolve();

    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);
    windowTarget.dispatch<MouseEvent>('mouseup', { button: 0 } as Partial<MouseEvent>);
    canvas.dispatch<MouseEvent>('click', {} as Partial<MouseEvent>);

    expect(onMeshClick).not.toHaveBeenCalled();
  });

  it('routes canvas clicks to the nearest picked mesh', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const far = createElement('mesh');
    const near = createElement('mesh');
    const farGeometry = createElement('boxGeometry');
    const nearGeometry = createElement('boxGeometry');
    const onFarClick = vi.fn();
    const onNearClick = vi.fn();
    const canvas = new FakeCanvas();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer()
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(far, 'position', [0, 0, 0]);
    setAttribute(near, 'position', [0, 0, 5]);
    addEventListener(far, 'click', onFarClick);
    addEventListener(near, 'click', onNearClick);
    insert(far, farGeometry, null);
    insert(near, nearGeometry, null);
    insert(scene, camera, null);
    insert(scene, far, null);
    insert(scene, near, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<MouseEvent>('click', { offsetX: 50, offsetY: 50 } as Partial<MouseEvent>);

    expect(onFarClick).not.toHaveBeenCalled();
    expect(onNearClick).toHaveBeenCalledOnce();
  });

  it('dispatches pointerenter and pointerleave when the picked target changes', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const left = createElement('mesh');
    const right = createElement('mesh');
    const leftGeometry = createElement('boxGeometry');
    const rightGeometry = createElement('boxGeometry');
    const onLeftEnter = vi.fn();
    const onLeftLeave = vi.fn();
    const onRightEnter = vi.fn();
    const canvas = new FakeCanvas();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer()
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(left, 'position', [-2, 0, 0]);
    setAttribute(right, 'position', [2, 0, 0]);
    addEventListener(left, 'pointerenter', onLeftEnter);
    addEventListener(left, 'pointerleave', onLeftLeave);
    addEventListener(right, 'pointerenter', onRightEnter);
    insert(left, leftGeometry, null);
    insert(right, rightGeometry, null);
    insert(scene, camera, null);
    insert(scene, left, null);
    insert(scene, right, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 30, offsetY: 50 } as Partial<
      PointerEvent
    >);
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 30, offsetY: 50 } as Partial<
      PointerEvent
    >);
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 70, offsetY: 50 } as Partial<
      PointerEvent
    >);

    expect(onLeftEnter).toHaveBeenCalledOnce();
    expect(onLeftLeave).toHaveBeenCalledOnce();
    expect(onRightEnter).toHaveBeenCalledOnce();
  });

  it('routes pointermove to the picked mesh', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const far = createElement('mesh');
    const near = createElement('mesh');
    const farGeometry = createElement('boxGeometry');
    const nearGeometry = createElement('boxGeometry');
    const onFarMove = vi.fn();
    const onNearMove = vi.fn();
    const canvas = new FakeCanvas();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer()
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(far, 'position', [0, 0, 0]);
    setAttribute(near, 'position', [0, 0, 5]);
    addEventListener(far, 'pointermove', onFarMove);
    addEventListener(near, 'pointermove', onNearMove);
    insert(far, farGeometry, null);
    insert(near, nearGeometry, null);
    insert(scene, camera, null);
    insert(scene, far, null);
    insert(scene, near, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 50, offsetY: 50 } as Partial<
      PointerEvent
    >);

    expect(onFarMove).not.toHaveBeenCalled();
    expect(onNearMove).toHaveBeenCalledOnce();
  });

  it('dispatches drag events to the captured mesh instead of orbit controls', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const dragEvents: unknown[] = [];
    const pointerUpEvents: unknown[] = [];
    const canvas = new FakeCanvas();
    const windowTarget = new FakeCanvas();
    const renderer = fakeRenderer();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragstart', (event) => dragEvents.push(event));
    addEventListener(mesh, 'dragmove', (event) => dragEvents.push(event));
    addEventListener(mesh, 'dragend', (event) => dragEvents.push(event));
    addEventListener(mesh, 'pointerup', (event) => pointerUpEvents.push(event));
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 50,
      offsetX: 50,
      offsetY: 50
    } as Partial<PointerEvent>);
    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 50, clientY: 50 } as Partial<
      MouseEvent
    >);
    canvas.dispatch<PointerEvent>('pointermove', {
      pointerId: 7,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 65,
      clientY: 55,
      offsetX: 65,
      offsetY: 55
    } as Partial<PointerEvent>);
    windowTarget.dispatch<MouseEvent>('mousemove', {
      buttons: 1,
      clientX: 110,
      clientY: 20
    } as Partial<MouseEvent>);
    canvas.dispatch<PointerEvent>('pointerup', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 70,
      clientY: 60,
      offsetX: 70,
      offsetY: 60
    } as Partial<PointerEvent>);

    expect(dragEvents.map((event) => (event as { type: string }).type)).toEqual([
      'dragstart',
      'dragmove',
      'dragend'
    ]);
    expect(dragEvents).toEqual([
      expect.objectContaining({
        target: mesh,
        detail: expect.objectContaining({
          mode: 'rotate',
          instanceId: mesh.uid,
          pointerId: 7,
          pointerType: 'mouse',
          deltaX: 0,
          deltaY: 0,
          totalDeltaX: 0,
          totalDeltaY: 0
        })
      }),
      expect.objectContaining({
        target: mesh,
        detail: expect.objectContaining({
          mode: 'rotate',
          instanceId: mesh.uid,
          pointerId: 7,
          pointerType: 'mouse',
          deltaX: 15,
          deltaY: 5,
          totalDeltaX: 15,
          totalDeltaY: 5
        })
      }),
      expect.objectContaining({
        target: mesh,
        detail: expect.objectContaining({
          mode: 'rotate',
          instanceId: mesh.uid,
          pointerId: 7,
          pointerType: 'mouse',
          deltaX: 5,
          deltaY: 5,
          totalDeltaX: 20,
          totalDeltaY: 10
        })
      })
    ]);
    expect(pointerUpEvents).toEqual([
      expect.objectContaining({
        target: mesh,
        detail: expect.objectContaining({
          instanceId: mesh.uid,
          point: expect.any(Array)
        })
      })
    ]);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(7);
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(7);
    expect(renderer.setCamera).not.toHaveBeenCalled();
  });

  it('dispatches touch drag events without starting touch orbit controls', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const dragEvents: unknown[] = [];
    const canvas = new FakeCanvas();
    const windowTarget = new FakeCanvas();
    const renderer = fakeRenderer();
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragstart', (event) => dragEvents.push(event));
    addEventListener(mesh, 'dragmove', (event) => dragEvents.push(event));
    addEventListener(mesh, 'dragend', (event) => dragEvents.push(event));
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(100);
      return 42;
    }) as typeof requestAnimationFrame;

    try {
      canvas.dispatch<PointerEvent>('pointerdown', {
        pointerId: 11,
        pointerType: 'touch',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        offsetX: 50,
        offsetY: 50
      } as Partial<PointerEvent>);
      canvas.dispatch<TouchEvent>('touchstart', {
        touches: [{ clientX: 50, clientY: 50 }]
      } as unknown as Partial<TouchEvent>);
      canvas.dispatch<PointerEvent>('pointermove', {
        pointerId: 11,
        pointerType: 'touch',
        buttons: 1,
        clientX: 60,
        clientY: 70,
        offsetX: 60,
        offsetY: 70
      } as Partial<PointerEvent>);
      windowTarget.dispatch<TouchEvent>('touchmove', {
        touches: [{ clientX: 90, clientY: 50 }]
      } as unknown as Partial<TouchEvent>);
      canvas.dispatch<PointerEvent>('pointerup', {
        pointerId: 11,
        pointerType: 'touch',
        button: 0,
        buttons: 0,
        clientX: 60,
        clientY: 70,
        offsetX: 60,
        offsetY: 70
      } as Partial<PointerEvent>);

      expect(dragEvents.map((event) => (event as { type: string }).type)).toEqual([
        'dragstart',
        'dragmove',
        'dragend'
      ]);
      expect(dragEvents[1]).toMatchObject({
        target: mesh,
        detail: expect.objectContaining({
          pointerId: 11,
          pointerType: 'touch',
          deltaX: 10,
          deltaY: 20,
          totalDeltaX: 10,
          totalDeltaY: 20
        })
      });
      expect(renderer.setCamera).not.toHaveBeenCalled();
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it('cancels active drag on lost pointer capture and releases camera suppression', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const dragEvents: unknown[] = [];
    const canvas = new FakeCanvas();
    const windowTarget = new FakeCanvas();
    const renderer = fakeRenderer();
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragstart', (event) => dragEvents.push(event));
    addEventListener(mesh, 'dragend', (event) => dragEvents.push(event));
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(100);
      return 42;
    }) as typeof requestAnimationFrame;

    try {
      canvas.dispatch<PointerEvent>('pointerdown', {
        pointerId: 12,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        offsetX: 50,
        offsetY: 50
      } as Partial<PointerEvent>);
      canvas.dispatch<PointerEvent>('lostpointercapture', {
        pointerId: 12,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        clientX: 50,
        clientY: 50,
        offsetX: 50,
        offsetY: 50
      } as Partial<PointerEvent>);
      canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 5, clientY: 5 } as Partial<
        MouseEvent
      >);
      windowTarget.dispatch<MouseEvent>('mousemove', {
        buttons: 1,
        clientX: 55,
        clientY: 5
      } as Partial<MouseEvent>);

      expect(dragEvents.map((event) => (event as { type: string }).type)).toEqual([
        'dragstart',
        'dragend'
      ]);
      expect(dragEvents[1]).toMatchObject({
        detail: expect.objectContaining({
          cancelled: true
        })
      });
      expect(renderer.setCamera).toHaveBeenCalledOnce();
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it('finishes active drag from window pointerup when pointer capture is unavailable', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const dragEvents: unknown[] = [];
    const pointerUpEvents: unknown[] = [];
    const canvas = new FakeCanvas();
    const windowTarget = new FakeCanvas();
    const renderer = fakeRenderer();
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    canvas.setPointerCapture.mockImplementation(() => {
      throw new Error('capture failed');
    });
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragstart', (event) => dragEvents.push(event));
    addEventListener(mesh, 'dragend', (event) => dragEvents.push(event));
    addEventListener(mesh, 'pointerup', (event) => pointerUpEvents.push(event));
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(100);
      return 42;
    }) as typeof requestAnimationFrame;

    try {
      canvas.dispatch<PointerEvent>('pointerdown', {
        pointerId: 13,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        offsetX: 50,
        offsetY: 50
      } as Partial<PointerEvent>);
      windowTarget.dispatch<PointerEvent>('pointerup', {
        pointerId: 13,
        pointerType: 'mouse',
        button: 0,
        buttons: 0,
        clientX: 130,
        clientY: 40
      } as Partial<PointerEvent>);
      canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 5, clientY: 5 } as Partial<
        MouseEvent
      >);
      windowTarget.dispatch<MouseEvent>('mousemove', {
        buttons: 1,
        clientX: 55,
        clientY: 5
      } as Partial<MouseEvent>);

      expect(dragEvents.map((event) => (event as { type: string }).type)).toEqual([
        'dragstart',
        'dragend'
      ]);
      expect(dragEvents[1]).toMatchObject({
        detail: expect.objectContaining({
          cancelled: false
        })
      });
      expect(pointerUpEvents).toHaveLength(1);
      expect(renderer.setCamera).toHaveBeenCalledOnce();
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it('keeps orbit controls active when pointerdown misses draggable objects', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const canvas = new FakeCanvas();
    const windowTarget = new FakeCanvas();
    const renderer = fakeRenderer();
    const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragmove', () => {});
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(100);
      return 42;
    }) as typeof requestAnimationFrame;

    try {
      canvas.dispatch<PointerEvent>('pointerdown', {
        pointerId: 8,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: 5,
        clientY: 5,
        offsetX: 5,
        offsetY: 5
      } as Partial<PointerEvent>);
      canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 5, clientY: 5 } as Partial<
        MouseEvent
      >);
      windowTarget.dispatch<MouseEvent>('mousemove', {
        buttons: 1,
        clientX: 55,
        clientY: 5
      } as Partial<MouseEvent>);

      expect(renderer.setCamera).toHaveBeenCalledOnce();
    } finally {
      globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    }
  });

  it('dispatches leave and enter before pointermove when the picked target changes', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const left = createElement('mesh');
    const right = createElement('mesh');
    const leftGeometry = createElement('boxGeometry');
    const rightGeometry = createElement('boxGeometry');
    const events: string[] = [];
    const canvas = new FakeCanvas();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer()
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(left, 'position', [-2, 0, 0]);
    setAttribute(right, 'position', [2, 0, 0]);
    addEventListener(left, 'pointerenter', () => events.push('left:enter'));
    addEventListener(left, 'pointerleave', () => events.push('left:leave'));
    addEventListener(left, 'pointermove', () => events.push('left:move'));
    addEventListener(right, 'pointerenter', () => events.push('right:enter'));
    addEventListener(right, 'pointermove', () => events.push('right:move'));
    insert(left, leftGeometry, null);
    insert(right, rightGeometry, null);
    insert(scene, camera, null);
    insert(scene, left, null);
    insert(scene, right, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 30, offsetY: 50 } as Partial<
      PointerEvent
    >);
    events.length = 0;
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 70, offsetY: 50 } as Partial<
      PointerEvent
    >);

    expect(events).toEqual(['left:leave', 'right:enter', 'right:move']);
  });

  it('clears hover when the pointer leaves the canvas before re-entering the same mesh', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const onEnter = vi.fn();
    const onLeave = vi.fn();
    const canvas = new FakeCanvas();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer()
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    addEventListener(mesh, 'pointerenter', onEnter);
    addEventListener(mesh, 'pointerleave', onLeave);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 50, offsetY: 50 } as Partial<
      PointerEvent
    >);
    canvas.dispatch<PointerEvent>('pointerleave');
    canvas.dispatch<PointerEvent>('pointermove', { offsetX: 50, offsetY: 50 } as Partial<
      PointerEvent
    >);

    expect(onLeave).toHaveBeenCalledOnce();
    expect(onEnter).toHaveBeenCalledTimes(2);
  });

  it('schedules a second sync after an async model cache entry settles', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const model = createElement('model');
    const canvas = new FakeCanvas();
    const renderer = fakeRenderer();
    let resolveLoad: (model: TypeGpuLoadedModel) => void = () => {};
    const loadUrl = vi.fn(
      () => new Promise<TypeGpuLoadedModel>((resolve) => (resolveLoad = resolve))
    );
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      { loadUrl, loadData: vi.fn() }
    );

    setAttribute(model, 'src', '/models/empty.glb');
    insert(scene, model, null);
    insert(root, scene, null);

    runtime.scheduleSync(root);
    await Promise.resolve();

    expect(renderer.setScene).toHaveBeenCalledTimes(1);
    expect(loadUrl).toHaveBeenCalledWith('/models/empty.glb');

    resolveLoad(loadedModel('url:/models/empty.glb'));
    await Promise.resolve();
    await Promise.resolve();

    expect(renderer.setScene).toHaveBeenCalledTimes(2);
  });

  it('coalesces scheduled dirty masks into the next scene state', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const light = createElement('pointLight');
    const canvas = new FakeCanvas();
    const renderer = fakeRenderer();
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer
    );

    insert(scene, mesh, null);
    insert(scene, light, null);
    insert(root, scene, null);

    runtime.scheduleSync(root);
    await Promise.resolve();
    vi.mocked(renderer.setScene).mockClear();

    runtime.scheduleSync(root, mesh, Dirty.Transform);
    runtime.scheduleSync(root, light, Dirty.Lights);
    await Promise.resolve();

    expect(renderer.setScene).toHaveBeenCalledTimes(1);
    const lastCall = vi.mocked(renderer.setScene).mock.lastCall;
    expect(lastCall).toBeDefined();
    const [sceneState] = lastCall!;
    const dirty = sceneState.dirty ?? Dirty.None;
    expect(dirty).toBe(Dirty.Transform | Dirty.Lights);
    expect(hasDirty(dirty, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirty, Dirty.Lights)).toBe(true);
  });
});
