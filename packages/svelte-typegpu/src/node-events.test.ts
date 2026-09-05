import { describe, expect, it, vi } from 'vitest';
import {
  addEventListener,
  createElement,
  dispatchNodeEvent,
  insert,
  remove,
  removeEventListener,
  type TypeGpuNodeEvent
} from './core';

function tree() {
  const scene = createElement('scene');
  const group = createElement('group');
  const mesh = createElement('mesh');
  insert(scene, group, null);
  insert(group, mesh, null);
  return { scene, group, mesh };
}

describe('scene event propagation', () => {
  it('shares one event along the original ancestry and clears currentTarget afterward', () => {
    const { scene, group, mesh } = tree();
    const calls: unknown[] = [];
    const events: TypeGpuNodeEvent[] = [];
    for (const node of [mesh, group, scene]) {
      addEventListener(node, 'click', (event) => {
        events.push(event);
        calls.push([event.target, event.currentTarget]);
      });
    }
    dispatchNodeEvent(mesh, 'click');
    expect(calls).toEqual([
      [mesh, mesh],
      [mesh, group],
      [mesh, scene]
    ]);
    expect(new Set(events).size).toBe(1);
    expect(events[0].currentTarget).toBe(null);
  });

  it.each(['stopPropagation', 'stopImmediatePropagation'] as const)(
    '%s controls only scene propagation',
    (method) => {
      const { group, mesh } = tree();
      const second = vi.fn();
      const parent = vi.fn();
      const original = new Event('click', { cancelable: true });
      const stop = vi.spyOn(original, 'stopPropagation');
      addEventListener(mesh, 'click', (event) => event[method]());
      addEventListener(mesh, 'click', second);
      addEventListener(group, 'click', parent);
      dispatchNodeEvent(mesh, 'click', { originalEvent: original });
      expect(second).toHaveBeenCalledTimes(method === 'stopPropagation' ? 1 : 0);
      expect(parent).not.toHaveBeenCalled();
      expect(stop).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])('honors original event cancelability (%s)', (cancelable) => {
    const { mesh } = tree();
    const original = new Event('click', { cancelable });
    let prevented = false;
    addEventListener(mesh, 'click', (event) => {
      event.preventDefault();
      prevented = event.defaultPrevented;
    });
    dispatchNodeEvent(mesh, 'click', { originalEvent: original });
    expect(prevented).toBe(cancelable);
    expect(original.defaultPrevented).toBe(cancelable);
  });

  it('uses the dispatch-time path when a handler removes and reparents the target', () => {
    const { scene, group, mesh } = tree();
    const other = createElement('group');
    const calls: string[] = [];
    addEventListener(mesh, 'click', () => {
      remove(group);
      insert(other, mesh, null);
    });
    addEventListener(group, 'click', () => calls.push('group'));
    addEventListener(scene, 'click', () => calls.push('scene'));
    addEventListener(other, 'click', () => calls.push('other'));
    dispatchNodeEvent(mesh, 'click');
    expect(calls).toEqual(['group', 'scene']);
  });

  it('skips removed listeners and defers listeners added during the same node visit', () => {
    const { mesh } = tree();
    const removed = vi.fn();
    const added = vi.fn();
    addEventListener(mesh, 'click', () => {
      removeEventListener(mesh, 'click', removed);
      addEventListener(mesh, 'click', added);
    });
    addEventListener(mesh, 'click', removed);
    dispatchNodeEvent(mesh, 'click');
    expect(removed).not.toHaveBeenCalled();
    expect(added).not.toHaveBeenCalled();
    dispatchNodeEvent(mesh, 'click');
    expect(added).toHaveBeenCalledOnce();
  });

  it('keeps nested dispatch state independent', () => {
    const { group, mesh } = tree();
    const calls: string[] = [];
    addEventListener(mesh, 'click', (event) => {
      event.stopPropagation();
      dispatchNodeEvent(mesh, 'pointerdown');
      expect(event.currentTarget).toBe(mesh);
    });
    addEventListener(group, 'click', () => calls.push('click'));
    addEventListener(group, 'pointerdown', () => calls.push('down'));
    dispatchNodeEvent(mesh, 'click');
    expect(calls).toEqual(['down']);
  });

  it.each(['pointerenter', 'pointerleave', 'camerachange', 'custom'])(
    'keeps %s local unless opted into bubbling',
    (type) => {
      const { group, mesh } = tree();
      const parent = vi.fn();
      addEventListener(group, type, parent);
      dispatchNodeEvent(mesh, type);
      expect(parent).not.toHaveBeenCalled();
      dispatchNodeEvent(mesh, type, { bubbles: true });
      expect(parent).toHaveBeenCalledOnce();
    }
  );

  it('clears currentTarget even when a listener throws', () => {
    const { mesh } = tree();
    const events: TypeGpuNodeEvent[] = [];
    addEventListener(mesh, 'click', (event) => {
      events.push(event);
      throw new Error('handler failed');
    });
    expect(() => dispatchNodeEvent(mesh, 'click')).toThrow('handler failed');
    expect(events[0].currentTarget).toBe(null);
  });
});
