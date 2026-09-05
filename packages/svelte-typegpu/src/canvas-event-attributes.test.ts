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

function input(canvas: HTMLCanvasElement, type: string, init: MouseEventInit = {}) {
  const event = new MouseEvent(type, {
    clientX: 50,
    clientY: 50,
    bubbles: true,
    cancelable: true,
    ...init
  });
  // happy-dom does not derive canvas offsets from client coordinates.
  Object.defineProperties(event, {
    offsetX: { value: event.clientX },
    offsetY: { value: event.clientY }
  });
  canvas.dispatchEvent(event);
  return event;
}

describe('native canvas event attributes', () => {
  it.each(['dblclick', 'contextmenu'])(
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

  it.each(['dblclick', 'contextmenu'])(
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
});
