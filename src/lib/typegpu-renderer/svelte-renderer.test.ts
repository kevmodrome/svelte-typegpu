import { describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, addEventListener, insert, setAttribute } from './core';
import { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuLoadedModel } from './glb-loader';
import { Dirty, hasDirty } from './dirty';

class FakeCanvas {
  clientWidth = 800;
  clientHeight = 600;
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
