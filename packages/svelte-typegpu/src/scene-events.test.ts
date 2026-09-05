import { describe, expect, it, vi } from 'vitest';
import {
  addEventListener,
  createElement,
  createFragment,
  insert,
  removeEventListener,
  setAttribute
} from './core';
import { Dirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';

function fixture() {
  const root = createFragment();
  const scene = createElement('scene');
  const group = createElement('group');
  const meshes = Array.from({ length: 3 }, () => createElement('mesh'));
  insert(root, scene, null);
  insert(scene, group, null);
  for (const mesh of meshes) {
    insert(group, mesh, null);
    insert(mesh, createElement('boxGeometry'), null);
  }
  return { root, scene, group, meshes, cache: createTypeGpuSceneCache() };
}

describe('ancestor interaction eligibility', () => {
  it('shares inherited handler sets and only copies them for new event types', () => {
    const { root, scene, group, meshes } = fixture();
    addEventListener(scene, 'click', vi.fn());
    addEventListener(group, 'pointerenter', vi.fn());
    addEventListener(meshes[1], 'click', vi.fn());
    addEventListener(meshes[2], 'dragmove', vi.fn());
    const targets = createSceneState(root).interaction.targets;
    expect(targets.map((target) => target.node)).toEqual(meshes);
    expect(targets[0].handlers).toEqual(new Set(['click', 'pointerenter']));
    expect(targets[1].handlers).toBe(targets[0].handlers);
    expect(targets[2].handlers).not.toBe(targets[0].handlers);
    expect(targets[2].handlers).toEqual(new Set(['click', 'pointerenter', 'dragmove']));
  });

  it('retains local mesh opt-outs and inherited visibility', () => {
    const { root, group, meshes } = fixture();
    addEventListener(group, 'click', vi.fn());
    setAttribute(meshes[0], 'pointerEvents', 'none');
    setAttribute(meshes[1], 'hitTest', 'none');
    expect(createSceneState(root).interaction.targets.map((target) => target.node)).toEqual([
      meshes[2]
    ]);
    setAttribute(group, 'visible', false);
    expect(createSceneState(root).interaction.targets).toEqual([]);
  });

  it('rebuilds listeners without resetting resources or the incremental motion cache', () => {
    const { root, group, meshes, cache } = fixture();
    const initial = createSceneState(root, cache);
    const reset = vi.spyOn(cache.transforms, 'reset');
    const listener = vi.fn();
    addEventListener(group, 'click', listener);
    const listening = createSceneState(root, cache, { dirty: Dirty.Interaction });
    expect(listening.interaction.targets).toHaveLength(3);
    expect(listening.resourceItems).toBe(initial.resourceItems);
    expect(cache.transforms.isReady(root)).toBe(true);
    expect(reset).not.toHaveBeenCalled();

    const target = listening.interaction.targets[0];
    const handlers = target.handlers;
    setAttribute(meshes[0], 'position', [2, 0, 0]);
    const moving = createSceneState(root, cache, {
      dirty: Dirty.Transform,
      dirtyNodes: new Map([[meshes[0], Dirty.Transform]])
    });
    expect(moving.interaction).toBe(listening.interaction);
    expect(target.handlers).toBe(handlers);
    expect(target.bounds.min[0]).toBe(1.5);
    expect(cache.transforms.stats.itemsUpdated).toBe(1);
    expect(moving.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);

    removeEventListener(group, 'click', listener);
    expect(createSceneState(root, cache, { dirty: Dirty.Interaction }).interaction.targets).toEqual(
      []
    );
    const oldBounds = target.bounds;
    setAttribute(meshes[0], 'position', [3, 0, 0]);
    createSceneState(root, cache, {
      dirty: Dirty.Transform,
      dirtyNodes: new Map([[meshes[0], Dirty.Transform]])
    });
    expect(cache.transforms.stats.itemsUpdated).toBe(1);
    expect(reset).not.toHaveBeenCalled();
    expect(target.bounds).toBe(oldBounds);
  });

  it('recomputes inherited eligibility after reparenting', () => {
    const { root, scene, group, meshes, cache } = fixture();
    addEventListener(group, 'click', vi.fn());
    createSceneState(root, cache);
    insert(scene, meshes[0], null);
    expect(createSceneState(root, cache).interaction.targets.map((target) => target.node)).toEqual(
      meshes.slice(1)
    );
  });

  it('refreshes interaction-only attributes on retained draw items', () => {
    const { root, group, meshes, cache } = fixture();
    addEventListener(group, 'dragmove', vi.fn());
    const initial = createSceneState(root, cache);
    setAttribute(meshes[0], 'pointerEvents', 'none');
    setAttribute(meshes[1], 'hitTest', 'none');
    setAttribute(meshes[2], 'drag', 'rotate');
    setAttribute(meshes[2], 'dragButton', 'secondary');
    const updated = createSceneState(root, cache, { dirty: Dirty.Interaction });
    expect(updated.resourceItems).toBe(initial.resourceItems);
    expect(updated.interaction.targets).toHaveLength(1);
    expect(updated.interaction.targets[0]).toMatchObject({
      node: meshes[2], drag: 'rotate', dragButton: 'secondary'
    });
    expect(cache.transforms.isReady(root)).toBe(true);
  });
});
