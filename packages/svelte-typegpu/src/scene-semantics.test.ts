import tgpu, { d } from 'typegpu';
import { describe, expect, it } from 'vitest';
import {
  addEventListener,
  createElement,
  insert,
  remove,
  removeAttribute,
  setAttribute
} from './core';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';

describe('scene inheritance', () => {
  it('hides nested draws, picks, lights, and shader passes without losing resource ownership', () => {
    const scene = createElement('scene');
    const parent = createElement('group');
    const child = createElement('group');
    const mesh = createElement('mesh');
    const pass = createElement('shaderPass');
    setAttribute(
      pass,
      'fragment',
      tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(() => d.vec4f(1))
    );
    insert(mesh, createElement('boxGeometry'), null);
    addEventListener(mesh, 'click', () => {});
    insert(child, mesh, null);
    insert(child, createElement('pointLight'), null);
    insert(child, pass, null);
    insert(parent, child, null);
    insert(scene, parent, null);
    const cache = createTypeGpuSceneCache();
    const visible = createSceneState(scene, cache);
    expect(visible.drawBatches).toHaveLength(1);
    expect(visible.interaction.targets).toHaveLength(1);
    expect(visible.lights).toHaveLength(1);
    expect(visible.shaderPasses).toHaveLength(1);

    setAttribute(parent, 'visible', false);
    setAttribute(child, 'visible', true);
    const hidden = createSceneState(scene, cache);
    expect(hidden.drawBatches).toHaveLength(0);
    expect(hidden.interaction.targets).toHaveLength(0);
    expect(hidden.lights).toHaveLength(0);
    expect(hidden.shaderPasses).toHaveLength(0);
    expect(hidden.liveResourceKeys.geometries).toEqual(visible.liveResourceKeys.geometries);
    expect(hidden.shaderPassNodes?.has(pass)).toBe(true);

    setAttribute(mesh, 'position', [3, 0, 0]);
    removeAttribute(parent, 'visible');
    const shown = createSceneState(scene, cache);
    expect(shown.drawBatches[0].instances[0]).toBe(3);
    expect(shown.drawBatches[0].geometry).toBe(visible.drawBatches[0].geometry);
    expect(shown.interaction.targets[0].bounds.min[0]).toBe(2.5);

    remove(parent);
    const removed = createSceneState(scene, cache);
    expect(removed.liveResourceKeys.geometries.size).toBe(0);
    expect(removed.shaderPassNodes?.size).toBe(0);
  });

  it('inherits mesh visibility and transforms into nested meshes and lights after reparenting', () => {
    const scene = createElement('scene');
    const parent = createElement('mesh');
    const child = createElement('mesh');
    const light = createElement('pointLight');
    insert(child, createElement('boxGeometry'), null);
    insert(parent, child, null);
    insert(parent, light, null);
    insert(scene, parent, null);
    setAttribute(parent, 'position', [4, 0, 0]);
    const cache = createTypeGpuSceneCache();
    expect(createSceneState(scene, cache).lights[0].position).toEqual([4, 0, 0]);
    setAttribute(parent, 'visible', false);
    expect(createSceneState(scene, cache).drawBatches).toHaveLength(0);
    insert(scene, child, null);
    expect(createSceneState(scene, cache).drawBatches[0].instances[0]).toBe(0);
    setAttribute(light, 'visible', false);
    setAttribute(parent, 'visible', true);
    expect(createSceneState(scene, cache).lights).toHaveLength(0);
  });

  it('resolves settings from scene, root, then library defaults, including attribute removal', () => {
    const scene = createElement('scene');
    const defaults = {
      clearColor: [0.2, 0.3, 0.4, 0.5] as [number, number, number, number],
      depth: false,
      frustumCulling: false,
      alphaMode: 'opaque' as const
    };
    const cache = createTypeGpuSceneCache({ renderDefaults: defaults });
    expect(createSceneState(scene, cache).renderSettings).toEqual(defaults);
    setAttribute(scene, 'depth', true);
    setAttribute(scene, 'frustumCulling', true);
    setAttribute(scene, 'alphaMode', 'premultiplied');
    setAttribute(scene, 'clearColor', [1, 0, 0, 1]);
    expect(createSceneState(scene, cache).renderSettings).toEqual({
      clearColor: [1, 0, 0, 1],
      depth: true,
      frustumCulling: true,
      alphaMode: 'premultiplied'
    });
    removeAttribute(scene, 'depth');
    removeAttribute(scene, 'frustumCulling');
    removeAttribute(scene, 'alphaMode');
    removeAttribute(scene, 'clearColor');
    expect(createSceneState(scene, cache).renderSettings).toEqual(defaults);
    expect(createSceneState(scene).renderSettings).toEqual({
      clearColor: [0, 0, 0, 1],
      depth: true,
      frustumCulling: true,
      alphaMode: 'premultiplied'
    });
  });
});
