import { collectLights } from './components/lights';
import { readPerspectiveCameraState } from './components/perspective-camera';
import { readSceneSettings } from './components/scene';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import { createModelCache, type TypeGpuModelCache } from './model-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuDrawBatch, TypeGpuLight, TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  modelCache: TypeGpuModelCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
}

export interface CreateTypeGpuSceneCacheOptions {
  modelCache?: TypeGpuModelCache;
  onModelSettled?: () => void;
}

export interface TypeGpuSceneStateOptions {
  reuseDrawBatches?: boolean;
  reuseLights?: boolean;
}

export function createTypeGpuSceneCache(
  options: CreateTypeGpuSceneCacheOptions = {}
): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache(),
    modelCache:
      options.modelCache ??
      createModelCache({
        onSettled: options.onModelSettled
      }),
    cleanDrawBatches: [],
    cleanLights: []
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache(),
  options: TypeGpuSceneStateOptions = {}
): TypeGpuSceneState {
  const scene = readSceneSettings(root);
  const drawBatches = options.reuseDrawBatches
    ? cache.cleanDrawBatches
    : cache.drawBatchCache.read(root, cache.modelCache);
  const lights = options.reuseLights ? cache.cleanLights : collectLights(root);
  const camera = readPerspectiveCameraState(root);

  if (!options.reuseDrawBatches) {
    cache.cleanDrawBatches = cleanDrawBatches(drawBatches);
  }

  if (!options.reuseLights) {
    cache.cleanLights = lights;
  }

  return {
    camera: camera.settings,
    cameraNode: camera.node,
    cameraControllerNode: camera.controllerNode,
    cameraController: camera.controller,
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    colorShift: scene.colorShift,
    lights,
    lightsChanged: !options.reuseLights,
    drawBatches
  };
}

function cleanDrawBatches(drawBatches: TypeGpuDrawBatch[]): TypeGpuDrawBatch[] {
  return drawBatches.map((batch) => ({
    ...batch,
    instancesChanged: false,
    dirtyRanges: []
  }));
}
