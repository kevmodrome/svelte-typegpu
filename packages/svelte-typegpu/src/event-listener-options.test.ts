import { describe, expect, it, vi } from 'vitest';
import { addEventListener, createElement, createFragment, dispatchNodeEvent, insert,
  removeEventListener, type TypeGpuNodeEvent } from './core';
import { onNodeEvent } from './attachments';
import renderer from './svelte-renderer';

describe('scene event listener options', () => {
  it('matches native once, duplicate and abort lifetime behavior', () => {
    function exercise(native: boolean) {
      const node = createElement('mesh'), target = new EventTarget(), controller = new AbortController();
      const calls: string[] = [];
      const add = (handler: () => void, options: AddEventListenerOptions) => native
        ? target.addEventListener('click', handler, options) : addEventListener(node, 'click', handler, options);
      const dispatch = () => native ? target.dispatchEvent(new Event('click')) : dispatchNodeEvent(node, 'click');
      const once = () => { calls.push('once'); dispatch(); };
      add(once, { once: true }); add(once, { once: false });
      add(() => calls.push('signal'), { signal: controller.signal });
      dispatch(); controller.abort(); dispatch();
      return calls;
    }
    expect(exercise(false)).toEqual(exercise(true));
    expect(exercise(false)).toEqual(['once', 'signal', 'signal']);
  });

  it('removes once before nested dispatch and preserves the callback receiver', () => {
    const node = createElement('mesh'), handler = vi.fn(function (this: unknown) {
      expect(this).toBe(node); dispatchNodeEvent(node, 'click');
    });
    addEventListener(node, 'click', handler, { once: true });
    dispatchNodeEvent(node, 'click'); dispatchNodeEvent(node, 'click');
    expect(handler).toHaveBeenCalledOnce();
    expect(node.listeners.size).toBe(0);
  });

  it('removes a throwing once listener and releases its abort subscription', () => {
    const node = createElement('mesh'), controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    addEventListener(node, 'click', () => { throw new Error('failure'); }, { once: true, signal: controller.signal });
    expect(() => dispatchNodeEvent(node, 'click')).toThrow('failure');
    expect(() => dispatchNodeEvent(node, 'click')).not.toThrow();
    expect(remove).toHaveBeenCalledOnce();
    expect(node.listeners.size).toBe(0);
  });

  it('ignores aborted signals without changing interaction membership', () => {
    const root = createFragment(), node = createElement('mesh');
    insert(root, node, null);
    const scheduleSync = vi.fn(); root.runtime = { scheduleSync };
    const controller = new AbortController(); controller.abort();
    addEventListener(node, 'click', vi.fn(), { capture: true, signal: controller.signal });
    expect(node.captureListeners).toBeUndefined();
    expect(node.listeners.size).toBe(0);
    expect(scheduleSync).not.toHaveBeenCalled();
  });

  it('aborts a listener synchronously before its turn in an active dispatch', () => {
    const node = createElement('mesh'), controller = new AbortController(), handler = vi.fn();
    addEventListener(node, 'click', () => controller.abort());
    addEventListener(node, 'click', handler, { signal: controller.signal });
    dispatchNodeEvent(node, 'click');
    expect(handler).not.toHaveBeenCalled();
    expect(node.listeners.get('click')?.size).toBe(1);
  });

  it('does not mistake synthetic abort events for cancellation or lose the real abort hook', () => {
    const node = createElement('mesh'), controller = new AbortController(), handler = vi.fn();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    addEventListener(node, 'click', handler, { signal: controller.signal });
    controller.signal.dispatchEvent(new Event('abort'));
    dispatchNodeEvent(node, 'click');
    expect(handler).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    controller.abort(); dispatchNodeEvent(node, 'click');
    expect(handler).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(node.listeners.size).toBe(0);
  });

  it('matches duplicates/removal by type, listener and capture, not newer options', () => {
    const node = createElement('mesh'), handler = vi.fn(), first = new AbortController(), duplicate = new AbortController();
    addEventListener(node, 'click', handler, { once: true, signal: first.signal });
    addEventListener(node, 'click', handler, { once: false, signal: duplicate.signal });
    addEventListener(node, 'click', handler, { capture: true });
    duplicate.abort();
    dispatchNodeEvent(node, 'click'); dispatchNodeEvent(node, 'click');
    expect(handler).toHaveBeenCalledTimes(3);
    removeEventListener(node, 'click', handler);
    dispatchNodeEvent(node, 'click');
    expect(handler).toHaveBeenCalledTimes(4);
    removeEventListener(node, 'click', handler, true);
    expect(node.captureListeners).toBeUndefined();
  });

  it('does not resurrect a removed registration when the callback is re-added', () => {
    const node = createElement('mesh'), second = vi.fn();
    addEventListener(node, 'click', () => {
      removeEventListener(node, 'click', second);
      addEventListener(node, 'click', second);
    }, { once: true });
    addEventListener(node, 'click', second);
    dispatchNodeEvent(node, 'click');
    expect(second).not.toHaveBeenCalled();
    dispatchNodeEvent(node, 'click');
    expect(second).toHaveBeenCalledOnce();
  });

  it('scopes passive cancellation to each listener, including nested dispatch', () => {
    const node = createElement('mesh'), original = new Event('wheel', { cancelable: true });
    const cancel = vi.spyOn(original, 'preventDefault'), states: boolean[] = [];
    addEventListener(node, 'custom', event => { event.preventDefault(); expect(event.defaultPrevented).toBe(true); });
    addEventListener(node, 'wheel', event => {
      event.preventDefault(); states.push(event.defaultPrevented);
      dispatchNodeEvent(node, 'custom');
      event.preventDefault(); states.push(event.defaultPrevented);
    }, { passive: true });
    addEventListener(node, 'wheel', event => { event.preventDefault(); states.push(event.defaultPrevented); });
    dispatchNodeEvent(node, 'wheel', { originalEvent: original });
    expect(states).toEqual([false, false, true]);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('clears passive invocation state after exceptions', () => {
    const node = createElement('mesh'); let retained!: TypeGpuNodeEvent;
    addEventListener(node, 'custom', event => { retained = event; throw new Error('failure'); }, { passive: true });
    expect(() => dispatchNodeEvent(node, 'custom')).toThrow('failure');
    retained.preventDefault();
    expect(retained.defaultPrevented).toBe(true);
    expect(retained.currentTarget).toBeNull();
  });

  it('snapshots options and keeps helper subscriptions independent', () => {
    const node = createElement('mesh'), controller = new AbortController(), handler = vi.fn();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const options = { once: true, capture: true, signal: controller.signal };
    const first = onNodeEvent(node, 'click', handler, options);
    const second = onNodeEvent(node, 'click', handler, options);
    options.once = false; options.capture = false;
    first(); first();
    expect(remove).toHaveBeenCalledOnce();
    dispatchNodeEvent(node, 'click'); dispatchNodeEvent(node, 'click');
    expect(handler).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledTimes(2);
    second(); controller.abort();
    expect(remove).toHaveBeenCalledTimes(2);
    expect(node.captureListeners).toBeUndefined();
  });

  it('supports handleEvent objects through the renderer hook', () => {
    const node = createElement('mesh');
    const handler = { handleEvent: vi.fn(function (this: unknown) { expect(this).toBe(handler); }) };
    renderer.addEventListener(node, 'click', handler, { once: true });
    dispatchNodeEvent(node, 'click'); dispatchNodeEvent(node, 'click');
    expect(handler.handleEvent).toHaveBeenCalledOnce();
  });

  it('rolls back a failed native abort subscription', () => {
    const node = createElement('mesh'), controller = new AbortController();
    vi.spyOn(controller.signal, 'addEventListener').mockImplementation(() => { throw new Error('signal failed'); });
    expect(() => addEventListener(node, 'click', vi.fn(), { signal: controller.signal })).toThrow('signal failed');
    expect(node.listeners.size).toBe(0);
  });
});
