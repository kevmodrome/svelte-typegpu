// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileTypeGpuSource } from './component-test-utils';
import { createFragment, type TypeGpuNodeEvent } from './core';
import type { TypeGpuRenderer } from './gpu-renderer';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 100;
  const gpu = {
    setOptions: vi.fn(),
    setScene: vi.fn(),
    setCamera: vi.fn(),
    invalidate: vi.fn(),
    renderFrame: vi.fn(),
    getRenderSize: vi.fn(() => ({ width: 100, height: 100 })),
    dispose: vi.fn()
  } satisfies TypeGpuRenderer;
  const root = createFragment();
  const runtime = createTypeGpuRuntimeForTest(root, canvas, gpu);
  root.runtime = runtime;
  return { canvas, gpu, root, runtime };
}

function input(canvas: HTMLCanvasElement, type: string, init: WheelEventInit = {}) {
  const EventConstructor = type === 'wheel' ? WheelEvent : type.startsWith('pointer') ? PointerEvent : MouseEvent;
  const event = new EventConstructor(type, {
    clientX: 50,
    clientY: 50,
    bubbles: true,
    cancelable: true,
    ...init
  });
  // happy-dom neither computes offsets nor inherits WheelEvent mouse coordinates.
  Object.defineProperties(event, {
    clientX: { value: init.clientX ?? 50 },
    clientY: { value: init.clientY ?? 50 },
    offsetX: { value: init.clientX ?? 50 },
    offsetY: { value: init.clientY ?? 50 },
    ctrlKey: { value: init.ctrlKey ?? false }
  });
  canvas.dispatchEvent(event);
  return event;
}

describe('native canvas event attributes', () => {
  it.each(['pointerover', 'pointerout'])(
    'forwards compiled %s props with capture, related targets and native cancellation', async type => {
      const Boxes = compileTypeGpuSource(`
        <script>let { children, ...events } = $props();</script>
        <group {...events}>{@render children()}</group>
      `);
      const Scene = compileTypeGpuSource<{ replace(): void; hide(): void }>(`
        <script>
          let { Boxes, first, second, capture, target } = $props();
          let callback = $state(first);
          let visible = $state(true);
          export function replace() { callback = second; }
          export function hide() { visible = false; }
        </script>
        <scene>
          <perspectiveCamera position={[0, 0, 5]} target={[0, 0, 0]} />
          {#if visible}
            <Boxes on${type}capture={capture} on${type}={callback}>
              <mesh on${type}={target}><boxGeometry /></mesh>
            </Boxes>
          {/if}
        </scene>
      `);
      const { canvas, gpu, root, runtime } = setup();
      const calls: string[] = [];
      const first = vi.fn(() => calls.push('first'));
      const second = vi.fn(() => calls.push('second'));
      const capture = vi.fn((event: TypeGpuNodeEvent) => {
        expect(event.eventPhase).toBe(1);
        calls.push('capture');
      });
      const target = vi.fn((event: TypeGpuNodeEvent) => {
        expect(event.eventPhase).toBe(2);
        calls.push('target');
        event.preventDefault();
      });
      const instance = mount(Scene, { renderer, target: root, props: { Boxes, first, second, capture, target } });
      const transition = () => {
        input(canvas, type === 'pointerover' ? 'pointerout' : 'pointerover');
        return input(canvas, type);
      };
      try {
        flushSync();
        await Promise.resolve();
        const mesh = gpu.setScene.mock.lastCall![0].interaction.targets[0].node;
        gpu.setScene.mockClear();
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);
        const original = transition();
        expect(calls).toEqual(['capture', 'target', 'first']);
        expect(target.mock.calls[0][0]).toMatchObject({ target: mesh, relatedTarget: null, originalEvent: original });
        expect(target.mock.calls[0][0].currentTarget).toBeNull();
        expect(original.defaultPrevented).toBe(true);
        input(canvas, type);
        expect(first).toHaveBeenCalledOnce();
        flushSync(() => instance.replace());
        await Promise.resolve();
        calls.length = 0;
        transition();
        expect(calls).toEqual(['capture', 'target', 'second']);
        expect(gpu.setScene).not.toHaveBeenCalled();
        expect(raf).not.toHaveBeenCalled();
        // Leave before removal to distinguish cleanup from a pending exit transition.
        input(canvas, 'pointerout');
        flushSync(() => instance.hide());
        await Promise.resolve();
        calls.length = 0;
        transition();
        expect(calls).toEqual([]);
      } finally {
        await unmount(instance);
        runtime.dispose();
      }
      calls.length = 0;
      transition();
      expect(calls).toEqual([]);
    }
  );

  it.each(['dblclick', 'contextmenu', 'wheel'])(
    'routes %s through compiled capture, target and parent props without scheduling frames',
    async (type) => {
      const Scene = compileTypeGpuSource(`
        <script>let { capture, target, bubble } = $props();</script>
        <scene>
          <perspectiveCamera position={[0, 0, 5]} target={[0, 0, 0]} />
          <group on${type}capture={capture} on${type}={bubble}>
            <mesh on${type}={target}><boxGeometry /></mesh>
          </group>
        </scene>
      `);
      const { canvas, gpu, root, runtime } = setup();
      const calls: unknown[] = [];
      const events: TypeGpuNodeEvent[] = [];
      const handler = (event: TypeGpuNodeEvent) => {
        calls.push([event.currentTarget!.name, event.eventPhase]);
        events.push(event);
        if (event.eventPhase === 2) event.preventDefault();
      };
      const instance = mount(Scene, {
        renderer,
        target: root,
        props: {
          capture: handler,
          target: handler,
          bubble: handler
        }
      });
      try {
        flushSync();
        await Promise.resolve();
        const initial = gpu.setScene.mock.lastCall![0];
        gpu.setScene.mockClear();
        const raf = vi.fn();
        vi.stubGlobal('requestAnimationFrame', raf);
        const original = input(canvas, type, { button: type === 'contextmenu' ? 2 : 0 });
        expect(calls).toEqual([
          ['group', 1],
          ['mesh', 2],
          ['group', 3]
        ]);
        expect(new Set(events).size).toBe(1);
        expect(events[0].target).toBe(initial.interaction.targets[0].node);
        expect(events[0].originalEvent).toBe(original);
        expect(events[0].detail).toMatchObject({ point: [0, 0, 0.5] });
        expect(events[0].currentTarget).toBeNull();
        expect(original.defaultPrevented).toBe(true);
        await Promise.resolve();
        expect(raf).not.toHaveBeenCalled();
        expect(gpu.setScene).not.toHaveBeenCalled();
        expect(gpu.invalidate).not.toHaveBeenCalled();
        input(canvas, type, { clientX: 0, clientY: 0 });
        expect(calls).toHaveLength(3);
      } finally {
        await unmount(instance);
        runtime.dispose();
      }
      input(canvas, type);
      expect(calls).toHaveLength(3);
    }
  );

  it.each(['dblclick', 'contextmenu', 'wheel'])(
    'updates parent-only %s handlers and respects local picking opt-outs',
    async (type) => {
      const Scene = compileTypeGpuSource<{ replace(): void; disable(): void; hide(): void }>(`
        <script>
          let { first, second, type } = $props();
          let callback = $state(first);
          let pointerEvents = $state('auto');
          let visible = $state(true);
          export function replace() { callback = second; }
          export function disable() { pointerEvents = 'none'; }
          export function hide() { visible = false; }
        </script>
        <scene>
          <perspectiveCamera position={[0, 0, 5]} target={[0, 0, 0]} />
          {#if visible}<group {...{ ['on' + type]: callback }}>
            <mesh {pointerEvents}><boxGeometry /></mesh>
          </group>{/if}
        </scene>
      `);
      const { canvas, root, runtime } = setup();
      const first = vi.fn();
      const second = vi.fn();
      const instance = mount(Scene, { renderer, target: root, props: { first, second, type } });
      try {
        flushSync();
        await Promise.resolve();
        expect(input(canvas, type).defaultPrevented).toBe(false);
        expect(first).toHaveBeenCalledOnce();
        flushSync(() => instance.replace());
        await Promise.resolve();
        input(canvas, type);
        expect(first).toHaveBeenCalledOnce();
        expect(second).toHaveBeenCalledOnce();
        flushSync(() => instance.disable());
        await Promise.resolve();
        input(canvas, type);
        expect(second).toHaveBeenCalledOnce();
        flushSync(() => instance.hide());
        await Promise.resolve();
        input(canvas, type);
        expect(second).toHaveBeenCalledOnce();
      } finally {
        await unmount(instance);
        runtime.dispose();
      }
    }
  );

  it('attaches wheel only for eligible handlers and retains the subscription during motion', async () => {
    const Scene = compileTypeGpuSource<{
      listen(callback: ((event: TypeGpuNodeEvent) => void) | null): void;
      show(visible: boolean): void;
      move(x: number): void;
    }>(`
      <script>
        let onwheel = $state(null);
        let visible = $state(true);
        let x = $state(0);
        export function listen(callback) { onwheel = callback; }
        export function show(value) { visible = value; }
        export function move(value) { x = value; }
      </script>
      <scene><group {...{ onwheel }}>
        <mesh {visible} position={[x, 0, 0]}><boxGeometry /></mesh>
      </group></scene>
    `);
    const { canvas, gpu, root, runtime } = setup();
    const add = vi.spyOn(canvas, 'addEventListener');
    const remove = vi.spyOn(canvas, 'removeEventListener');
    const instance = mount(Scene, { renderer, target: root });
    const first = vi.fn();
    const second = vi.fn();
    try {
      flushSync();
      await Promise.resolve();
      expect(add.mock.calls.filter(([type]) => type === 'wheel')).toEqual([]);
      flushSync(() => instance.listen(first));
      await Promise.resolve();
      expect(add).toHaveBeenCalledExactlyOnceWith('wheel', expect.any(Function), {
        capture: true,
        passive: false
      });
      const callback = add.mock.calls[0][1];
      const interaction = gpu.setScene.mock.lastCall![0].interaction;
      const scan = vi.spyOn(interaction.targets, 'some');
      for (let x = 1; x <= 10; x++) {
        flushSync(() => instance.move(x / 10));
        await Promise.resolve();
        expect(gpu.setScene.mock.lastCall![0].interaction).toBe(interaction);
      }
      expect(scan).not.toHaveBeenCalled();
      expect(add).toHaveBeenCalledOnce();
      expect(remove).not.toHaveBeenCalled();
      flushSync(() => instance.listen(second));
      await Promise.resolve();
      expect(add).toHaveBeenCalledOnce();
      flushSync(() => instance.show(false));
      await Promise.resolve();
      expect(remove).toHaveBeenCalledExactlyOnceWith('wheel', callback, true);
      flushSync(() => instance.show(true));
      await Promise.resolve();
      expect(add).toHaveBeenCalledTimes(2);
      flushSync(() => instance.listen(null));
      await Promise.resolve();
      expect(remove).toHaveBeenCalledTimes(2);
      flushSync(() => instance.listen(first));
      await Promise.resolve();
      expect(add).toHaveBeenCalledTimes(3);
    } finally {
      await unmount(instance);
      runtime.dispose();
    }
    expect(remove.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(3);
  });

  it.each([
    { method: 'preventDefault', cancelable: true, capture: false, zooms: false },
    { method: 'preventDefault', cancelable: true, capture: true, zooms: false },
    { method: 'preventDefault', cancelable: false, capture: false, zooms: true },
    { method: 'stopPropagation', cancelable: true, capture: false, zooms: true },
    { method: null, cancelable: true, capture: false, zooms: true }
  ] as const)(
    'handles late wheel $method (cancelable: $cancelable, capture: $capture) before camera zoom',
    async ({ method, cancelable, capture, zooms }) => {
      const pending = new Map<number, FrameRequestCallback>();
      let id = 0;
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          pending.set(++id, callback);
          return id;
        })
      );
      vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
      const Scene = compileTypeGpuSource<{
        listen(handler: (event: TypeGpuNodeEvent) => void): void;
      }>(`
        <script>
          let handler = $state(null);
          export function listen(callback) { handler = callback; }
        </script>
        <scene>
          <perspectiveCamera position={[0, 0, 5]} target={[0, 0, 0]}>
            <controls mode="orbit"><pointerControls wheel="zoom" /></controls>
          </perspectiveCamera>
          <group {...{ onwheel${capture ? 'capture' : ''}: handler }}>
            <mesh><boxGeometry /></mesh>
          </group>
        </scene>
      `);
      const { canvas, gpu, root, runtime } = setup();
      const instance = mount(Scene, { renderer, target: root });
      const handler = vi.fn((event: TypeGpuNodeEvent) => {
        if (method) event[method]();
      });
      try {
        flushSync();
        await Promise.resolve();
        // Camera listeners already exist before the first scene wheel handler.
        flushSync(() => instance.listen(handler));
        await Promise.resolve();
        const event = input(canvas, 'wheel', {
          deltaY: 40,
          deltaMode: 1,
          ctrlKey: true,
          cancelable
        });
        expect(handler).toHaveBeenCalledOnce();
        expect(handler.mock.calls[0][0].originalEvent).toBe(event);
        expect(event).toMatchObject({ deltaY: 40, deltaMode: 1, ctrlKey: true });
        expect(pending.size).toBe(zooms ? 1 : 0);
        for (const [id, callback] of [...pending]) {
          pending.delete(id);
          callback(1000 / 120);
        }
        expect(gpu.setCamera).toHaveBeenCalledTimes(zooms ? 1 : 0);
        expect(pending.size).toBe(0);
        input(canvas, 'wheel', { clientX: 0, clientY: 0, deltaY: 20 });
        expect(handler).toHaveBeenCalledOnce();
        expect(pending.size).toBe(1);
        for (const [id, callback] of [...pending]) {
          pending.delete(id);
          callback(2000 / 120);
        }
        expect(gpu.setCamera).toHaveBeenCalledTimes(zooms ? 2 : 1);
      } finally {
        await unmount(instance);
        runtime.dispose();
      }
      expect(pending.size).toBe(0);
    }
  );
});
