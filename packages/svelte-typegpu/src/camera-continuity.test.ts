import { describe, expect, it, vi } from 'vitest';
import { createElement, insert, remove, removeAttribute, setAttribute } from './core';
import { Dirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import type { TypeGpuPerspectiveCameraSettings } from './types';

function fixture() {
  const root = createElement('scene'), camera = createElement('perspectiveCamera');
  setAttribute(camera, 'position', [0, 0, 10]);
  insert(root, camera, null);
  const cache = createTypeGpuSceneCache(), initial = createSceneState(root, cache);
  const live: TypeGpuPerspectiveCameraSettings = {
    projection: 'perspective', position: [3, 2, 9], target: [1, 1, 1], fov: 55, near: 0.2, far: 200
  };
  initial.camera = live;
  return { root, camera, cache, initial, live };
}

describe('declarative camera continuity', () => {
  it.each([Dirty.All, Dirty.Tree, Dirty.RenderSettings, Dirty.Geometry,
    Dirty.MaterialUniform | Dirty.Interaction, Dirty.Transform | Dirty.Interaction])(
    'retains live camera settings across unrelated compilation (mask %s)', dirty => {
      const { root, cache, live } = fixture();
      expect(createSceneState(root, cache, { dirty }).camera).toBe(live);
    }
  );

  it.each([
    ['position', [4, 3, 8]], ['target', [2, 1, 0]], ['fov', 60], ['near', 0.5], ['far', 300]
  ] as const)('applies only a changed %s declaration', (attribute, value) => {
    const { root, camera, cache, live } = fixture();
    setAttribute(camera, attribute, value);
    const changed = createSceneState(root, cache, { dirty: Dirty.Camera });
    expect(changed.camera).toEqual({ ...live, [attribute]: value });
    expect(createSceneState(root, cache).camera).toBe(changed.camera);
  });

  it('restores retained camera views and merges declarations changed while inactive', () => {
    const { root, camera, cache, live } = fixture();
    const other = createElement('perspectiveCamera');
    setAttribute(other, 'active', true); setAttribute(other, 'position', [0, 0, 20]);
    insert(root, other, null);
    const selected = createSceneState(root, cache);
    const otherLive = { ...selected.camera, position: [8, 2, 18] as [number, number, number] };
    selected.camera = otherLive;
    setAttribute(camera, 'fov', 65); setAttribute(other, 'active', false);
    expect(createSceneState(root, cache).camera).toEqual({ ...live, fov: 65 });
    setAttribute(other, 'active', true);
    expect(createSceneState(root, cache).camera).toBe(otherLive);
  });

  it('records a changed declaration even when the live value already matches it', () => {
    const { root, camera, cache, live } = fixture();
    setAttribute(camera, 'near', live.near);
    const echoed = createSceneState(root, cache);
    echoed.camera = { ...echoed.camera, near: 0.3 };
    expect(createSceneState(root, cache).camera.near).toBe(0.3);
  });

  it('does not consume a camera declaration when later scene compilation fails', () => {
    const { root, camera, cache, live } = fixture();
    setAttribute(camera, 'fov', 60);
    vi.spyOn(cache.drawBatchCache, 'read').mockImplementationOnce(() => { throw new Error('compile failed'); });
    expect(() => createSceneState(root, cache)).toThrow('compile failed');
    expect(createSceneState(root, cache).camera).toEqual({ ...live, fov: 60 });
  });

  it('merges orthographic lens changes without losing a live pose', () => {
    const root = createElement('scene'), camera = createElement('orthographicCamera');
    insert(root, camera, null);
    const cache = createTypeGpuSceneCache(), initial = createSceneState(root, cache);
    const live = { projection: 'orthographic' as const, position: [4, 3, 8] as [number, number, number],
      target: [1, 0, 0] as [number, number, number], zoom: 2, near: 0.2, far: 200 };
    initial.camera = live;
    setAttribute(camera, 'zoom', 3);
    expect(createSceneState(root, cache).camera).toEqual({ ...live, zoom: 3 });
    setAttribute(camera, 'near', 0.5);
    expect(createSceneState(root, cache).camera).toEqual({ ...live, zoom: 3, near: 0.5 });
  });

  it('preserves keyed identity on a move but resets a replacement camera', () => {
    const { root, camera, cache, live } = fixture();
    insert(root, camera, null);
    expect(createSceneState(root, cache).camera).toBe(live);
    remove(camera);
    const replacement = createElement('perspectiveCamera');
    setAttribute(replacement, 'position', [0, 0, 10]); insert(root, replacement, null);
    expect(createSceneState(root, cache).camera.position).toEqual([0, 0, 10]);
  });

  it('keeps declaration vectors independent of in-place live mutation', () => {
    const { root, camera } = fixture();
    const cache = createTypeGpuSceneCache(), initial = createSceneState(root, cache);
    initial.camera.position[0] = 7;
    expect(createSceneState(root, cache).camera.position[0]).toBe(7);
    setAttribute(camera, 'position', [0, 0, 11]);
    expect(createSceneState(root, cache).camera.position).toEqual([0, 0, 11]);
  });

  it('applies cameraPose/cameraLens updates and defaults without resetting unrelated fields', () => {
    const { root, camera, cache } = fixture();
    const pose = createElement('cameraPose'), lens = createElement('cameraLens');
    setAttribute(pose, 'position', [0, 0, 10]); setAttribute(lens, 'fov', 60);
    insert(camera, pose, null); insert(camera, lens, null);
    const state = createSceneState(root, cache);
    const live = { ...state.camera, position: [3, 0, 9] as [number, number, number] };
    state.camera = live;
    removeAttribute(lens, 'fov');
    expect(createSceneState(root, cache).camera).toEqual({ ...live, fov: 45 });
    setAttribute(pose, 'target', [1, 2, 3]);
    expect(createSceneState(root, cache).camera).toEqual({ ...live, fov: 45, target: [1, 2, 3] });
  });

  it('isolates camera continuity between roots and after disposal of the cache', () => {
    const { root, camera, cache } = fixture();
    const nextRoot = createElement('scene'); insert(nextRoot, camera, null);
    expect(createSceneState(nextRoot, cache).camera.position).toEqual([0, 0, 10]);
    insert(root, camera, null);
    const state = createSceneState(root, cache); state.camera = { ...state.camera, position: [5, 0, 10] };
    // Runtime disposal clears the owning scene cache before it can be reused.
    cache.cameras.clear();
    expect(createSceneState(root, cache).camera.position).toEqual([0, 0, 10]);
  });
});
