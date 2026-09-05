import { describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, addEventListener, insert, remove, removeEventListener, setAttribute } from './core';
import { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuLoadedModel } from './glb-loader';
import { Dirty, hasDirty } from './dirty';
import { readInlineGeometry, readInlineMaterial } from './resources';

class FakeCanvas {
  clientWidth = 800;
  clientHeight = 600;
  setPointerCapture = vi.fn();
  releasePointerCapture = vi.fn();
  getBoundingClientRect = vi.fn(() => ({ left: 0, top: 0 }));
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
    const eventRecord = event as Record<string, unknown>;

    eventRecord.currentTarget = this;
    eventRecord.target ??= this;

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
    setOptions: vi.fn(),
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

function hoverFixture() {
  const root = createFragment();
  const scene = createElement('scene');
  const camera = createElement('perspectiveCamera');
  const group = createElement('group');
  const left = createElement('mesh');
  const right = createElement('mesh');
  insert(root, scene, null);
  insert(scene, camera, null);
  insert(scene, group, null);
  setAttribute(camera, 'position', [0, 0, 10]);
  setAttribute(camera, 'target', [0, 0, 0]);
  for (const [mesh, x] of [[left, -2], [right, 2]] as const) {
    setAttribute(mesh, 'position', [x, 0, 0]);
    insert(group, mesh, null);
    insert(mesh, createElement('boxGeometry'), null);
  }
  const canvas = new FakeCanvas();
  canvas.clientWidth = canvas.clientHeight = 100;
  const gpu = fakeRenderer();
  const runtime = createTypeGpuRuntimeForTest(root, canvas as unknown as HTMLCanvasElement, gpu);
  root.runtime = runtime;
  runtime.scheduleSync(root);
  const move = (x: number) => canvas.dispatch<PointerEvent>('pointermove', { offsetX: x, offsetY: 50 });
  return { root, scene, group, left, right, canvas, gpu, runtime, move };
}

describe('composable canvas events', () => {
  it.each(['pointerdown', 'dragstart', 'dragmove', 'pointerup', 'dragend'])(
    'releases drag ownership when a %s handler disposes the runtime', async type => {
      const { left, canvas, runtime } = hoverFixture();
      const ended = vi.fn();
      addEventListener(left, 'dragend', ended);
      addEventListener(left, type, () => runtime.dispose());
      await Promise.resolve();
      const pointer = { pointerId: 1, offsetX: 30, offsetY: 50, button: 0 };
      expect(() => canvas.dispatch<PointerEvent>('pointerdown', pointer)).not.toThrow();
      if (type === 'dragmove') {
        expect(() => canvas.dispatch<PointerEvent>('pointermove', { ...pointer, offsetX: 40 })).not.toThrow();
      }
      if (type === 'pointerup' || type === 'dragend') canvas.dispatch<PointerEvent>('pointerup', pointer);
      expect(canvas.setPointerCapture).toHaveBeenCalledTimes(type === 'pointerdown' ? 0 : 1);
      expect(canvas.releasePointerCapture).toHaveBeenCalledTimes(type === 'pointerdown' ? 0 : 1);
      expect(ended).toHaveBeenCalledTimes(type === 'dragend' ? 1 : 0);
      runtime.dispose();
    }
  );

  it('allows a dragend callback to start a replacement without releasing its capture', async () => {
    const { left, right, canvas, runtime } = hoverFixture();
    const started = vi.fn();
    const moved = vi.fn();
    addEventListener(left, 'dragend', () => canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 2, offsetX: 70, offsetY: 50, button: 0
    }));
    addEventListener(right, 'dragstart', started);
    addEventListener(right, 'dragmove', moved);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointerdown', { pointerId: 1, offsetX: 30, offsetY: 50, button: 0 });
    canvas.dispatch<PointerEvent>('pointerup', { pointerId: 1, offsetX: 30, offsetY: 50 });
    expect(started).toHaveBeenCalledOnce();
    expect(canvas.releasePointerCapture.mock.calls).toEqual([[1]]);
    canvas.dispatch<PointerEvent>('pointermove', { pointerId: 2, offsetX: 80, offsetY: 50 });
    expect(moved).toHaveBeenCalledOnce();
    runtime.dispose();
    expect(canvas.releasePointerCapture.mock.calls).toEqual([[1], [2]]);
  });

  it('releases capture after a failing dragstart without blocking the next gesture', async () => {
    const { left, right, canvas, runtime } = hoverFixture();
    const started = vi.fn();
    addEventListener(left, 'dragstart', () => { throw new Error('start failed'); });
    addEventListener(right, 'dragstart', started);
    await Promise.resolve();
    expect(() => canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 1, offsetX: 30, offsetY: 50, button: 0
    })).toThrow('start failed');
    expect(canvas.releasePointerCapture.mock.calls).toEqual([[1]]);
    canvas.dispatch<PointerEvent>('pointerdown', { pointerId: 2, offsetX: 70, offsetY: 50, button: 0 });
    expect(started).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('does not overwrite a replacement drag after a reentrant dragmove callback', async () => {
    const { left, right, canvas, runtime } = hoverFixture();
    const moved = vi.fn();
    addEventListener(left, 'dragmove', () => {
      canvas.dispatch<PointerEvent>('pointerup', { pointerId: 1, offsetX: 40, offsetY: 50 });
      canvas.dispatch<PointerEvent>('pointerdown', { pointerId: 2, offsetX: 70, offsetY: 50, button: 0 });
    });
    addEventListener(right, 'dragmove', moved);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointerdown', { pointerId: 1, offsetX: 30, offsetY: 50, button: 0 });
    canvas.dispatch<PointerEvent>('pointermove', { pointerId: 1, offsetX: 40, offsetY: 50 });
    canvas.dispatch<PointerEvent>('pointermove', { pointerId: 2, offsetX: 80, offsetY: 50 });
    expect(moved.mock.calls[0][0]).toMatchObject({ detail: { previousX: 70, deltaX: 10 } });
    runtime.dispose();
  });

  it('bubbles hover transitions between siblings while preserving group boundaries', async () => {
    const { scene, group, left, right, canvas, runtime, move } = hoverFixture();
    const calls: string[] = [];
    const related: unknown[] = [];
    for (const [node, name] of [[scene, 'scene'], [group, 'group'], [left, 'left'], [right, 'right']] as const) {
      for (const type of ['pointerover', 'pointerout', 'pointerenter', 'pointerleave']) {
        addEventListener(node, type, event => calls.push(`${name}:${event.type}`));
      }
    }
    addEventListener(group, 'pointerover', event => related.push([event.target, event.relatedTarget]));
    addEventListener(group, 'pointerout', event => related.push([event.target, event.relatedTarget]));
    await Promise.resolve();
    const entered = canvas.dispatch<PointerEvent>('pointerover', { offsetX: 30, offsetY: 50 });
    expect(calls).toEqual([
      'left:pointerover', 'group:pointerover', 'scene:pointerover',
      'scene:pointerenter', 'group:pointerenter', 'left:pointerenter'
    ]);
    calls.length = 0;
    move(30); move(30);
    expect(calls).toEqual([]);
    move(70);
    expect(calls).toEqual([
      'left:pointerout', 'group:pointerout', 'scene:pointerout', 'left:pointerleave',
      'right:pointerover', 'group:pointerover', 'scene:pointerover', 'right:pointerenter'
    ]);
    calls.length = 0;
    canvas.dispatch('pointerout');
    canvas.dispatch('pointerleave');
    expect(calls).toEqual([
      'right:pointerout', 'group:pointerout', 'scene:pointerout',
      'right:pointerleave', 'group:pointerleave', 'scene:pointerleave'
    ]);
    expect(related).toEqual([[left, null], [left, right], [right, left], [right, null]]);
    runtime.dispose();
    canvas.dispatch('pointerover', entered);
    expect(related).toHaveLength(4);
  });

  it.each(['reparent', 'remove'] as const)('routes pointerout through saved ancestors after %s', async action => {
    const { scene, group, left, runtime, move } = hoverFixture();
    const calls: string[] = [];
    addEventListener(group, 'pointerover', () => calls.push('over'));
    addEventListener(group, 'pointerout', () => calls.push('out'));
    addEventListener(left, 'pointerover', vi.fn());
    await Promise.resolve();
    move(30);
    if (action === 'reparent') insert(scene, left, null);
    else remove(left);
    await Promise.resolve();
    move(30);
    expect(calls).toEqual(['over', 'out']);
    runtime.dispose();
  });

  it.each(['pointerover', 'pointerout'])('keeps %s propagation controls local to that boundary event', async type => {
    const { group, left, right, runtime, move } = hoverFixture();
    const bubble = vi.fn();
    const boundary = vi.fn();
    addEventListener(group, type, event => event.stopPropagation(), true);
    addEventListener(group, type, bubble);
    addEventListener(left, 'pointerleave', boundary);
    addEventListener(right, 'pointerenter', boundary);
    await Promise.resolve();
    move(30); move(70);
    expect(bubble).not.toHaveBeenCalled();
    expect(boundary).toHaveBeenCalledTimes(2);
    runtime.dispose();
  });

  it.each(['pointerover', 'pointerout'])('stops stale hover work when %s disposes the runtime', async type => {
    const { left, right, runtime, move } = hoverFixture();
    const enter = vi.fn();
    const moved = vi.fn();
    addEventListener(type === 'pointerover' ? right : left, type, () => runtime.dispose());
    addEventListener(right, 'pointerenter', enter);
    addEventListener(right, 'pointermove', moved);
    // The starting mesh must be pickable even when only the destination disposes.
    addEventListener(left, 'pointerenter', vi.fn());
    await Promise.resolve();
    move(30); move(70);
    expect(enter).not.toHaveBeenCalled();
    expect(moved).not.toHaveBeenCalled();
  });

  it.each(['pointerover', 'pointerout'])('preserves a nested hover transition from %s', async type => {
    const { left, right, runtime, move } = hoverFixture();
    const entered = vi.fn();
    const moved = vi.fn();
    addEventListener(left, type, () => move(70));
    addEventListener(right, 'pointerover', entered);
    addEventListener(left, 'pointermove', moved);
    await Promise.resolve();
    move(30);
    moved.mockClear();
    if (type === 'pointerout') move(0);
    move(70);
    expect(entered).toHaveBeenCalledOnce();
    expect(moved).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it('does not discover hover changes or schedule frames while the pointer is stationary', async () => {
    const { group, left, canvas, gpu, runtime, move } = hoverFixture();
    const over = vi.fn();
    const out = vi.fn();
    addEventListener(group, 'pointerover', over);
    addEventListener(group, 'pointerout', out);
    await Promise.resolve();
    const scene = vi.mocked(gpu.setScene).mock.lastCall![0];
    const pick = vi.spyOn(scene.interaction, 'pick');
    const add = vi.spyOn(canvas, 'addEventListener');
    const remove = vi.spyOn(canvas, 'removeEventListener');
    vi.mocked(gpu.setScene).mockClear();
    move(30);
    for (let i = 0; i < 100; i++) move(30);
    expect(over).toHaveBeenCalledOnce();
    expect(out).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(gpu.setScene).not.toHaveBeenCalled();
    expect(gpu.invalidate).not.toHaveBeenCalled();
    pick.mockClear();
    setAttribute(left, 'position', [0, 0, 0]);
    await Promise.resolve();
    expect(pick).not.toHaveBeenCalled();
    expect(out).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    move(30);
    expect(out).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it('distinguishes primitive instances of the same model in bubbling hover events', async () => {
    const { group, left, right, gpu, runtime, move } = hoverFixture();
    remove(left);
    remove(right);
    const model = createElement('model');
    const asset: TypeGpuLoadedModel = {
      key: 'hover-pair',
      meshes: [-2, 2].map(x => ({
        geometry: readInlineGeometry(createElement('boxGeometry'))!,
        material: readInlineMaterial(createElement('standardMaterial'))!,
        transform: { position: [x, 0, 0], scale: [1, 1, 1], rotation: [0, 0, 0] }
      }))
    };
    setAttribute(model, 'asset', asset);
    insert(group, model, null);
    const calls: unknown[] = [];
    for (const type of ['pointerover', 'pointerout']) {
      addEventListener(group, type, event => {
        expect(event.target).toBe(model);
        calls.push([event.type, event.detail, event.relatedTarget]);
      });
    }
    await Promise.resolve();
    const targets = vi.mocked(gpu.setScene).mock.lastCall![0].interaction.targets;
    expect(targets).toHaveLength(2);
    move(30); move(70); move(70);
    expect(calls).toEqual([
      ['pointerover', { instanceId: targets[0].instanceId, point: expect.any(Array) }, null],
      ['pointerout', { instanceId: targets[0].instanceId }, model],
      ['pointerover', { instanceId: targets[1].instanceId, point: expect.any(Array) }, model]
    ]);
    expect(targets[0].instanceId).not.toBe(targets[1].instanceId);
    runtime.dispose();
  });

  it.each(['click', 'dblclick', 'contextmenu', 'wheel', 'pointerdown', 'pointerup', 'pointermove'])(
    'runs parent %s capture before the picked mesh and honors interception', async type => {
      const { group, left, canvas, runtime } = hoverFixture();
      const calls: string[] = [];
      let intercept = false;
      addEventListener(group, type, event => {
        expect(event.target).toBe(left);
        expect(event.currentTarget).toBe(group);
        expect(event.eventPhase).toBe(1);
        calls.push('capture');
        if (intercept) event.stopPropagation();
      }, true);
      addEventListener(left, type, event => {
        expect(event.eventPhase).toBe(2);
        calls.push('target');
      });
      await Promise.resolve();
      canvas.dispatch<PointerEvent>(type, { offsetX: 30, offsetY: 50 });
      expect(calls).toEqual(['capture', 'target']);
      calls.length = 0;
      intercept = true;
      canvas.dispatch<PointerEvent>(type, { offsetX: 30, offsetY: 50 });
      expect(calls).toEqual(['capture']);
      runtime.dispose();
    }
  );

  it('keeps common ancestors hovered across siblings, then exits leaf first', async () => {
    const { scene, group, left, right, canvas, runtime, move } = hoverFixture();
    const events: string[] = [];
    for (const [node, name] of [[scene, 'scene'], [group, 'group'], [left, 'left'], [right, 'right']] as const) {
      for (const type of ['pointerenter', 'pointerleave']) {
        addEventListener(node, type, event => {
          expect(event.target).toBe(node);
          expect(event.currentTarget).toBe(node);
          expect(event.bubbles).toBe(false);
          events.push(`${name}:${type}`);
        });
      }
    }
    const leave = vi.fn();
    addEventListener(left, 'pointerleave', leave);
    await Promise.resolve();
    move(30); move(30); move(70);
    expect(events).toEqual([
      'scene:pointerenter', 'group:pointerenter', 'left:pointerenter',
      'left:pointerleave', 'right:pointerenter'
    ]);
    expect(leave.mock.calls[0][0].relatedTarget).toBe(right);
    canvas.dispatch('pointerleave');
    expect(events.slice(-3)).toEqual(['right:pointerleave', 'group:pointerleave', 'scene:pointerleave']);
    runtime.dispose();
  });

  it('picks descendants with only parent hover/click handlers and observes listener removal', async () => {
    const { group, left, canvas, runtime, move } = hoverFixture();
    const enter = vi.fn();
    const click = vi.fn(event => {
      expect(event.target).toBe(left);
      expect(event.currentTarget).toBe(group);
    });
    addEventListener(group, 'pointerenter', enter);
    addEventListener(group, 'click', click);
    await Promise.resolve();
    move(30); move(70);
    canvas.dispatch<MouseEvent>('click', { offsetX: 30, offsetY: 50 });
    expect(enter).toHaveBeenCalledOnce();
    expect(click).toHaveBeenCalledOnce();
    removeEventListener(group, 'click', click);
    await Promise.resolve();
    canvas.dispatch<MouseEvent>('click', { offsetX: 30, offsetY: 50 });
    expect(click).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it.each(['reparent', 'remove'] as const)('leaves saved ancestors after a hovered mesh is %s', async action => {
    const { root, scene, group, left, runtime, move } = hoverFixture();
    const events: string[] = [];
    for (const [node, name] of [[group, 'group'], [left, 'left']] as const) {
      addEventListener(node, 'pointerenter', () => events.push(`${name}:enter`));
      addEventListener(node, 'pointerleave', () => events.push(`${name}:leave`));
    }
    await Promise.resolve();
    move(30);
    events.length = 0;
    if (action === 'reparent') insert(scene, left, null);
    else remove(left);
    runtime.scheduleSync(root);
    await Promise.resolve();
    move(30);
    expect(events).toEqual(action === 'reparent' ? ['left:leave', 'group:leave', 'left:enter'] : ['left:leave', 'group:leave']);
    runtime.dispose();
  });

  it('stops an obsolete hover transition when a callback disposes the runtime', async () => {
    const { group, left, runtime, move } = hoverFixture();
    const enter = vi.fn();
    const pointermove = vi.fn();
    addEventListener(group, 'pointerenter', () => runtime.dispose());
    addEventListener(left, 'pointerenter', enter);
    addEventListener(left, 'pointermove', pointermove);
    await Promise.resolve();
    move(30);
    expect(enter).not.toHaveBeenCalled();
    expect(pointermove).not.toHaveBeenCalled();
  });

  it('does not overwrite a nested hover transition or dispatch its stale pointermove', async () => {
    const { group, left, right, runtime, move } = hoverFixture();
    const leftMove = vi.fn();
    const rightEnter = vi.fn();
    addEventListener(group, 'pointerenter', () => move(70));
    addEventListener(left, 'pointermove', leftMove);
    addEventListener(right, 'pointerenter', rightEnter);
    await Promise.resolve();
    move(30); move(70);
    expect(leftMove).not.toHaveBeenCalled();
    expect(rightEnter).toHaveBeenCalledOnce();
    runtime.dispose();
  });
});

describe('TypeGPU Svelte renderer runtime', () => {
  it('coalesces changed nodes into one targeted upload and discards pending motion on dispose', async () => {
    const root = createElement('scene');
    const group = createElement('group');
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null);
    insert(group, mesh, null);
    insert(root, group, null);
    const gpu = fakeRenderer();
    const runtime = createTypeGpuRuntimeForTest(root, new FakeCanvas() as unknown as HTMLCanvasElement, gpu);
    root.runtime = runtime;
    runtime.scheduleSync(root);
    await Promise.resolve();
    vi.mocked(gpu.setScene).mockClear();
    setAttribute(mesh, 'position', [1, 0, 0]);
    setAttribute(group, 'position', [2, 0, 0]);
    setAttribute(mesh, 'position', [3, 0, 0]);
    await Promise.resolve();
    expect(gpu.setScene).toHaveBeenCalledOnce();
    const state = vi.mocked(gpu.setScene).mock.lastCall![0];
    expect(state.drawBatchesChanged).toBe(false);
    expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);
    expect(state.drawBatches[0].instances[0]).toBe(5);
    setAttribute(mesh, 'position', [8, 0, 0]);
    runtime.dispose();
    await Promise.resolve();
    expect(gpu.setScene).toHaveBeenCalledOnce();
  });
  it('preserves root render defaults across scheduled synchronization', async () => {
    const root = createElement('scene');
    const gpu = fakeRenderer();
    const defaults = { depth: false, alphaMode: 'opaque' as const, clearColor: [1, 0, 0, 1] as [number, number, number, number] };
    const runtime = createTypeGpuRuntimeForTest(root, new FakeCanvas() as unknown as HTMLCanvasElement, gpu, { renderDefaults: defaults });
    runtime.scheduleSync(root);
    await Promise.resolve();
    expect(vi.mocked(gpu.setScene).mock.lastCall?.[0].renderSettings).toEqual(defaults);
    runtime.dispose();
  });
  it('discards queued syncs and ignores new work after idempotent disposal', async () => {
    const root = createFragment();
    const renderer = fakeRenderer();
    const runtime = createTypeGpuRuntimeForTest(root, new FakeCanvas() as unknown as HTMLCanvasElement, renderer);

    runtime.scheduleSync(root);
    runtime.dispose();
    runtime.dispose();
    await Promise.resolve();
    runtime.scheduleSync(root);
    await Promise.resolve();

    expect(renderer.setScene).not.toHaveBeenCalled();
    expect(renderer.dispose).toHaveBeenCalledOnce();
  });

  it('ignores model settlement after disposal', async () => {
    const root = createFragment();
    const model = createElement('model');
    setAttribute(model, 'src', '/late.glb');
    insert(root, model, null);
    let resolveLoad!: (model: TypeGpuLoadedModel) => void;
    const renderer = fakeRenderer();
    const runtime = createTypeGpuRuntimeForTest(root, new FakeCanvas() as unknown as HTMLCanvasElement, renderer, {
      loadUrl: () => new Promise((resolve) => { resolveLoad = resolve; })
    });

    runtime.scheduleSync(root);
    await Promise.resolve();
    runtime.dispose();
    resolveLoad(loadedModel('late'));
    await Promise.resolve();
    await Promise.resolve();

    expect(renderer.setScene).toHaveBeenCalledOnce();
  });

  it.each([
    ['depth', false],
    ['alphaMode', 'opaque']
  ])('synchronizes a reactive scene %s change', async (attribute, value) => {
    const root = createFragment();
    const scene = createElement('scene');
    insert(root, scene, null);
    const renderer = fakeRenderer();
    const runtime = createTypeGpuRuntimeForTest(root, new FakeCanvas() as unknown as HTMLCanvasElement, renderer);
    root.runtime = runtime;
    runtime.scheduleSync(root);
    await Promise.resolve();

    setAttribute(scene, attribute as string, value);
    await Promise.resolve();

    expect(renderer.setScene).toHaveBeenCalledTimes(2);
    expect(vi.mocked(renderer.setScene).mock.lastCall?.[0].renderSettings).toMatchObject({ [attribute as string]: value });
    runtime.dispose();
  });

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

  it('honors declarative object drag button filters before capturing a mesh drag', async () => {
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
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      fakeRenderer(),
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    setAttribute(mesh, 'dragButton', 'secondary');
    addEventListener(mesh, 'dragstart', (event) => dragEvents.push(event));
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();

    const primaryDown = canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 7,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 50,
      offsetX: 50,
      offsetY: 50
    } as Partial<PointerEvent>);
    const secondaryDown = canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 8,
      pointerType: 'mouse',
      button: 2,
      buttons: 2,
      clientX: 50,
      clientY: 50,
      offsetX: 50,
      offsetY: 50
    } as Partial<PointerEvent>);

    expect(primaryDown.preventDefault).not.toHaveBeenCalled();
    expect(secondaryDown.preventDefault).toHaveBeenCalled();
    expect(dragEvents).toHaveLength(1);
    expect(canvas.setPointerCapture).toHaveBeenCalledTimes(1);
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(8);
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

  it('cleans active drag state when a dragend handler throws', async () => {
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
    const dragendError = new Error('dragend failed');

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragend', () => {
      throw dragendError;
    });
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
        pointerId: 14,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
        clientX: 50,
        clientY: 50,
        offsetX: 50,
        offsetY: 50
      } as Partial<PointerEvent>);

      expect(() =>
        canvas.dispatch<PointerEvent>('pointerup', {
          pointerId: 14,
          pointerType: 'mouse',
          button: 0,
          buttons: 0,
          clientX: 50,
          clientY: 50,
          offsetX: 50,
          offsetY: 50
        } as Partial<PointerEvent>)
      ).toThrow(dragendError);

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

  it('uses canvas-relative client coordinates for window fallback pointerup', async () => {
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
    const runtime = createTypeGpuRuntimeForTest(
      root,
      canvas as unknown as HTMLCanvasElement,
      renderer,
      windowTarget as unknown as Window
    );

    canvas.clientWidth = 100;
    canvas.clientHeight = 100;
    canvas.getBoundingClientRect.mockReturnValue({ left: 30, top: 10 });
    canvas.setPointerCapture.mockImplementation(() => {
      throw new Error('capture failed');
    });
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(mesh, 'drag', 'rotate');
    addEventListener(mesh, 'dragend', (event) => dragEvents.push(event));
    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(mesh, geometry, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    runtime.scheduleSync(root, scene, Dirty.All);
    await Promise.resolve();
    canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 15,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 80,
      clientY: 60,
      offsetX: 50,
      offsetY: 50
    } as Partial<PointerEvent>);
    windowTarget.dispatch<PointerEvent>('pointerup', {
      pointerId: 15,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 130,
      clientY: 40,
      offsetX: 2,
      offsetY: 3
    } as Partial<PointerEvent>);

    expect(dragEvents).toEqual([
      expect.objectContaining({
        detail: expect.objectContaining({
          x: 100,
          y: 30,
          deltaX: 50,
          deltaY: -20,
          totalDeltaX: 50,
          totalDeltaY: -20
        })
      })
    ]);
  });

  it('ignores unrelated pointer ids during an active object drag', async () => {
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
    canvas.dispatch<PointerEvent>('pointerdown', {
      pointerId: 16,
      pointerType: 'mouse',
      button: 0,
      buttons: 1,
      clientX: 50,
      clientY: 50,
      offsetX: 50,
      offsetY: 50
    } as Partial<PointerEvent>);
    canvas.dispatch<PointerEvent>('pointermove', {
      pointerId: 17,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 90,
      clientY: 90,
      offsetX: 90,
      offsetY: 90
    } as Partial<PointerEvent>);
    canvas.dispatch<PointerEvent>('pointerup', {
      pointerId: 17,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 90,
      clientY: 90,
      offsetX: 90,
      offsetY: 90
    } as Partial<PointerEvent>);
    canvas.dispatch<PointerEvent>('pointercancel', {
      pointerId: 17,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 90,
      clientY: 90,
      offsetX: 90,
      offsetY: 90
    } as Partial<PointerEvent>);
    canvas.dispatch<PointerEvent>('pointermove', {
      pointerId: 16,
      pointerType: 'mouse',
      buttons: 1,
      clientX: 60,
      clientY: 70,
      offsetX: 60,
      offsetY: 70
    } as Partial<PointerEvent>);
    canvas.dispatch<PointerEvent>('pointerup', {
      pointerId: 16,
      pointerType: 'mouse',
      button: 0,
      buttons: 0,
      clientX: 65,
      clientY: 75,
      offsetX: 65,
      offsetY: 75
    } as Partial<PointerEvent>);

    expect(dragEvents.map((event) => (event as { type: string }).type)).toEqual([
      'dragstart',
      'dragmove',
      'dragend'
    ]);
    expect(dragEvents[1]).toMatchObject({
      detail: expect.objectContaining({
        pointerId: 16,
        deltaX: 10,
        deltaY: 20,
        totalDeltaX: 10,
        totalDeltaY: 20
      })
    });
    expect(dragEvents[2]).toMatchObject({
      detail: expect.objectContaining({
        pointerId: 16,
        deltaX: 5,
        deltaY: 5,
        totalDeltaX: 15,
        totalDeltaY: 25
      })
    });
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
