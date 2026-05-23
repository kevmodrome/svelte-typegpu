import { describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, addEventListener, insert } from './core';
import { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';

class FakeCanvas {
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
    dispose: vi.fn()
  };
}

describe('TypeGPU Svelte renderer runtime', () => {
  it('does not route a click after orbit dragging the canvas', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const orbit = createElement('orbitControls');
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
    insert(orbit, pointer, null);
    insert(camera, orbit, null);
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

  it('still routes ordinary canvas clicks to interactive meshes', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const orbit = createElement('orbitControls');
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
    insert(orbit, pointer, null);
    insert(camera, orbit, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root);
    await Promise.resolve();

    canvas.dispatch<MouseEvent>('mousedown', { button: 0, clientX: 10, clientY: 20 } as Partial<
      MouseEvent
    >);
    windowTarget.dispatch<MouseEvent>('mouseup', { button: 0 } as Partial<MouseEvent>);
    canvas.dispatch<MouseEvent>('click', {} as Partial<MouseEvent>);

    expect(onMeshClick).toHaveBeenCalledOnce();
  });
});
