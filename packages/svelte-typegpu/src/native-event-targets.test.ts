// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { on } from 'svelte/events';
import { describe, expect, it, vi } from 'vitest';
import { createFragment } from './core';
import renderer from './svelte-renderer';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';

describe('native event targets inside GPU renderer scope', () => {
  it('forwards native receivers, handler objects and options without realm checks', () => {
    const target = { addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() };
    const handler = { handleEvent: vi.fn() };
    const options = { capture: true, once: true, passive: true, signal: new AbortController().signal };
    renderer.addEventListener(target, 'change', handler, options);
    expect(target.addEventListener).toHaveBeenCalledExactlyOnceWith('change', handler, options);
    expect(target.addEventListener.mock.contexts[0]).toBe(target);
    renderer.removeEventListener(target, 'change', handler, options);
    expect(target.removeEventListener).toHaveBeenCalledExactlyOnceWith('change', handler, options);
    expect(target.removeEventListener.mock.contexts[0]).toBe(target);
    const error = new Error('native subscription failed');
    target.addEventListener.mockImplementation(() => { throw error; });
    expect(() => renderer.addEventListener(target, 'change', handler)).toThrow(error);
  });

  it('leaves native once and abort semantics to the event target', () => {
    const target = new EventTarget();
    const controller = new AbortController();
    const once = { handleEvent: vi.fn() }, cancelled = vi.fn();
    renderer.addEventListener(target, 'change', once, { once: true });
    renderer.addEventListener(target, 'change', cancelled, { signal: controller.signal });
    controller.abort();
    target.dispatchEvent(new Event('change'));
    target.dispatchEvent(new Event('change'));
    expect(once.handleEvent).toHaveBeenCalledOnce();
    expect(cancelled).not.toHaveBeenCalled();
  });

  it('owns native svelte/events subscriptions through effect replacement and teardown', async () => {
    const first = new EventTarget(), second = new EventTarget();
    const firstAdd = vi.spyOn(first, 'addEventListener'), firstRemove = vi.spyOn(first, 'removeEventListener');
    const secondAdd = vi.spyOn(second, 'addEventListener'), secondRemove = vi.spyOn(second, 'removeEventListener');
    const received = vi.fn(function (this: EventTarget, event: Event) { event.preventDefault(); return this; });
    const Scene = compileViewportSource<{ replace(target: EventTarget): void }>(`<script>
      let { initial, on, received } = $props();
      let target = $state.raw(initial), count = $state(0);
      export function replace(next) { target = next; }
      $effect(() => on(target, 'change', function(event) {
        received.call(this, event);
        count += 1;
      }, { capture: true }));
    </script><mesh position={[count, 0, 0]}><boxGeometry /></mesh>`);
    const root = createFragment();
    const scheduled = vi.fn();
    root.runtime = { scheduleSync: scheduled };
    const instance = mount(Scene, { renderer, target: root, props: { initial: first, on, received } });
    try {
      await settleComponentUpdates();
      expect(firstAdd).toHaveBeenCalledOnce();
      const mesh = root.children.find(node => node.name === 'mesh')!;
      const event = new Event('change', { cancelable: true });
      first.dispatchEvent(event); await settleComponentUpdates();
      expect(received).toHaveBeenCalledExactlyOnceWith(event);
      expect(received.mock.contexts[0]).toBe(first);
      expect(event.defaultPrevented).toBe(true);
      expect(mesh.attributes.position).toEqual([1, 0, 0]);
      expect(mesh.listeners.size).toBe(0);
      scheduled.mockClear();
      flushSync(() => instance.replace(second)); await settleComponentUpdates();
      expect(firstRemove).toHaveBeenCalledOnce();
      expect(secondAdd).toHaveBeenCalledOnce();
      expect(scheduled).not.toHaveBeenCalled();
      first.dispatchEvent(new Event('change')); await settleComponentUpdates();
      expect(received).toHaveBeenCalledOnce();
      second.dispatchEvent(new Event('change')); await settleComponentUpdates();
      expect(mesh.attributes.position).toEqual([2, 0, 0]);
      expect(secondAdd).toHaveBeenCalledOnce();
    } finally { await unmount(instance); }
    expect(secondRemove).toHaveBeenCalledOnce();
    second.dispatchEvent(new Event('change')); await settleComponentUpdates();
    expect(received).toHaveBeenCalledTimes(2);
  });
});
