import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { onNodeEvent } from './attachments';
import { compileTypeGpuSource } from './component-test-utils';
import {
  addEventListener,
  createElement,
  createFragment,
  dispatchNodeEvent,
  insert,
  removeEventListener,
  type TypeGpuNodeEvent
} from './core';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';
import renderer from './svelte-renderer';
import { Dirty } from './dirty';

function tree() {
  const scene = createElement('scene');
  const group = createElement('group');
  const mesh = createElement('mesh');
  insert(scene, group, null);
  insert(group, mesh, null);
  insert(mesh, createElement('boxGeometry'), null);
  return { scene, group, mesh };
}

describe('scene capture events', () => {
  it('uses one event for capture, target, and bubble phases in order', () => {
    const { scene, group, mesh } = tree();
    const calls: unknown[] = [];
    const events: TypeGpuNodeEvent[] = [];
    for (const node of [mesh, group, scene]) {
      for (const capture of [false, true]) {
        addEventListener(
          node,
          'click',
          (event) => {
            calls.push([node, capture, event.eventPhase]);
            expect(event.target).toBe(mesh);
            expect(event.currentTarget).toBe(node);
            events.push(event);
          },
          { capture }
        );
      }
    }
    dispatchNodeEvent(mesh, 'click');
    expect(calls).toEqual([
      [scene, true, 1],
      [group, true, 1],
      [mesh, true, 2],
      [mesh, false, 2],
      [group, false, 3],
      [scene, false, 3]
    ]);
    expect(new Set(events).size).toBe(1);
    expect(events[0].currentTarget).toBeNull();
    expect(events[0].eventPhase).toBe(0);
  });

  it.each(['stopPropagation', 'stopImmediatePropagation'] as const)(
    'honors %s in capture without reaching the target',
    (method) => {
      const { group, mesh } = tree();
      const sibling = vi.fn();
      const target = vi.fn();
      addEventListener(group, 'click', (event) => event[method](), true);
      addEventListener(group, 'click', sibling, true);
      addEventListener(mesh, 'click', target);
      dispatchNodeEvent(mesh, 'click');
      expect(sibling).toHaveBeenCalledTimes(method === 'stopPropagation' ? 1 : 0);
      expect(target).not.toHaveBeenCalled();
    }
  );

  it('stops the later target bubble pass when target capture stops propagation', () => {
    const { mesh } = tree();
    const capture = vi.fn();
    const bubble = vi.fn();
    addEventListener(mesh, 'click', (event) => event.stopPropagation(), true);
    addEventListener(mesh, 'click', capture, true);
    addEventListener(mesh, 'click', bubble);
    dispatchNodeEvent(mesh, 'click');
    expect(capture).toHaveBeenCalledOnce();
    expect(bubble).not.toHaveBeenCalled();
  });

  it('captures non-bubbling events without invoking ancestor bubble listeners', () => {
    const { group, mesh } = tree();
    const capture = vi.fn();
    const bubble = vi.fn();
    addEventListener(group, 'pointerenter', capture, true);
    addEventListener(group, 'pointerenter', bubble);
    dispatchNodeEvent(mesh, 'pointerenter');
    expect(capture).toHaveBeenCalledOnce();
    expect(bubble).not.toHaveBeenCalled();
  });

  it('uses capture as part of listener identity and releases empty capture storage', () => {
    const { mesh } = tree();
    const handler = vi.fn();
    expect(mesh.captureListeners).toBeUndefined();
    addEventListener(mesh, 'click', handler);
    addEventListener(mesh, 'click', handler, true);
    addEventListener(mesh, 'click', handler, { capture: true });
    dispatchNodeEvent(mesh, 'click');
    expect(handler).toHaveBeenCalledTimes(2);
    removeEventListener(mesh, 'click', handler, { capture: true });
    expect(mesh.captureListeners).toBeUndefined();
    dispatchNodeEvent(mesh, 'click');
    expect(handler).toHaveBeenCalledTimes(3);
    removeEventListener(mesh, 'click', handler);
    expect(mesh.listeners.size).toBe(0);
  });

  it('keeps the capture-time path when the target is reparented', () => {
    const { scene, group, mesh } = tree();
    const other = createElement('group');
    const calls: string[] = [];
    addEventListener(scene, 'click', () => insert(other, mesh, null), true);
    addEventListener(group, 'click', () => calls.push('capture'), true);
    addEventListener(group, 'click', () => calls.push('bubble'));
    addEventListener(other, 'click', () => calls.push('new-parent'), true);
    dispatchNodeEvent(mesh, 'click');
    expect(calls).toEqual(['capture', 'bubble']);
  });

  it('preserves outer event phase during nested dispatch and clears it after exceptions', () => {
    const { group, mesh } = tree();
    let captured: TypeGpuNodeEvent;
    addEventListener(
      group,
      'click',
      (event) => {
        captured = event;
        dispatchNodeEvent(mesh, 'pointerdown');
        expect(event.eventPhase).toBe(1);
        expect(event.currentTarget).toBe(group);
        throw new Error('capture failed');
      },
      true
    );
    addEventListener(mesh, 'pointerdown', (event) => expect(event.eventPhase).toBe(2));
    expect(() => dispatchNodeEvent(mesh, 'click')).toThrow('capture failed');
    expect(captured!.eventPhase).toBe(0);
    expect(captured!.currentTarget).toBeNull();
  });

  it('makes capture-only descendants pickable without rebuilding draw resources on listener edits', () => {
    const { scene, group, mesh } = tree();
    const cache = createTypeGpuSceneCache();
    const initial = createSceneState(scene, cache);
    const capture = vi.fn();
    addEventListener(group, 'click', capture, true);
    const active = createSceneState(scene, cache, { dirty: Dirty.Interaction });
    expect(active.resourceItems).toBe(initial.resourceItems);
    expect(active.interaction.targets.map((target) => target.node)).toEqual([mesh]);
    expect(active.interaction.targets[0].handlers).toEqual(new Set(['click']));
    expect(cache.transforms.isReady(scene)).toBe(true);
    removeEventListener(group, 'click', capture, true);
    expect(
      createSceneState(scene, cache, { dirty: Dirty.Interaction }).interaction.targets
    ).toEqual([]);
  });

  it('cleans up an attachment subscription with the original capture flag', () => {
    const { group, mesh } = tree();
    const options = { capture: true };
    const handler = vi.fn();
    const off = onNodeEvent(group, 'click', handler, options);
    dispatchNodeEvent(mesh, 'click');
    expect(handler).toHaveBeenCalledOnce();
    options.capture = false;
    off();
    off();
    expect(group.captureListeners).toBeUndefined();
    expect(group.listeners.size).toBe(0);
  });

  it('runs actual compiled onclickcapture before target and bubble attributes', async () => {
    const Scene = compileTypeGpuSource(`
      <script>let { record } = $props();</script>
      <scene onclickcapture={event => record('scene-capture', event.eventPhase)}>
        <group onclick={event => record('group-bubble', event.eventPhase)}>
          <mesh onclick={event => record('mesh-bubble', event.eventPhase)}
                onclickcapture={event => record('mesh-capture', event.eventPhase)}>
            <boxGeometry />
          </mesh>
        </group>
      </scene>
    `);
    const root = createFragment();
    const record = vi.fn();
    const instance = mount(Scene, { renderer, target: root, props: { record } });
    try {
      flushSync();
      const mesh = createSceneState(root).interaction.targets[0].node;
      dispatchNodeEvent(mesh, 'click');
      expect(record.mock.calls).toEqual([
        ['scene-capture', 1],
        ['mesh-capture', 2],
        ['mesh-bubble', 2],
        ['group-bubble', 3]
      ]);
    } finally {
      await unmount(instance);
    }
  });
});
