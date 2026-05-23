import { describe, expect, it } from 'vitest';
import { addEventListener, createElement, createFragment, insert, setAttribute } from './core';
import { Dirty, hasDirty } from './dirty';
import type { TypeGpuLoadedModel } from './glb-loader';
import { createModelCache } from './model-cache';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';

describe('TypeGPU scene compiler', () => {
  it('compiles render settings, camera, lights, draw batches, interaction, and live keys', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('orbitControls');
    const light = createElement('directionalLight');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('phongMaterial');

    setAttribute(scene, 'clearColor', [0.2, 0.3, 0.4, 1]);
    setAttribute(scene, 'depth', false);
    setAttribute(scene, 'alphaMode', 'opaque');
    setAttribute(camera, 'id', 'main');
    setAttribute(camera, 'active', true);
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(controls, 'camera', 'main');
    setAttribute(light, 'position', [3, 4, 5]);
    setAttribute(mesh, 'position', [1, 2, 3]);
    addEventListener(mesh, 'click', () => {});
    setAttribute(material, 'color', [1, 0.5, 0.25, 1]);

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, camera, null);
    insert(scene, controls, null);
    insert(scene, light, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

    expect(state.renderSettings).toEqual({
      clearColor: [0.2, 0.3, 0.4, 1],
      depth: false,
      alphaMode: 'opaque'
    });
    expect(state.camera.projection).toBe('perspective');
    expect(state.camera.position).toEqual([0, 0, 10]);
    expect(state.cameraController?.kind).toBe('orbit');
    expect(state.lights).toHaveLength(1);
    expect(state.drawBatches).toHaveLength(1);
    expect(state.drawBatches[0]).toMatchObject({
      passKey: 'pass:main',
      geometryKey: 'box:1:1:1',
      materialKey: expect.stringContaining('material:phong')
    });
    expect(state.drawBatchesChanged).toBe(true);
    expect(state.lightsChanged).toBe(true);
    expect(state.interaction.targets).toHaveLength(1);
    expect(state.interaction.targets[0]).toMatchObject({
      node: mesh,
      drawItemId: mesh.uid,
      pointerEvents: 'auto',
      hitTest: 'bounds'
    });
    expect(state.liveResourceKeys.geometries.has('box:1:1:1')).toBe(true);
    expect(
      state.liveResourceKeys.materials.has(state.drawBatches[0].material.key!)
    ).toBe(true);
    expect(state.liveResourceKeys.textures.has('solid:white')).toBe(true);
    expect(state.liveResourceKeys.samplers.has('sampler:default')).toBe(true);
    expect(state.liveResourceKeys.pipelines.has(state.drawBatches[0].pipelineKey)).toBe(true);
    expect(hasDirty(state.dirty, Dirty.DrawBatches)).toBe(true);
  });

  it('resolves geometry and material string references through scene resources', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const reusableGeometry = createElement('boxGeometry');
    const texture = createElement('texture');
    const material = createElement('standardMaterial');
    const mesh = createElement('mesh');

    setAttribute(reusableGeometry, 'id', 'crateGeometry');
    setAttribute(reusableGeometry, 'width', 2);
    setAttribute(texture, 'id', 'crateTexture');
    setAttribute(texture, 'src', '/crate.png');
    setAttribute(material, 'id', 'crateMaterial');
    setAttribute(material, 'map', 'crateTexture');
    setAttribute(mesh, 'geometry', 'crateGeometry');
    setAttribute(mesh, 'material', 'crateMaterial');

    insert(scene, reusableGeometry, null);
    insert(scene, texture, null);
    insert(scene, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

    expect(state.drawBatches[0]).toMatchObject({
      geometryKey: 'box:2:1:1',
      materialKey: expect.stringContaining('material:standard')
    });
    expect(state.liveResourceKeys.geometries.has('box:2:1:1')).toBe(true);
    expect(
      [...state.liveResourceKeys.textures].some((key) =>
        key.startsWith('texture:crateTexture@rev:')
      )
    ).toBe(true);
  });

  it('reuses clean draw batches, lights, and interaction indexes by dirty mask', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const cache = createTypeGpuSceneCache();

    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const first = createSceneState(root, cache, { dirty: Dirty.All });
    const second = createSceneState(root, cache, { dirty: Dirty.RenderSettings });

    expect(second.drawBatches[0].instances).toBe(first.drawBatches[0].instances);
    expect(second.drawBatches[0].instancesChanged).toBe(false);
    expect(second.drawBatches[0].dirtyRanges).toEqual([]);
    expect(second.lights).toBe(first.lights);
    expect(second.interaction).toBe(first.interaction);
    expect(second.drawBatchesChanged).toBe(false);
    expect(second.lightsChanged).toBe(false);
    expect(second.interactionChanged).toBe(false);
  });

  it('re-packs instances when a referenced material uniform changes', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const material = createElement('standardMaterial');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const cache = createTypeGpuSceneCache();

    setAttribute(material, 'id', 'paint');
    setAttribute(material, 'transparent', true);
    setAttribute(mesh, 'material', 'paint');
    insert(mesh, geometry, null);
    insert(scene, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const first = createSceneState(root, cache, { dirty: Dirty.All });
    setAttribute(material, 'color', [0.2, 0.3, 0.4, 0.5]);
    setAttribute(material, 'roughness', 0.25);
    setAttribute(material, 'opacity', 0.5);
    const second = createSceneState(root, cache, { dirty: Dirty.MaterialUniform });

    expect(second.drawBatches[0].instances).toBe(first.drawBatches[0].instances);
    expect(second.drawBatches[0].instancesChanged).toBe(true);
    expect(second.drawBatches[0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);
    expect(second.drawBatches[0].instances[4]).toBeCloseTo(0.2);
    expect(second.drawBatches[0].instances[5]).toBeCloseTo(0.3);
    expect(second.drawBatches[0].instances[6]).toBeCloseTo(0.4);
    expect(second.drawBatches[0].instances[7]).toBeCloseTo(0.5);
    expect(second.drawBatches[0].instances[16]).toBeCloseTo(0.25);
    expect(second.drawBatches[0].instances[18]).toBeCloseTo(0.5);
  });

  it('preserves loaded model textures when material children override only color', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const model = createElement('model');
    const material = createElement('standardMaterial');
    const loaded: TypeGpuLoadedModel = {
      key: 'url:/models/textured.glb',
      meshes: [
        {
          geometry: {
            key: 'url:/models/textured.glb:primitive:0',
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8,
            bounds: { min: [0, 0, 0], max: [1, 1, 1] }
          },
          material: {
            kind: 'standard',
            color: [1, 1, 1, 1],
            roughness: 0.6,
            metalness: 0.1,
            opacity: 1,
            textureKey: 'url:/textures/albedo.png',
            samplerKey: 'sampler:default',
            map: { kind: 'url', key: 'url:/textures/albedo.png', src: '/textures/albedo.png' }
          },
          transform: {
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1]
          }
        }
      ]
    };
    const cache = createTypeGpuSceneCache({
      modelCache: createModelCache({
        loadUrl: async () => loaded,
        loadData: async () => loaded
      })
    });

    setAttribute(model, 'src', '/models/textured.glb');
    setAttribute(material, 'color', [0.2, 0.3, 0.4, 1]);
    insert(model, material, null);
    insert(scene, model, null);
    insert(root, scene, null);

    createSceneState(root, cache, { dirty: Dirty.All });
    await Promise.resolve();
    const state = createSceneState(root, cache, { dirty: Dirty.All });

    expect(state.drawBatches[0].material).toMatchObject({
      color: [0.2, 0.3, 0.4, 1],
      roughness: 0.6,
      metalness: 0.1,
      textureKey: 'url:/textures/albedo.png',
      map: { kind: 'url', src: '/textures/albedo.png' }
    });
  });
});
