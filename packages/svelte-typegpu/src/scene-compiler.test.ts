import { describe, expect, it } from 'vitest';
import { addEventListener, createElement, createFragment, insert, setAttribute } from './core';
import { Dirty, hasDirty } from './dirty';
import type { TypeGpuLoadedModel } from './glb-loader';
import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
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

  it('uses scene activeCamera and background color aliases', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const first = createElement('perspectiveCamera');
    const second = createElement('orthographicCamera');

    setAttribute(scene, 'activeCamera', 'editor');
    setAttribute(scene, 'background', [0.1, 0.2, 0.3, 0.4]);
    setAttribute(first, 'id', 'main');
    setAttribute(first, 'active', true);
    setAttribute(first, 'position', [1, 0, 0]);
    setAttribute(second, 'id', 'editor');
    setAttribute(second, 'position', [2, 0, 0]);
    setAttribute(second, 'zoom', 4);

    insert(scene, first, null);
    insert(scene, second, null);
    insert(root, scene, null);

    const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

    expect(state.renderSettings.clearColor).toEqual([0.1, 0.2, 0.3, 0.4]);
    expect(state.cameraNode).toBe(second);
    expect(state.camera).toEqual({
      projection: 'orthographic',
      position: [2, 0, 0],
      target: [0, 0, 0],
      zoom: 4,
      near: 0.1,
      far: 100
    });
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

  it('packs transform scale without multiplying authored geometry dimensions again', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const boxMesh = createElement('mesh');
    const boxGeometry = createElement('boxGeometry');
    const bufferMesh = createElement('mesh');
    const bufferGeometry = createElement('bufferGeometry');

    setAttribute(boxMesh, 'scale', [3, 5, 7]);
    setAttribute(boxGeometry, 'width', 2);
    setAttribute(boxGeometry, 'height', 4);
    setAttribute(boxGeometry, 'depth', 6);
    setAttribute(bufferMesh, 'scale', [2, 3, 4]);
    setAttribute(bufferGeometry, 'layoutKey', MESH_VERTEX_LAYOUT_KEY);
    setAttribute(
      bufferGeometry,
      'vertices',
      new Float32Array([
        0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1,
        4, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1,
        0, 5, 6, 0, 1, 0, 0, 1, 1, 1, 1, 1
      ])
    );
    setAttribute(bufferGeometry, 'bounds', { min: [0, 0, 0], max: [4, 5, 6] });

    insert(boxMesh, boxGeometry, null);
    insert(bufferMesh, bufferGeometry, null);
    insert(scene, boxMesh, null);
    insert(scene, bufferMesh, null);
    insert(root, scene, null);

    const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });
    const boxBatch = state.drawBatches.find((batch) => batch.geometryKey === 'box:2:4:6');
    const bufferBatch = state.drawBatches.find((batch) => batch.geometry.kind === 'buffer');

    expect(Array.from(boxBatch?.instances.slice(8, 11) ?? [])).toEqual([3, 5, 7]);
    expect(Array.from(bufferBatch?.instances.slice(8, 11) ?? [])).toEqual([2, 3, 4]);
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

  it('compiles instancedMesh array data into one draw batch', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const resources = createElement('resources');
    const geometry = createElement('boxGeometry');
    const material = createElement('phongMaterial');
    const instanced = createElement('instancedMesh');
    const instances = [
      { id: 'a', position: [0, 0, 0] as const, color: [1, 0, 0, 1] as const },
      { id: 'b', position: [2, 0, 0] as const, color: [0, 1, 0, 1] as const }
    ];

    setAttribute(geometry, 'id', 'cube');
    setAttribute(material, 'id', 'mat');
    setAttribute(instanced, 'geometry', 'cube');
    setAttribute(instanced, 'material', 'mat');
    setAttribute(instanced, 'position', [1, 0, 0]);
    setAttribute(instanced, 'instances', instances);
    setAttribute(instanced, 'getKey', (item: (typeof instances)[number]) => item.id);
    setAttribute(instanced, 'getTransform', (item: (typeof instances)[number]) => ({
      position: item.position
    }));
    setAttribute(instanced, 'getColor', (item: (typeof instances)[number]) => item.color);
    setAttribute(
      instanced,
      'getSpinSpeed',
      (_item: (typeof instances)[number], index: number) => index + 1
    );

    insert(resources, geometry, null);
    insert(resources, material, null);
    insert(scene, resources, null);
    insert(scene, instanced, null);
    insert(root, scene, null);

    const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

    expect(state.drawBatches).toHaveLength(1);
    expect(state.drawBatches[0].geometryKey).toBe('box:1:1:1');
    expect(state.drawBatches[0].instanceCount).toBe(2);
    expect(state.drawBatches[0].instanceIds).toEqual(['a', 'b']);
    expect(Array.from(state.drawBatches[0].instances.slice(0, 12))).toEqual([
      1, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1, 1
    ]);
    expect(Array.from(state.drawBatches[0].instances.slice(20, 32))).toEqual([
      3, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 2
    ]);
  });

  it('re-packs instancedMesh dirty ranges when callback-derived values change', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const geometry = createElement('boxGeometry');
    const instanced = createElement('instancedMesh');
    const cache = createTypeGpuSceneCache();
    const instances = [
      { id: 'a', position: [0, 0, 0] as [number, number, number] },
      { id: 'b', position: [2, 0, 0] as [number, number, number] }
    ];

    setAttribute(instanced, 'instances', instances);
    setAttribute(instanced, 'getKey', (item: (typeof instances)[number]) => item.id);
    setAttribute(instanced, 'getTransform', (item: (typeof instances)[number]) => ({
      position: item.position
    }));

    insert(instanced, geometry, null);
    insert(scene, instanced, null);
    insert(root, scene, null);

    const first = createSceneState(root, cache, { dirty: Dirty.All });
    instances[1].position = [4, 0, 0];
    const second = createSceneState(root, cache, { dirty: Dirty.InstanceData });

    expect(second.drawBatches[0].instances).toBe(first.drawBatches[0].instances);
    expect(second.drawBatches[0].instancesChanged).toBe(true);
    expect(second.drawBatches[0].dirtyRanges).toEqual([{ start: 1, count: 1 }]);
    expect(second.drawBatches[0].instances[20]).toBe(4);
  });

  it('re-packs instancedMesh dirty ranges for tiny callback-derived position changes', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const geometry = createElement('boxGeometry');
    const instanced = createElement('instancedMesh');
    const cache = createTypeGpuSceneCache();
    const instances = [{ id: 'a', position: [0, 0, 0] as [number, number, number] }];

    setAttribute(instanced, 'instances', instances);
    setAttribute(instanced, 'getKey', (item: (typeof instances)[number]) => item.id);
    setAttribute(instanced, 'getTransform', (item: (typeof instances)[number]) => ({
      position: item.position
    }));

    insert(instanced, geometry, null);
    insert(scene, instanced, null);
    insert(root, scene, null);

    const first = createSceneState(root, cache, { dirty: Dirty.All });
    instances[0].position = [0.000004, 0, 0];
    const second = createSceneState(root, cache, { dirty: Dirty.InstanceData });

    expect(second.drawBatches[0].instances).toBe(first.drawBatches[0].instances);
    expect(second.drawBatches[0].instancesChanged).toBe(true);
    expect(second.drawBatches[0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);
    expect(second.drawBatches[0].instances[0]).toBeCloseTo(0.000004);
  });

  it('compiles ready model cache entries into imported draw batches', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const model = createElement('model');
    const loaded: TypeGpuLoadedModel = {
      key: 'url:/models/column.glb',
      meshes: [
        {
          geometry: {
            key: 'url:/models/column.glb:primitive:0',
            kind: 'imported',
            vertexData: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]),
            vertexCount: 1,
            vertexFloats: MESH_VERTEX_FLOATS,
            bounds: { min: [0, 0, 0], max: [1, 1, 0] },
            topology: 'triangle-list',
            layoutKey: MESH_VERTEX_LAYOUT_KEY
          },
          material: {
            kind: 'phong',
            color: [1, 1, 1, 1],
            roughness: 0.5,
            metalness: 0,
            opacity: 1,
            map: null
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

    setAttribute(model, 'src', '/models/column.glb');
    setAttribute(model, 'position', [3, 4, 5]);
    insert(scene, model, null);
    insert(root, scene, null);

    createSceneState(root, cache, { dirty: Dirty.All });
    await Promise.resolve();
    const state = createSceneState(root, cache, { dirty: Dirty.All });

    expect(state.drawBatches).toHaveLength(1);
    expect(state.drawBatches[0].geometryKey).toBe('url:/models/column.glb:primitive:0');
    expect(state.drawBatches[0].geometry.kind).toBe('imported');
    expect(state.drawBatches[0].instanceCount).toBe(1);
    expect(Array.from(state.drawBatches[0].instances.slice(0, 3))).toEqual([3, 4, 5]);
  });

  it('uses basic material kind when a basicMaterial child overrides a loaded model material', async () => {
    const { state } = await compileLoadedModelWithMaterialChild('basicMaterial');

    expect(state.drawBatches[0].material.kind).toBe('basic');
    expect(state.drawBatches[0].pipelineKey).toContain('material:basic');
    expect(state.drawBatches[0].materialKey).toContain('material:basic');
  });

  it('uses phong material kind when a phongMaterial child overrides a loaded model material', async () => {
    const { state } = await compileLoadedModelWithMaterialChild('phongMaterial');

    expect(state.drawBatches[0].material.kind).toBe('phong');
    expect(state.drawBatches[0].pipelineKey).toContain('material:phong');
    expect(state.drawBatches[0].materialKey).toContain('material:phong');
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
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1]),
            vertexCount: 1,
            vertexFloats: MESH_VERTEX_FLOATS,
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

async function compileLoadedModelWithMaterialChild(materialName: string) {
  const root = createFragment();
  const scene = createElement('scene');
  const model = createElement('model');
  const material = createElement(materialName);
  const loaded = loadedModelFixture(`url:/models/${materialName}.glb`);
  const cache = createTypeGpuSceneCache({
    modelCache: createModelCache({
      loadUrl: async () => loaded,
      loadData: async () => loaded
    })
  });

  setAttribute(model, 'src', `/models/${materialName}.glb`);
  setAttribute(material, 'color', [0.2, 0.3, 0.4, 1]);
  insert(model, material, null);
  insert(scene, model, null);
  insert(root, scene, null);

  createSceneState(root, cache, { dirty: Dirty.All });
  await Promise.resolve();

  return {
    state: createSceneState(root, cache, { dirty: Dirty.All })
  };
}

function loadedModelFixture(key: string): TypeGpuLoadedModel {
  return {
    key,
    meshes: [
      {
        geometry: {
          key: `${key}:primitive:0`,
          kind: 'imported',
          vertexData: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 1]),
          vertexCount: 1,
          vertexFloats: MESH_VERTEX_FLOATS,
          bounds: { min: [0, 0, 0], max: [1, 1, 1] },
          topology: 'triangle-list',
          layoutKey: MESH_VERTEX_LAYOUT_KEY
        },
        material: {
          kind: 'standard',
          color: [1, 1, 1, 1],
          roughness: 0.6,
          metalness: 0.1,
          opacity: 1,
          map: null
        },
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      }
    ]
  };
}
