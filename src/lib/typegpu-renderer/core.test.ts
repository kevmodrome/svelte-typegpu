import { describe, expect, it, vi } from 'vitest';
import { MESH_INSTANCE_FLOATS } from './instance-data';
import {
  addEventListener,
  createElement,
  createFragment,
  dispatchNodeEvent,
  getNextSibling,
  insert,
  remove,
  removeAttribute,
  removeEventListener,
  setAttribute
} from './core';
import { collectLights } from './components/lights';
import { collectMeshDrawItems, findFirstInteractiveMesh } from './components/mesh';
import { readMeshMaterial } from './components/material';
import {
  readPerspectiveCamera,
  readPerspectiveCameraState
} from './components/perspective-camera';
import type { TypeGpuLoadedModel } from './glb-loader';
import { createStandardMaterial } from './materials';
import { createModelCache } from './model-cache';
import { createSceneState, createTypeGpuSceneCache } from './scene-state';
import { MAX_TYPEGPU_LIGHTS } from './types';
import { Dirty, hasDirty } from './dirty';

function readyModelCache(model: TypeGpuLoadedModel) {
  return createModelCache({
    loadUrl: async () => model,
    loadData: async () => model,
    onSettled: () => {}
  });
}

describe('TypeGPU renderer core', () => {
  it('turns authored mesh nodes into geometry/material draw batches', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const first = createElement('mesh');
    const firstGeometry = createElement('boxGeometry');
    const firstMaterial = createElement('standardMaterial');
    const second = createElement('mesh');
    const secondGeometry = createElement('boxGeometry');
    const secondMaterial = createElement('standardMaterial');
    const sphere = createElement('mesh');
    const sphereGeometry = createElement('sphereGeometry');
    const sphereMaterial = createElement('standardMaterial');

    const pose = createElement('cameraPose');
    const lens = createElement('cameraLens');

    setAttribute(pose, 'position', [0, 2, 8]);
    setAttribute(pose, 'target', [0, 0, 0]);
    setAttribute(lens, 'fov', 50);
    setAttribute(first, 'position', [1, 2, 3]);
    setAttribute(first, 'phase', 0.25);
    setAttribute(first, 'spinSpeed', 1.4);
    setAttribute(firstGeometry, 'width', 20);
    setAttribute(firstGeometry, 'height', 5);
    setAttribute(firstGeometry, 'depth', 10);
    setAttribute(firstMaterial, 'color', [0.1, 0.2, 0.3, 1]);
    setAttribute(firstMaterial, 'roughness', 0.7);
    setAttribute(firstMaterial, 'metalness', 0.2);
    setAttribute(second, 'position', [-1, -2, -3]);
    setAttribute(second, 'phase', 0.5);
    setAttribute(secondMaterial, 'color', [0.4, 0.5, 0.6, 1]);
    setAttribute(sphere, 'position', [7, 8, 9]);
    setAttribute(sphere, 'phase', 0.75);
    setAttribute(sphereMaterial, 'color', [0.7, 0.8, 0.9, 1]);

    insert(camera, pose, null);
    insert(camera, lens, null);
    insert(scene, camera, null);
    insert(first, firstGeometry, null);
    insert(first, firstMaterial, null);
    insert(scene, first, null);
    insert(second, secondGeometry, null);
    insert(second, secondMaterial, null);
    insert(scene, second, null);
    insert(sphere, sphereGeometry, null);
    insert(sphere, sphereMaterial, null);
    insert(scene, sphere, null);
    insert(root, scene, null);

    const state = createSceneState(root);
    const largeBoxBatch = drawBatchByGeometry(state, 'box:20:5:10');
    const boxBatch = drawBatchByGeometry(state, 'box:1:1:1');
    const sphereBatch = drawBatch(state, 'mesh:sphere:standard:solid:white');

    expect(state).toMatchObject({
      camera: {
        position: [0, 2, 8],
        target: [0, 0, 0],
        fov: 50,
        near: 0.1,
        far: 100
      }
    });

    expect(largeBoxBatch.geometry.key).toBe('box:20:5:10');
    expect(largeBoxBatch.instanceCount).toBe(1);
    expect(largeBoxBatch.instanceIds).toEqual([first.uid]);
    expect(Array.from(largeBoxBatch.instances.slice(0, 4))).toEqual([1, 2, 3, 0.25]);
    expect(largeBoxBatch.instances[4]).toBeCloseTo(0.1);
    expect(largeBoxBatch.instances[5]).toBeCloseTo(0.2);
    expect(largeBoxBatch.instances[6]).toBeCloseTo(0.3);
    expect(largeBoxBatch.instances[7]).toBe(1);
    expect(Array.from(largeBoxBatch.instances.slice(8, 11))).toEqual([1, 1, 1]);
    expect(largeBoxBatch.instances[11]).toBeCloseTo(1.4);
    expect(largeBoxBatch.instances[12]).toBe(0);
    expect(Array.from(largeBoxBatch.instances.slice(13, 16))).toEqual([0, 0, 0]);
    expect(largeBoxBatch.instances[16]).toBeCloseTo(0.7);
    expect(largeBoxBatch.instances[17]).toBeCloseTo(0.2);
    expect(largeBoxBatch.instances[18]).toBeCloseTo(1);
    expect(largeBoxBatch.instances[19]).toBeCloseTo(0);
    expect(boxBatch.geometry.key).toBe('box:1:1:1');
    expect(boxBatch.instanceCount).toBe(1);
    expect(boxBatch.instanceIds).toEqual([second.uid]);
    expect(Array.from(boxBatch.instances.slice(0, 4))).toEqual([-1, -2, -3, 0.5]);
    expect(boxBatch.instances[4]).toBeCloseTo(0.4);
    expect(boxBatch.instances[5]).toBeCloseTo(0.5);
    expect(boxBatch.instances[6]).toBeCloseTo(0.6);
    expect(boxBatch.instances[7]).toBe(1);
    expect(Array.from(boxBatch.instances.slice(8, 11))).toEqual([1, 1, 1]);

    expect(sphereBatch.geometry.key).toBe('sphere:0.5:16:8');
    expect(sphereBatch.instanceCount).toBe(1);
    expect(sphereBatch.instanceIds).toEqual([sphere.uid]);
    expect(Array.from(sphereBatch.instances.slice(0, 4))).toEqual([7, 8, 9, 0.75]);
    expect(sphereBatch.instances[4]).toBeCloseTo(0.7);
    expect(sphereBatch.instances[5]).toBeCloseTo(0.8);
    expect(sphereBatch.instances[6]).toBeCloseTo(0.9);
    expect(sphereBatch.instances[7]).toBe(1);
  });

  it('reads camera settings from declarative camera children', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const pose = createElement('cameraPose');
    const lens = createElement('cameraLens');

    setAttribute(pose, 'position', [2, 3, 4]);
    setAttribute(pose, 'target', [1, 1, 1]);
    setAttribute(lens, 'fov', 35);
    setAttribute(lens, 'near', 0.5);
    setAttribute(lens, 'far', 250);
    insert(camera, pose, null);
    insert(camera, lens, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readPerspectiveCamera(root)).toEqual({
      position: [2, 3, 4],
      target: [1, 1, 1],
      fov: 35,
      near: 0.5,
      far: 250
    });
  });

  it('reads camera pose, lens, pointer, and keyboard controls from declarative camera children', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const pose = createElement('cameraPose');
    const lens = createElement('cameraLens');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const keyboard = createElement('keyboardControls');

    setAttribute(pose, 'position', [0, 1.4, 5]);
    setAttribute(pose, 'target', [0, 0, 0]);
    setAttribute(lens, 'fov', 42);
    setAttribute(lens, 'near', 0.25);
    setAttribute(lens, 'far', 400);
    setAttribute(controls, 'mode', 'fly');
    setAttribute(controls, 'minDistance', 2);
    setAttribute(controls, 'maxDistance', 40);
    setAttribute(controls, 'invert', true);
    setAttribute(pointer, 'dragButton', 'primary');
    setAttribute(pointer, 'rotateSpeed', 1.5);
    setAttribute(pointer, 'wheel', 'zoom');
    setAttribute(pointer, 'zoomSpeed', 0.75);
    setAttribute(pointer, 'touch', 'orbit-pinch');
    setAttribute(keyboard, 'rotateLeft', 'KeyA');
    setAttribute(keyboard, 'rotateRight', 'KeyD');
    setAttribute(keyboard, 'rotateUp', 'KeyW');
    setAttribute(keyboard, 'rotateDown', 'KeyS');
    setAttribute(keyboard, 'zoomIn', 'Equal');
    setAttribute(keyboard, 'zoomOut', 'Minus');
    setAttribute(keyboard, 'moveForward', 'KeyI');
    setAttribute(keyboard, 'moveBackward', 'KeyK');
    setAttribute(keyboard, 'moveLeft', 'KeyJ');
    setAttribute(keyboard, 'moveRight', 'KeyL');
    setAttribute(keyboard, 'moveUp', 'Space');
    setAttribute(keyboard, 'moveDown', 'KeyM');
    setAttribute(keyboard, 'step', 0.12);
    setAttribute(keyboard, 'moveStep', 0.6);
    setAttribute(keyboard, 'smooth', true);

    insert(controls, pointer, null);
    insert(controls, keyboard, null);
    insert(camera, pose, null);
    insert(camera, lens, null);
    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    const state = readPerspectiveCameraState(root);
    const sceneState = createSceneState(root);

    expect(state.node).toBe(camera);
    expect(state.settings).toMatchObject({
      position: [0, 1.4, 5],
      target: [0, 0, 0],
      fov: 42,
      near: 0.25,
      far: 400
    });
    expect(state.controller).toEqual({
      kind: 'controls',
      mode: 'fly',
      minDistance: 2,
      maxDistance: 40,
      invert: true,
      pointer: {
        dragButton: 'primary',
        rotateSpeed: 1.5,
        wheel: 'zoom',
        zoomSpeed: 0.75,
        touch: 'orbit-pinch'
      },
      keyboard: {
        rotateLeft: 'KeyA',
        rotateRight: 'KeyD',
        rotateUp: 'KeyW',
        rotateDown: 'KeyS',
        zoomIn: 'Equal',
        zoomOut: 'Minus',
        moveForward: 'KeyI',
        moveBackward: 'KeyK',
        moveLeft: 'KeyJ',
        moveRight: 'KeyL',
        moveUp: 'Space',
        moveDown: 'KeyM',
        step: 0.12,
        moveStep: 0.6,
        smooth: true
      }
    });
    expect(sceneState.cameraNode).toBe(camera);
    expect(state.controllerNode).toBe(controls);
    expect(sceneState.cameraControllerNode).toBe(controls);
    expect(sceneState.cameraController).toEqual(state.controller);
  });

  it('uses direct orthographic camera state for runtime scene state', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('orthographicCamera');

    setAttribute(camera, 'position', [3, 4, 5]);
    setAttribute(camera, 'target', [0, 1, 0]);
    setAttribute(camera, 'zoom', 2.5);
    setAttribute(camera, 'near', 0.2);
    setAttribute(camera, 'far', 300);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(createSceneState(root).camera).toEqual({
      projection: 'orthographic',
      position: [3, 4, 5],
      target: [0, 1, 0],
      zoom: 2.5,
      near: 0.2,
      far: 300
    });
  });

  it('preserves direct orbit controls in runtime scene state', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('orbitControls');

    setAttribute(controls, 'camera', 'main');
    setAttribute(controls, 'target', [1, 2, 3]);
    setAttribute(controls, 'minDistance', 4);
    setAttribute(controls, 'maxDistance', 20);
    setAttribute(controls, 'enablePan', false);
    setAttribute(controls, 'enableZoom', true);
    setAttribute(controls, 'enableRotate', false);
    setAttribute(controls, 'rotateSpeed', 1.5);
    setAttribute(controls, 'zoomSpeed', 0.75);
    insert(scene, camera, null);
    insert(scene, controls, null);
    insert(root, scene, null);

    expect(createSceneState(root).cameraController).toEqual({
      kind: 'orbit',
      camera: 'main',
      enabled: true,
      target: [1, 2, 3],
      minDistance: 4,
      maxDistance: 20,
      enablePan: false,
      enableZoom: true,
      enableRotate: false,
      rotateSpeed: 1.5,
      zoomSpeed: 0.75
    });
  });

  it('falls back and clamps invalid camera-control options', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const keyboard = createElement('keyboardControls');

    setAttribute(controls, 'mode', 'walk');
    setAttribute(controls, 'minDistance', 50);
    setAttribute(controls, 'maxDistance', 10);
    setAttribute(pointer, 'dragButton', 'auxiliary');
    setAttribute(pointer, 'rotateSpeed', -1);
    setAttribute(pointer, 'wheel', 'pan');
    setAttribute(pointer, 'zoomSpeed', -2);
    setAttribute(pointer, 'touch', 'swipe');
    setAttribute(keyboard, 'rotateLeft', '');
    setAttribute(keyboard, 'rotateRight', '');
    setAttribute(keyboard, 'rotateUp', '');
    setAttribute(keyboard, 'rotateDown', '');
    setAttribute(keyboard, 'zoomIn', '');
    setAttribute(keyboard, 'zoomOut', '');
    setAttribute(keyboard, 'moveForward', '');
    setAttribute(keyboard, 'moveBackward', '');
    setAttribute(keyboard, 'moveLeft', '');
    setAttribute(keyboard, 'moveRight', '');
    setAttribute(keyboard, 'moveUp', '');
    setAttribute(keyboard, 'moveDown', '');
    setAttribute(keyboard, 'step', -0.5);
    setAttribute(keyboard, 'moveStep', -1);

    insert(controls, pointer, null);
    insert(controls, keyboard, null);
    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readPerspectiveCameraState(root).controller).toEqual({
      kind: 'controls',
      mode: 'orbit',
      minDistance: 1,
      maxDistance: 100,
      invert: false,
      pointer: {
        dragButton: 'primary',
        rotateSpeed: 0,
        wheel: 'zoom',
        zoomSpeed: 0,
        touch: 'orbit-pinch'
      },
      keyboard: {
        rotateLeft: 'ArrowLeft',
        rotateRight: 'ArrowRight',
        rotateUp: 'ArrowUp',
        rotateDown: 'ArrowDown',
        zoomIn: '+',
        zoomOut: '-',
        moveForward: 'KeyW',
        moveBackward: 'KeyS',
        moveLeft: 'KeyA',
        moveRight: 'KeyD',
        moveUp: 'Space',
        moveDown: 'KeyC',
        step: 0,
        moveStep: 0,
        smooth: false
      }
    });
  });

  it('keeps controls inert until it has supported input children', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');

    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readPerspectiveCameraState(root).controller).toBeNull();
  });

  it('ignores camera-control nodes outside the camera hierarchy', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');

    insert(controls, pointer, null);
    insert(scene, camera, null);
    insert(scene, controls, null);
    insert(root, scene, null);

    expect(readPerspectiveCameraState(root).controller).toBeNull();
  });

  it('ignores pointerControls directly under a perspectiveCamera node', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const pointer = createElement('pointerControls');

    insert(camera, pointer, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readPerspectiveCameraState(root).controller).toBeNull();
  });

  it('normalizes standard material texture props from inline attributes', () => {
    const mesh = createElement('mesh');
    const material = createElement('standardMaterial');

    setAttribute(material, 'color', [0.2, 0.3, 0.4, 0.8]);
    setAttribute(material, 'roughness', 0.7);
    setAttribute(material, 'metalness', 0.25);
    setAttribute(material, 'opacity', 0.6);
    setAttribute(material, 'map', '/textures/crate.png');
    insert(mesh, material, null);

    expect(readMeshMaterial(mesh)).toEqual({
      kind: 'standard',
      color: [0.2, 0.3, 0.4, 0.8],
      roughness: 0.7,
      metalness: 0.25,
      opacity: 0.6,
      map: { kind: 'url', src: '/textures/crate.png' }
    });
  });

  it('normalizes reusable standard material objects and lets inline props override them', () => {
    const mesh = createElement('mesh');
    const material = createElement('standardMaterial');
    const reusable = createStandardMaterial({
      color: [0.9, 0.8, 0.7, 1],
      roughness: 0.2,
      metalness: 0.35,
      opacity: 0.9,
      map: '/textures/base.png'
    });

    setAttribute(material, 'material', reusable);
    setAttribute(material, 'roughness', 0.65);
    setAttribute(material, 'map', '/textures/override.png');
    insert(mesh, material, null);

    expect(readMeshMaterial(mesh)).toEqual({
      kind: 'standard',
      color: [0.9, 0.8, 0.7, 1],
      roughness: 0.65,
      metalness: 0.35,
      opacity: 0.9,
      map: { kind: 'url', src: '/textures/override.png' }
    });
  });

  it('splits draw batches by texture identity while preserving same-texture batching', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const first = createTexturedBox('/textures/a.png');
    const second = createTexturedBox('/textures/a.png');
    const third = createTexturedBox('/textures/b.png');

    insert(scene, first, null);
    insert(scene, second, null);
    insert(scene, third, null);
    insert(root, scene, null);

    const state = createSceneState(root);
    const firstBatch = drawBatch(state, 'mesh:box:standard:url:/textures/a.png');
    const secondBatch = drawBatch(state, 'mesh:box:standard:url:/textures/b.png');

    expect(firstBatch.instanceCount).toBe(2);
    expect(secondBatch.instanceCount).toBe(1);
    expect(firstBatch.material.map).toMatchObject({ kind: 'url', src: '/textures/a.png' });
    expect(secondBatch.material.map).toMatchObject({ kind: 'url', src: '/textures/b.png' });
  });

  it('drops cached draw batch state after a texture key leaves the scene', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    setAttribute(material, 'map', '/textures/a.png');
    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const firstBatch = drawBatch(firstState, 'mesh:box:standard:url:/textures/a.png');

    setAttribute(material, 'map', '/textures/b.png');
    createSceneState(root, cache);

    setAttribute(material, 'map', '/textures/a.png');
    const thirdState = createSceneState(root, cache);
    const thirdBatch = drawBatch(thirdState, 'mesh:box:standard:url:/textures/a.png');

    expect(thirdBatch.instances).not.toBe(firstBatch.instances);
    expect(thirdBatch.instancesChanged).toBe(true);
  });

  it('renders ready model cache entries as imported draw batches', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const modelNode = createElement('model');
    const model: TypeGpuLoadedModel = {
      key: 'url:/models/triangle.glb',
      meshes: [
        {
          geometry: {
            key: 'url:/models/triangle.glb:primitive:0',
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8
          },
          material: {
            kind: 'standard',
            color: [0.2, 0.3, 0.4, 1],
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
    const cache = createTypeGpuSceneCache({
      modelCache: readyModelCache(model)
    });

    setAttribute(modelNode, 'src', '/models/triangle.glb');
    setAttribute(modelNode, 'position', [3, 4, 5]);
    insert(scene, modelNode, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    await Promise.resolve();
    const state = createSceneState(root, cache);
    const batch = drawBatch(
      state,
      'mesh:imported:url:/models/triangle.glb:primitive:0:standard:solid:white'
    );

    expect(batch.geometry.key).toBe('url:/models/triangle.glb:primitive:0');
    expect(batch.instanceCount).toBe(1);
    expect(Array.from(batch.instances.slice(0, 4))).toEqual([3, 4, 5, 0]);
  });

  it('overrides imported model materials from a standard material child', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const modelNode = createElement('model');
    const material = createElement('standardMaterial');
    const model: TypeGpuLoadedModel = {
      key: 'url:/models/painted.glb',
      meshes: [
        {
          geometry: {
            key: 'url:/models/painted.glb:primitive:0',
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8
          },
          material: {
            kind: 'standard',
            color: [0.2, 0.3, 0.4, 1],
            roughness: 0.67,
            metalness: 0.12,
            opacity: 0.9,
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
      modelCache: readyModelCache(model)
    });

    setAttribute(modelNode, 'src', '/models/painted.glb');
    setAttribute(material, 'color', [1, 0.2, 0.1, 1]);
    insert(modelNode, material, null);
    insert(scene, modelNode, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    await Promise.resolve();
    const state = createSceneState(root, cache);
    const batch = drawBatch(
      state,
      'mesh:imported:url:/models/painted.glb:primitive:0:standard:solid:white'
    );

    expect(batch.material).toMatchObject({
      color: [1, 0.2, 0.1, 1],
      roughness: 0.67,
      metalness: 0.12,
      opacity: 0.9
    });
  });

  it('keeps imported geometry keys separate from procedural geometry keys', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const modelNode = createElement('model');
    const model: TypeGpuLoadedModel = {
      key: 'url:/models/box-key.glb',
      meshes: [
        {
          geometry: {
            key: 'box',
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8
          },
          material: {
            kind: 'standard',
            color: [0.8, 0.2, 0.1, 1],
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
      modelCache: readyModelCache(model)
    });

    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(modelNode, 'src', '/models/box-key.glb');
    setAttribute(modelNode, 'position', [4, 5, 6]);
    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(scene, modelNode, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    await Promise.resolve();
    const state = createSceneState(root, cache);
    const proceduralBatch = drawBatch(state, 'mesh:box:standard:solid:white');
    const importedBatch = drawBatch(state, 'mesh:imported:box:standard:solid:white');

    expect(proceduralBatch.geometry.key).toBe('box:1:1:1');
    expect(importedBatch.geometry.key).toBe('box');
    expect(proceduralBatch.instanceCount).toBe(1);
    expect(importedBatch.instanceCount).toBe(1);
    expect(proceduralBatch.instances).not.toBe(importedBatch.instances);
    expect(Array.from(proceduralBatch.instances.slice(0, 4))).toEqual([1, 2, 3, 0]);
    expect(Array.from(importedBatch.instances.slice(0, 4))).toEqual([4, 5, 6, 0]);
  });

  it('uses stable string instance ids for imported model primitives', async () => {
    const root = createFragment();
    const scene = createElement('scene');
    const firstModelNode = createElement('model');
    const secondModelNode = createElement('model');
    const model: TypeGpuLoadedModel = {
      key: 'url:/models/multi.glb',
      meshes: [
        {
          geometry: {
            key: 'url:/models/multi.glb:primitive:0',
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8
          },
          material: {
            kind: 'standard',
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
        },
        {
          geometry: {
            key: 'url:/models/multi.glb:primitive:1',
            vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8
          },
          material: {
            kind: 'standard',
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
      modelCache: readyModelCache(model)
    });

    setAttribute(firstModelNode, 'src', '/models/multi.glb');
    setAttribute(secondModelNode, 'src', '/models/multi.glb');
    insert(scene, firstModelNode, null);
    insert(scene, secondModelNode, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    await Promise.resolve();
    const state = createSceneState(root, cache);
    const firstPrimitiveBatch = drawBatch(
      state,
      'mesh:imported:url:/models/multi.glb:primitive:0:standard:solid:white'
    );
    const secondPrimitiveBatch = drawBatch(
      state,
      'mesh:imported:url:/models/multi.glb:primitive:1:standard:solid:white'
    );

    expect(firstPrimitiveBatch.instanceIds).toEqual([
      `model:${firstModelNode.uid}:primitive:0`,
      `model:${secondModelNode.uid}:primitive:0`
    ]);
    expect(secondPrimitiveBatch.instanceIds).toEqual([
      `model:${firstModelNode.uid}:primitive:1`,
      `model:${secondModelNode.uid}:primitive:1`
    ]);
  });

  it('stores and dispatches element events', () => {
    const box = createElement('box');
    const handler = vi.fn();

    addEventListener(box, 'click', handler);
    dispatchNodeEvent(box, 'click', { detail: { selected: true } });

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'click',
        target: box,
        currentTarget: box,
        detail: { selected: true }
      })
    );
  });

  it('returns child snapshots without letting snapshot mutation corrupt sibling operations', () => {
    const scene = createElement('scene');
    const first = createElement('box');
    const second = createElement('box');
    const insertedBeforeSecond = createElement('box');

    insert(scene, first, null);
    insert(scene, second, null);

    const snapshot = scene.children;
    snapshot.length = 0;

    expect(getNextSibling(first)).toBe(second);

    insert(scene, insertedBeforeSecond, second);
    remove(first);

    expect(scene.children).toEqual([insertedBeforeSecond, second]);
    expect(getNextSibling(insertedBeforeSecond)).toBe(second);
  });

  it('reuses packed mesh data when only non-mesh attributes change', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    setAttribute(camera, 'position', [0, 2, 8]);
    setAttribute(mesh, 'position', [1, 2, 3]);
    insert(scene, camera, null);
    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    setAttribute(camera, 'fov', 35);
    const secondState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'mesh:box:standard:solid:white');
    const secondBoxBatch = drawBatch(secondState, 'mesh:box:standard:solid:white');

    expect(firstBoxBatch.instancesChanged).toBe(true);
    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(false);
    expect(secondBoxBatch.dirtyRanges).toEqual([]);
  });

  it('keeps global scene settings out of mesh instance data', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    setAttribute(scene, 'scale', 1);
    setAttribute(scene, 'animationSpeed', 1);
    setAttribute(scene, 'colorShift', 0);
    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(geometry, 'width', 2);
    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'mesh:box:standard:solid:white');
    setAttribute(scene, 'scale', 1.5);
    setAttribute(scene, 'animationSpeed', 0.35);
    setAttribute(scene, 'colorShift', 47);
    const secondState = createSceneState(root, cache);
    const secondBoxBatch = drawBatch(secondState, 'mesh:box:standard:solid:white');

    expect(secondState.scale).toBe(1.5);
    expect(secondState.animationSpeed).toBe(0.35);
    expect(secondState.colorShift).toBe(47);
    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(false);
    expect(secondBoxBatch.dirtyRanges).toEqual([]);
  });

  it('can reuse cached draw batches for global scene-only updates', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const readDrawBatches = vi.spyOn(cache.drawBatchCache, 'read');

    setAttribute(scene, 'scale', 1.5);
    setAttribute(scene, 'animationSpeed', 0.35);
    setAttribute(scene, 'colorShift', 47);

    const secondState = createSceneState(root, cache, { reuseDrawBatches: true });

    expect(readDrawBatches).not.toHaveBeenCalled();
    expect(secondState.scale).toBe(1.5);
    expect(secondState.animationSpeed).toBe(0.35);
    expect(secondState.colorShift).toBe(47);
    expect(secondState.drawBatches).toHaveLength(firstState.drawBatches.length);
    expect(secondState.drawBatches[0].instances).toBe(firstState.drawBatches[0].instances);
    expect(secondState.drawBatches[0].instancesChanged).toBe(false);
    expect(secondState.drawBatches[0].dirtyRanges).toEqual([]);
  });

  it('includes lighting state and reuses it for scene-only updates', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const light = createElement('pointLight');

    setAttribute(light, 'position', [1, 2, 3]);
    insert(scene, light, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    setAttribute(scene, 'colorShift', 45);
    const secondState = createSceneState(root, cache, {
      reuseDrawBatches: true,
      reuseLights: true
    });

    expect(firstState.lightsChanged).toBe(true);
    expect(secondState.lights).toBe(firstState.lights);
    expect(secondState.lightsChanged).toBe(false);
  });

  it('propagates light attribute updates through scene state without repacking meshes', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const light = createElement('pointLight');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(light, 'intensity', 1);
    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(scene, light, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'mesh:box:standard:solid:white');
    setAttribute(light, 'intensity', 4);
    const secondState = createSceneState(root, cache, { reuseDrawBatches: true });
    const secondBoxBatch = drawBatch(secondState, 'mesh:box:standard:solid:white');

    expect(secondState.lightsChanged).toBe(true);
    expect(secondState.lights[0].intensity).toBe(4);
    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(false);
  });

  it('uses scheduled group transform masks for scene-state recompute decisions', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const lightGroup = createElement('group');
    const light = createElement('pointLight');
    const meshGroup = createElement('group');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const scheduleSync = vi.fn();

    setAttribute(light, 'position', [1, 0, 0]);
    insert(lightGroup, light, null);
    insert(mesh, geometry, null);
    insert(meshGroup, mesh, null);
    insert(scene, lightGroup, null);
    insert(scene, meshGroup, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    const readDrawBatches = vi.spyOn(cache.drawBatchCache, 'read');
    root.runtime = { scheduleSync };

    setAttribute(lightGroup, 'position', [3, 0, 0]);
    const [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
    const secondState = createSceneState(root, cache, { dirty: dirtyMask });

    expect(dirtyNode).toBe(lightGroup);
    expect(hasDirty(dirtyMask, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(false);
    expect(hasDirty(dirtyMask, Dirty.Lights)).toBe(true);
    expect(readDrawBatches).toHaveBeenCalledOnce();
    expect(secondState.lightsChanged).toBe(true);
    expect(secondState.lights[0].position).toEqual([4, 0, 0]);
    expect(secondState.drawBatches[0].instanceIds).toEqual([mesh.uid]);
    expect(secondState.drawBatches[0].instancesChanged).toBe(false);
  });

  it('schedules lighting masks for light changes and parent group transforms', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const light = createElement('pointLight');
    const mesh = createElement('mesh');
    const scheduleSync = vi.fn();

    insert(group, light, null);
    insert(scene, group, null);
    insert(scene, mesh, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    setAttribute(light, 'intensity', 2);
    let [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(light);
    expect(hasDirty(dirtyMask, Dirty.Lights)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(false);

    setAttribute(group, 'position', [1, 2, 3]);
    [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(group);
    expect(hasDirty(dirtyMask, Dirty.Lights)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.Transform)).toBe(true);
  });

  it('schedules draw-batch masks for model node insertions', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const modelNode = createElement('model');
    const scheduleSync = vi.fn();

    insert(root, scene, null);
    root.runtime = { scheduleSync };

    insert(scene, modelNode, null);

    const [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(modelNode);
    expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.Lights)).toBe(false);
  });

  it('keeps camera-control attribute changes out of draw-batch and light masks', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pose = createElement('cameraPose');
    const lens = createElement('cameraLens');
    const pointer = createElement('pointerControls');
    const scheduleSync = vi.fn();

    insert(controls, pointer, null);
    insert(camera, pose, null);
    insert(camera, lens, null);
    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    for (const [node, key, value] of [
      [camera, 'position', [1, 2, 3]],
      [pose, 'position', [1, 2, 3]],
      [lens, 'fov', 60],
      [controls, 'mode', 'fly'],
      [pointer, 'rotateSpeed', 2]
    ] as const) {
      setAttribute(node, key, value);
      const [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
      expect(dirtyNode).toBe(node);
      expect(hasDirty(dirtyMask, Dirty.Camera)).toBe(true);
      expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(false);
      expect(hasDirty(dirtyMask, Dirty.Lights)).toBe(false);
    }
  });

  it('keeps structural camera-control insertions out of draw-batch and light dirtiness', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const scheduleSync = vi.fn();

    insert(scene, camera, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    insert(controls, pointer, null);
    insert(camera, controls, null);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, controls, Dirty.Tree | Dirty.Camera);
  });

  it('keeps structural camera-control removals out of draw-batch and light dirtiness', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const pointer = createElement('pointerControls');
    const scheduleSync = vi.fn();

    insert(controls, pointer, null);
    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    remove(controls);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, controls, Dirty.Tree | Dirty.Camera);
  });

  it('marks draw batches dirty for structural mesh insertions', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const scheduleSync = vi.fn();

    insert(root, scene, null);
    root.runtime = { scheduleSync };

    insert(scene, mesh, null);

    expect(scheduleSync).toHaveBeenLastCalledWith(
      root,
      mesh,
      Dirty.Tree | Dirty.DrawBatches | Dirty.Interaction
    );
  });

  it('marks draw batches and lights dirty for structural scene subtree insertions', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const light = createElement('pointLight');
    const scheduleSync = vi.fn();

    insert(scene, mesh, null);
    insert(scene, light, null);
    root.runtime = { scheduleSync };

    insert(root, scene, null);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, scene, Dirty.All);
  });

  it('marks draw batches and lights dirty for structural scene subtree removals', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const light = createElement('pointLight');
    const scheduleSync = vi.fn();

    insert(scene, mesh, null);
    insert(scene, light, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    remove(scene);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, scene, Dirty.All);
  });

  it('marks draw batches dirty for malformed structural camera-control subtrees with meshes', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const mesh = createElement('mesh');
    const scheduleSync = vi.fn();

    insert(scene, camera, null);
    insert(root, scene, null);
    insert(controls, mesh, null);
    root.runtime = { scheduleSync };

    insert(camera, controls, null);

    expect(scheduleSync).toHaveBeenLastCalledWith(
      root,
      controls,
      Dirty.Tree | Dirty.Camera | Dirty.DrawBatches | Dirty.Interaction
    );
  });

  it('passes the invalidated node to runtime sync scheduling', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const scheduleSync = vi.fn();

    root.runtime = { scheduleSync };
    insert(scene, mesh, null);
    insert(root, scene, null);
    scheduleSync.mockClear();

    setAttribute(scene, 'scale', 1.5);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, scene, Dirty.RenderSettings);
  });

  it('passes updated light nodes to runtime sync scheduling', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const light = createElement('pointLight');
    const scheduleSync = vi.fn();

    root.runtime = { scheduleSync };
    insert(scene, light, null);
    insert(root, scene, null);
    scheduleSync.mockClear();

    setAttribute(light, 'position', [2, 3, 4]);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, light, Dirty.Lights);
  });

  it('schedules mesh attribute changes with descriptor dirty bits', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const scheduleSync = vi.fn();

    insert(scene, mesh, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    setAttribute(mesh, 'position', [1, 2, 3]);

    const [, dirtyNode, dirtyMask] = scheduleSync.mock.lastCall ?? [];

    expect(dirtyNode).toBe(mesh);
    expect(hasDirty(dirtyMask, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.InstanceData)).toBe(true);
  });

  it('schedules material attribute removal from the previous value', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const material = createElement('standardMaterial');
    const scheduleSync = vi.fn();

    setAttribute(material, 'map', '/textures/checker.png');
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    removeAttribute(material, 'map');

    const [, dirtyNode, dirtyMask] = scheduleSync.mock.lastCall ?? [];

    expect(dirtyNode).toBe(material);
    expect(hasDirty(dirtyMask, Dirty.Texture)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.BindGroup)).toBe(true);
  });

  it('schedules host tree and listener changes with descriptor dirty bits', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const light = createElement('pointLight');
    const scheduleSync = vi.fn();
    const onClick = vi.fn();

    insert(root, scene, null);
    root.runtime = { scheduleSync };

    insert(scene, mesh, null);
    let [, dirtyNode, dirtyMask] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(mesh);
    expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.Interaction)).toBe(true);

    insert(scene, light, null);
    remove(light);
    [, dirtyNode, dirtyMask] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(light);
    expect(hasDirty(dirtyMask, Dirty.Lights)).toBe(true);

    addEventListener(mesh, 'click', onClick);
    [, dirtyNode, dirtyMask] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(mesh);
    expect(hasDirty(dirtyMask, Dirty.Interaction)).toBe(true);

    removeEventListener(mesh, 'click', onClick);
    [, dirtyNode, dirtyMask] = scheduleSync.mock.lastCall ?? [];
    expect(dirtyNode).toBe(mesh);
    expect(hasDirty(dirtyMask, Dirty.Interaction)).toBe(true);
    expect(mesh.listeners.has('click')).toBe(false);
  });

  it('does not reschedule unchanged listener registrations', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const scheduleSync = vi.fn();
    const onClick = vi.fn();
    const onPointerMove = vi.fn();

    insert(scene, mesh, null);
    insert(root, scene, null);
    root.runtime = { scheduleSync };

    addEventListener(mesh, 'click', onClick);
    expect(scheduleSync).toHaveBeenCalledTimes(1);

    addEventListener(mesh, 'click', onClick);
    expect(scheduleSync).toHaveBeenCalledTimes(1);

    removeEventListener(mesh, 'pointermove', onPointerMove);
    expect(scheduleSync).toHaveBeenCalledTimes(1);

    removeEventListener(mesh, 'click', onPointerMove);
    expect(scheduleSync).toHaveBeenCalledTimes(1);

    removeEventListener(mesh, 'click', onClick);
    expect(scheduleSync).toHaveBeenCalledTimes(2);
  });

  it('recomputes draw batches for structural dirty masks', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('controls');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(camera, controls, null);
    insert(scene, camera, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const readDrawBatches = vi.spyOn(cache.drawBatchCache, 'read');
    const secondState = createSceneState(root, cache, {
      dirty: Dirty.Tree | Dirty.Camera
    });

    expect(readDrawBatches).toHaveBeenCalledOnce();
    expect(secondState.drawBatchesChanged).toBe(true);
    expect(secondState.drawBatches[0].instances).toBe(firstState.drawBatches[0].instances);
  });

  it('recomputes draw batches when inserting wrapper subtrees with drawable descendants', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const existingMesh = createElement('mesh');
    const existingGeometry = createElement('boxGeometry');
    const existingMaterial = createElement('standardMaterial');
    const controls = createElement('controls');
    const wrappedMesh = createElement('mesh');
    const wrappedGeometry = createElement('boxGeometry');
    const wrappedMaterial = createElement('standardMaterial');
    const scheduleSync = vi.fn();

    insert(existingMesh, existingGeometry, null);
    insert(existingMesh, existingMaterial, null);
    insert(scene, existingMesh, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    const readDrawBatches = vi.spyOn(cache.drawBatchCache, 'read');
    root.runtime = { scheduleSync };

    insert(wrappedMesh, wrappedGeometry, null);
    insert(wrappedMesh, wrappedMaterial, null);
    insert(controls, wrappedMesh, null);
    insert(scene, controls, null);

    const [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
    const state = createSceneState(root, cache, { dirty: dirtyMask });

    expect(dirtyNode).toBe(controls);
    expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(true);
    expect(readDrawBatches).toHaveBeenCalledOnce();
    expect(state.drawBatches[0].instanceCount).toBe(2);
  });

  it('recomputes draw batches when removing wrapper subtrees with drawable descendants', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const existingMesh = createElement('mesh');
    const existingGeometry = createElement('boxGeometry');
    const existingMaterial = createElement('standardMaterial');
    const wrapper = createElement('unknown-wrapper');
    const wrappedMesh = createElement('mesh');
    const wrappedGeometry = createElement('boxGeometry');
    const wrappedMaterial = createElement('standardMaterial');
    const scheduleSync = vi.fn();

    insert(existingMesh, existingGeometry, null);
    insert(existingMesh, existingMaterial, null);
    insert(wrappedMesh, wrappedGeometry, null);
    insert(wrappedMesh, wrappedMaterial, null);
    insert(wrapper, wrappedMesh, null);
    insert(scene, existingMesh, null);
    insert(scene, wrapper, null);
    insert(root, scene, null);

    createSceneState(root, cache);
    const readDrawBatches = vi.spyOn(cache.drawBatchCache, 'read');
    root.runtime = { scheduleSync };

    remove(wrapper);

    const [, dirtyNode, dirtyMask = Dirty.None] = scheduleSync.mock.lastCall ?? [];
    const state = createSceneState(root, cache, { dirty: dirtyMask });

    expect(dirtyNode).toBe(wrapper);
    expect(hasDirty(dirtyMask, Dirty.DrawBatches)).toBe(true);
    expect(readDrawBatches).toHaveBeenCalledOnce();
    expect(state.drawBatches[0].instanceCount).toBe(1);
  });

  it('re-packs only changed mesh nodes when the mesh structure is stable', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const first = createElement('mesh');
    const firstGeometry = createElement('boxGeometry');
    const firstMaterial = createElement('standardMaterial');
    const second = createElement('mesh');
    const secondGeometry = createElement('boxGeometry');
    const secondMaterial = createElement('standardMaterial');

    setAttribute(first, 'position', [1, 2, 3]);
    setAttribute(second, 'position', [4, 5, 6]);
    insert(first, firstGeometry, null);
    insert(first, firstMaterial, null);
    insert(scene, first, null);
    insert(second, secondGeometry, null);
    insert(second, secondMaterial, null);
    insert(scene, second, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    setAttribute(secondMaterial, 'color', [0.2, 0.3, 0.4, 1]);
    const secondState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'mesh:box:standard:solid:white');
    const secondBoxBatch = drawBatch(secondState, 'mesh:box:standard:solid:white');

    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(true);
    expect(secondBoxBatch.dirtyRanges).toEqual([{ start: 1, count: 1 }]);
    expect(secondBoxBatch.instances[MESH_INSTANCE_FLOATS + 4]).toBeCloseTo(0.2);
    expect(secondBoxBatch.instances[MESH_INSTANCE_FLOATS + 5]).toBeCloseTo(0.3);
    expect(secondBoxBatch.instances[MESH_INSTANCE_FLOATS + 6]).toBeCloseTo(0.4);
    expect(secondBoxBatch.instances[MESH_INSTANCE_FLOATS + 7]).toBe(1);
  });

  it('reads a mesh with box geometry and standard material into a draw item', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(mesh, 'phase', 0.25);
    setAttribute(mesh, 'spinSpeed', 1.4);
    setAttribute(geometry, 'width', 20);
    setAttribute(geometry, 'height', 5);
    setAttribute(geometry, 'depth', 10);
    setAttribute(material, 'color', [0.1, 0.2, 0.3, 1]);
    setAttribute(material, 'roughness', 0.62);
    setAttribute(material, 'metalness', 0.18);

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item).toMatchObject({
      id: mesh.uid,
      phase: 0.25,
      spinSpeed: 1.4,
      geometry: {
        kind: 'box',
        size: [20, 5, 10]
      },
      material: {
        kind: 'standard',
        color: [0.1, 0.2, 0.3, 1],
        roughness: 0.62,
        metalness: 0.18
      },
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
  });

  it('uses identity transform defaults for an untransformed mesh', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform).toEqual({
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1]
    });
  });

  it('applies nested group transforms to child meshes', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(group, 'position', [10, 0, 0]);
    setAttribute(group, 'scale', [2, 3, 4]);
    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(mesh, 'rotation', [0.1, 0.2, 0.3]);

    insert(mesh, geometry, null);
    insert(group, mesh, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform.position[0]).toBeCloseTo(12);
    expect(item.transform.position[1]).toBeCloseTo(6);
    expect(item.transform.position[2]).toBeCloseTo(12);
    expect(item.transform.rotation).toEqual([0.1, 0.2, 0.3]);
    expect(item.transform.scale).toEqual([2, 3, 4]);
  });

  it('composes nested rotations instead of adding Euler components', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(group, 'rotation', [Math.PI / 2, 0, 0]);
    setAttribute(mesh, 'rotation', [0, Math.PI / 2, 0]);

    insert(mesh, geometry, null);
    insert(group, mesh, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform.rotation[0]).toBeCloseTo(Math.PI / 2);
    expect(item.transform.rotation[1]).toBeCloseTo(0);
    expect(item.transform.rotation[2]).toBeCloseTo(Math.PI / 2);
  });

  it('skips invalid mesh composition without crashing', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const meshWithoutGeometry = createElement('mesh');
    const looseGeometry = createElement('boxGeometry');
    const validMesh = createElement('mesh');
    const validGeometry = createElement('sphereGeometry');

    insert(scene, looseGeometry, null);
    insert(scene, meshWithoutGeometry, null);
    insert(validMesh, validGeometry, null);
    insert(scene, validMesh, null);
    insert(root, scene, null);

    const items = collectMeshDrawItems(root);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(validMesh.uid);
    expect(items[0].geometry.kind).toBe('sphere');
    expect(items[0].material.color).toEqual([1, 1, 1, 1]);
  });

  it('changes mesh item revision when a material child is replaced', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const treeRevision = root.treeRevision;
    const [before] = collectMeshDrawItems(root);
    const replacement = createElement('standardMaterial');

    remove(material);
    insert(mesh, replacement, null);
    // Keep the tree seed stable so this isolates child identity in the item revision.
    root.treeRevision = treeRevision;

    const [after] = collectMeshDrawItems(root);

    expect(after.revision).not.toBe(before.revision);
  });

  it('finds the first interactive mesh node', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const first = createElement('mesh');
    const second = createElement('mesh');
    const handler = vi.fn();

    addEventListener(second, 'click', handler);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(root, scene, null);

    expect(findFirstInteractiveMesh(root, 'click')).toBe(second);
  });

  it('reads supported light nodes into normalized light records', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const ambient = createElement('ambientLight');
    const hemi = createElement('hemisphereLight');
    const directional = createElement('directionalLight');
    const point = createElement('pointLight');
    const spot = createElement('spotLight');

    setAttribute(ambient, 'color', [0.2, 0.3, 0.4]);
    setAttribute(ambient, 'intensity', 0.15);
    setAttribute(hemi, 'skyColor', [0.5, 0.6, 0.7]);
    setAttribute(hemi, 'groundColor', [0.1, 0.08, 0.04]);
    setAttribute(hemi, 'intensity', 0.5);
    setAttribute(directional, 'lookAt', [0, 0, 0]);
    setAttribute(directional, 'position', [0, 3, 4]);
    setAttribute(directional, 'intensity', 2);
    setAttribute(point, 'position', [2, 3, 1]);
    setAttribute(point, 'range', 12);
    setAttribute(point, 'decay', 2);
    setAttribute(spot, 'position', [0, 5, 4]);
    setAttribute(spot, 'lookAt', [0, 0, 0]);
    setAttribute(spot, 'angle', 0.45);
    setAttribute(spot, 'penumbra', 0.35);

    insert(scene, ambient, null);
    insert(scene, hemi, null);
    insert(scene, directional, null);
    insert(scene, point, null);
    insert(scene, spot, null);
    insert(root, scene, null);

    const lights = collectLights(root);

    expect(lights.map((light) => light.kind)).toEqual([
      'ambient',
      'hemisphere',
      'directional',
      'point',
      'spot'
    ]);
    expect(lights[0]).toMatchObject({
      color: [0.2, 0.3, 0.4],
      intensity: 0.15,
      castsShadow: false,
      shadowIndex: -1
    });
    expect(lights[1]).toMatchObject({
      color: [0.5, 0.6, 0.7],
      groundColor: [0.1, 0.08, 0.04],
      intensity: 0.5
    });
    expect(lights[2].direction[0]).toBeCloseTo(0);
    expect(lights[2].direction[1]).toBeCloseTo(-0.6);
    expect(lights[2].direction[2]).toBeCloseTo(-0.8);
    expect(lights[3]).toMatchObject({
      position: [2, 3, 1],
      range: 12,
      decay: 2
    });
    expect(lights[4]).toMatchObject({
      angle: 0.45,
      penumbra: 0.35
    });
  });

  it('applies group transforms to descendant point and spot lights', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const point = createElement('pointLight');
    const spot = createElement('spotLight');

    setAttribute(group, 'position', [10, 0, 0]);
    setAttribute(group, 'scale', [2, 3, 4]);
    setAttribute(point, 'position', [1, 2, 3]);
    setAttribute(spot, 'position', [2, 0, 0]);
    setAttribute(spot, 'lookAt', [10, 0, 0]);

    insert(group, point, null);
    insert(group, spot, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [pointLight, spotLight] = collectLights(root);

    expect(pointLight.position[0]).toBeCloseTo(12);
    expect(pointLight.position[1]).toBeCloseTo(6);
    expect(pointLight.position[2]).toBeCloseTo(12);
    expect(spotLight.position).toEqual([14, 0, 0]);
    expect(spotLight.direction).toEqual([-1, 0, 0]);
  });

  it('derives directional light direction from rotation when lookAt is absent', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const directional = createElement('directionalLight');

    setAttribute(directional, 'rotation', [Math.PI / 2, 0, 0]);
    insert(scene, directional, null);
    insert(root, scene, null);

    const [light] = collectLights(root);

    expect(light.direction[0]).toBeCloseTo(0);
    expect(light.direction[1]).toBeCloseTo(1);
    expect(light.direction[2]).toBeCloseTo(0);
  });

  it('clamps malformed light props and limits the scene to MAX_TYPEGPU_LIGHTS', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const point = createElement('pointLight');

    setAttribute(point, 'intensity', -3);
    setAttribute(point, 'range', -5);
    setAttribute(point, 'angle', Math.PI);
    setAttribute(point, 'penumbra', 2);
    insert(scene, point, null);

    for (let index = 0; index < MAX_TYPEGPU_LIGHTS + 4; index += 1) {
      insert(scene, createElement('ambientLight'), null);
    }

    insert(root, scene, null);

    const lights = collectLights(root);

    expect(lights).toHaveLength(MAX_TYPEGPU_LIGHTS);
    expect(lights[0]).toMatchObject({
      intensity: 0,
      range: 0,
      penumbra: 1
    });
    expect(lights[0].angle).toBeLessThan(Math.PI / 2);
  });
});

function drawBatch(state: ReturnType<typeof createSceneState>, key: string) {
  const batch =
    state.drawBatches.find((candidate) => candidate.key === key) ??
    state.drawBatches.find((candidate) => matchesLegacyBatchKey(candidate, key));

  if (!batch) {
    throw new Error(`Missing draw batch ${key}`);
  }

  return batch;
}

function drawBatchByGeometry(
  state: ReturnType<typeof createSceneState>,
  geometryKey: string,
  textureKey = 'solid:white'
) {
  const batch = state.drawBatches.find(
    (candidate) =>
      candidate.geometryKey === geometryKey && (candidate.material.textureKey ?? 'solid:white') === textureKey
  );

  if (!batch) {
    throw new Error(`Missing draw batch for geometry ${geometryKey}`);
  }

  return batch;
}

function matchesLegacyBatchKey(
  batch: ReturnType<typeof createSceneState>['drawBatches'][number],
  key: string
): boolean {
  if (!key.startsWith('mesh:')) return false;

  const suffix = ':standard:';
  const suffixIndex = key.lastIndexOf(suffix);
  if (suffixIndex === -1) return false;

  const geometryPart = key.slice('mesh:'.length, suffixIndex);
  const textureKey = key.slice(suffixIndex + suffix.length);
  const expectedTextureKey = textureKey === 'solid:white' ? 'solid:white' : textureKey;

  if ((batch.material.textureKey ?? 'solid:white') !== expectedTextureKey) return false;

  if (geometryPart.startsWith('imported:')) {
    return batch.geometryKey === geometryPart.slice('imported:'.length);
  }

  return batch.geometry.kind === geometryPart;
}

function createTexturedBox(map: string) {
  const mesh = createElement('mesh');
  const geometry = createElement('boxGeometry');
  const material = createElement('standardMaterial');

  setAttribute(material, 'map', map);
  insert(mesh, geometry, null);
  insert(mesh, material, null);

  return mesh;
}
