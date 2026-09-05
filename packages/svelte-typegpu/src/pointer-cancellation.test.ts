// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileTypeGpuSource } from './component-test-utils';
import { createFragment, type TypeGpuNodeEvent } from './core';
import type { TypeGpuRenderer } from './gpu-renderer';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function setup(props: Record<string, unknown> = {}) {
  const Scene = compileTypeGpuSource<{
    replace(events: Record<string, unknown>): void;
    configure(options: { visible?: boolean; hidden?: boolean; pointerEvents?: string; x?: number }): void;
  }>(`
    <script>
      let { leftEvents = {}, rightEvents = {}, parentEvents = {} } = $props();
      let visible = $state(true);
      let hidden = $state(false);
      let pointerEvents = $state('auto');
      let x = $state(-2);
      export function replace(events) { leftEvents = events; }
      export function configure(options) {
        if (options.visible !== undefined) visible = options.visible;
        if (options.hidden !== undefined) hidden = options.hidden;
        if (options.pointerEvents !== undefined) pointerEvents = options.pointerEvents;
        if (options.x !== undefined) x = options.x;
      }
    </script>
    <scene>
      <perspectiveCamera position={[0, 0, 10]} target={[0, 0, 0]} />
      <group {...parentEvents}>
        {#if visible}<mesh visible={!hidden} position={[x, 0, 0]} {pointerEvents} {...leftEvents}><boxGeometry /></mesh>{/if}
        <mesh position={[2, 0, 0]} {...rightEvents}><boxGeometry /></mesh>
      </group>
    </scene>
  `);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 100;
  document.body.append(canvas);
  canvas.setPointerCapture = vi.fn();
  canvas.releasePointerCapture = vi.fn();
  const gpu = {
    setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(),
    renderFrame: vi.fn(), getRenderSize: vi.fn(() => ({ width: 100, height: 100 })), dispose: vi.fn()
  } satisfies TypeGpuRenderer;
  const root = createFragment();
  const runtime = createTypeGpuRuntimeForTest(root, canvas, gpu, window);
  root.runtime = runtime;
  const instance = mount(Scene, { renderer, target: root, props });
  flushSync();
  await Promise.resolve();
  return {
    canvas, gpu, runtime, instance,
    async dispose() { await unmount(instance); runtime.dispose(); canvas.remove(); }
  };
}

function input(target: EventTarget, type: string, pointerId = 1, x = 30) {
  const event = new PointerEvent(type, {
    pointerId, pointerType: 'touch', clientX: x, clientY: 50, button: 0,
    bubbles: true, cancelable: type !== 'pointercancel'
  });
  Object.defineProperties(event, { offsetX: { value: x }, offsetY: { value: 50 } });
  target.dispatchEvent(event);
  return event;
}

describe('pointer cancellation ownership', () => {
  it('cancels the original pressed mesh through compiled capture and bubble handlers without re-picking', async () => {
    const calls: string[] = [];
    const down = vi.fn();
    const cancel = vi.fn((event: TypeGpuNodeEvent) => {
      event.preventDefault();
      expect(event.cancelable).toBe(false);
      expect(event.defaultPrevented).toBe(false);
      calls.push('target');
    });
    const fixture = await setup({
      leftEvents: { onpointerdown: down, onpointercancel: cancel },
      parentEvents: {
        onpointercancelcapture: () => calls.push('capture'),
        onpointercancel: () => calls.push('bubble')
      }
    });
    try {
      input(fixture.canvas, 'pointerdown');
      const originalTarget = down.mock.calls[0][0].target;
      const interaction = fixture.gpu.setScene.mock.lastCall![0].interaction;
      const pick = vi.spyOn(interaction, 'pick');
      const original = input(fixture.canvas, 'pointercancel', 1, 70);
      expect(calls).toEqual(['capture', 'target', 'bubble']);
      expect(cancel.mock.calls[0][0]).toMatchObject({
        target: originalTarget, originalEvent: original, currentTarget: null,
        detail: down.mock.calls[0][0].detail
      });
      expect(pick).not.toHaveBeenCalled();
      input(window, 'pointercancel');
      expect(cancel).toHaveBeenCalledOnce();
    } finally { await fixture.dispose(); }
  });

  it('tracks independent pointers and cancellation-only parent handlers', async () => {
    const cancel = vi.fn();
    const fixture = await setup({ parentEvents: { onpointercancel: cancel } });
    try {
      input(fixture.canvas, 'pointerdown', 1, 30);
      input(fixture.canvas, 'pointerdown', 2, 70);
      input(window, 'pointercancel', 3);
      expect(cancel).not.toHaveBeenCalled();
      input(window, 'pointercancel', 2, 0);
      input(fixture.canvas, 'pointercancel', 1, 70);
      expect(cancel).toHaveBeenCalledTimes(2);
      expect(cancel.mock.calls.map(([event]) => event.originalEvent.pointerId)).toEqual([2, 1]);
      expect(cancel.mock.calls[0][0].target).not.toBe(cancel.mock.calls[1][0].target);
      expect(fixture.canvas.setPointerCapture).not.toHaveBeenCalled();
    } finally { await fixture.dispose(); }
  });

  it.each(['canvas', 'window'])('forgets a sequence on %s pointerup', async target => {
    const cancel = vi.fn();
    const fixture = await setup({ leftEvents: { onpointercancel: cancel } });
    try {
      input(fixture.canvas, 'pointerdown');
      input(target === 'canvas' ? fixture.canvas : window, 'pointerup', 1, 0);
      input(fixture.canvas, 'pointercancel');
      expect(cancel).not.toHaveBeenCalled();
    } finally { await fixture.dispose(); }
  });

  it('uses a replacement callback and retains ownership through motion without membership scans', async () => {
    const first = vi.fn();
    const second = vi.fn();
    const fixture = await setup({ leftEvents: { onpointercancel: first } });
    try {
      input(fixture.canvas, 'pointerdown');
      flushSync(() => fixture.instance.replace({ onpointercancel: second }));
      await Promise.resolve();
      const interaction = fixture.gpu.setScene.mock.lastCall![0].interaction;
      const scan = vi.spyOn(interaction.targets, 'some');
      flushSync(() => fixture.instance.configure({ x: 8 }));
      await Promise.resolve();
      expect(fixture.gpu.setScene.mock.lastCall![0].interaction).toBe(interaction);
      expect(scan).not.toHaveBeenCalled();
      input(window, 'pointercancel', 1, 70);
      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledOnce();
    } finally { await fixture.dispose(); }
  });

  it.each(['remove', 'hide', 'opt-out', 'unsubscribe', 'lost-capture', 'dispose'])(
    'releases tracked ownership after %s without synthesizing cancellation', async operation => {
      const cancel = vi.fn();
      const fixture = await setup({ leftEvents: { onpointercancel: cancel } });
      try {
        input(fixture.canvas, 'pointerdown');
        const removeListener = vi.spyOn(window, 'removeEventListener');
        flushSync(() => {
          if (operation === 'remove') fixture.instance.configure({ visible: false });
          if (operation === 'hide') fixture.instance.configure({ hidden: true });
          if (operation === 'opt-out') fixture.instance.configure({ pointerEvents: 'none' });
          if (operation === 'unsubscribe') fixture.instance.replace({});
        });
        if (operation === 'lost-capture') input(fixture.canvas, 'lostpointercapture');
        if (operation === 'dispose') fixture.runtime.dispose();
        await Promise.resolve();
        expect(removeListener.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['pointerup', 'pointercancel']));
        input(window, 'pointercancel');
        input(fixture.canvas, 'pointercancel');
        expect(cancel).not.toHaveBeenCalled();
      } finally { await fixture.dispose(); }
    }
  );

  it.each(['pointerup', 'pointercancel'])(
    'does not let a bubbling %s terminate a reentrant replacement sequence', async type => {
      const cancel = vi.fn();
      let canvas!: HTMLCanvasElement;
      const fixture = await setup({
        leftEvents: {
          onpointercancel: vi.fn(),
          ['on' + type]: () => input(canvas, 'pointerdown', 1, 70)
        },
        rightEvents: { onpointercancel: cancel }
      });
      canvas = fixture.canvas;
      try {
        input(canvas, 'pointerdown');
        input(canvas, type);
        expect(cancel).not.toHaveBeenCalled();
        input(window, 'pointercancel');
        expect(cancel).toHaveBeenCalledOnce();
      } finally { await fixture.dispose(); }
    }
  );

  it('dispatches cancel before cancelled dragend, releases capture once and preserves another pointer', async () => {
    const calls: string[] = [];
    const cancelOther = vi.fn();
    const up = vi.fn();
    const fixture = await setup({
      leftEvents: {
        onpointercancel: () => calls.push('cancel'),
        onpointerup: up,
        ondragend: (event: TypeGpuNodeEvent) => {
          expect(event.detail).toMatchObject({ cancelled: true });
          calls.push('dragend');
        }
      },
      rightEvents: { onpointercancel: cancelOther }
    });
    try {
      input(fixture.canvas, 'pointerdown', 1, 30);
      input(fixture.canvas, 'pointerdown', 2, 70);
      input(fixture.canvas, 'pointercancel', 1, 0);
      expect(calls).toEqual(['cancel', 'dragend']);
      expect(up).not.toHaveBeenCalled();
      expect(fixture.canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
      input(window, 'pointercancel', 2, 0);
      expect(cancelOther).toHaveBeenCalledOnce();
    } finally { await fixture.dispose(); }
  });

  it('does not add window listeners or request work for an untracked press', async () => {
    const down = vi.fn();
    const fixture = await setup({ leftEvents: { onpointerdown: down } });
    try {
      const add = vi.spyOn(window, 'addEventListener');
      const raf = vi.fn();
      vi.stubGlobal('requestAnimationFrame', raf);
      fixture.gpu.setScene.mockClear();
      input(fixture.canvas, 'pointerdown');
      input(window, 'pointercancel');
      expect(down).toHaveBeenCalledOnce();
      expect(add).not.toHaveBeenCalled();
      await Promise.resolve();
      expect(raf).not.toHaveBeenCalled();
      expect(fixture.gpu.setScene).not.toHaveBeenCalled();
    } finally { await fixture.dispose(); }
  });

  it('does not start a drag after its pointerdown callback cancels the sequence', async () => {
    let canvas!: HTMLCanvasElement;
    const started = vi.fn();
    const cancel = vi.fn();
    const fixture = await setup({ leftEvents: {
      onpointerdown: () => input(canvas, 'pointercancel'), onpointercancel: cancel, ondragstart: started
    } });
    canvas = fixture.canvas;
    try {
      input(canvas, 'pointerdown');
      expect(cancel).toHaveBeenCalledOnce();
      expect(started).not.toHaveBeenCalled();
      expect(canvas.setPointerCapture).not.toHaveBeenCalled();
    } finally { await fixture.dispose(); }
  });

  it('does not redirect cancellation behind a down recipient without a cancel handler', async () => {
    const down = vi.fn();
    const cancel = vi.fn();
    const fixture = await setup({ leftEvents: { onpointerdown: down }, rightEvents: { onpointercancel: cancel } });
    try {
      flushSync(() => fixture.instance.configure({ x: 2 }));
      await Promise.resolve();
      input(fixture.canvas, 'pointerdown', 1, 70);
      expect(down).toHaveBeenCalledOnce();
      input(fixture.canvas, 'pointercancel', 1, 70);
      expect(cancel).not.toHaveBeenCalled();
    } finally { await fixture.dispose(); }
  });

  it.each(['remove', 'hide'])('releases an active drag on %s without late terminal callbacks', async operation => {
    const cancel = vi.fn();
    const ended = vi.fn();
    const fixture = await setup({ leftEvents: { onpointercancel: cancel, ondragend: ended } });
    try {
      input(fixture.canvas, 'pointerdown');
      flushSync(() => fixture.instance.configure(operation === 'remove' ? { visible: false } : { hidden: true }));
      await Promise.resolve();
      expect(fixture.canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
      input(window, 'pointercancel');
      expect(cancel).not.toHaveBeenCalled();
      expect(ended).not.toHaveBeenCalled();
    } finally { await fixture.dispose(); }
  });
});
