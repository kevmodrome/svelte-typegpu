import { collectLights } from './components/lights';
import { readCameraState } from './camera';
import { readSceneSettings } from './components/scene';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import { createModelCache, type TypeGpuModelCache } from './model-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuDrawBatch, TypeGpuLight, TypeGpuSceneState } from './types';
import { Dirty, hasDirty } from './dirty';

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
  dirty?: Dirty;
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
  const dirty = options.dirty ?? Dirty.All;
  const reuseDrawBatches = options.reuseDrawBatches ?? !shouldRecomputeDrawBatches(dirty);
  const reuseLights = options.reuseLights ?? !hasDirty(dirty, Dirty.Lights);
  const scene = readSceneSettings(root);
  const drawBatches = reuseDrawBatches
    ? cache.cleanDrawBatches
    : cache.drawBatchCache.read(root, cache.modelCache);
  const lights = reuseLights ? cache.cleanLights : collectLights(root);
  const camera = readCameraState(root);

  if (!reuseDrawBatches) {
    cache.cleanDrawBatches = cleanDrawBatches(drawBatches);
  }

  if (!reuseLights) {
    cache.cleanLights = lights;
  }

  return {
    dirty,
    camera: camera.settings,
    cameraNode: camera.node,
    cameraControllerNode: camera.controllerNode,
    cameraController: camera.controller?.kind === 'controls' ? camera.controller : null,
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    colorShift: scene.colorShift,
    lights,
    lightsChanged: !reuseLights,
    drawBatches
  };
}

function shouldRecomputeDrawBatches(dirty: Dirty): boolean {
  return (
    hasDirty(dirty, Dirty.Transform) ||
    hasDirty(dirty, Dirty.InstanceData) ||
    hasDirty(dirty, Dirty.DrawBatches) ||
    hasDirty(dirty, Dirty.Geometry) ||
    hasDirty(dirty, Dirty.Material) ||
    hasDirty(dirty, Dirty.MaterialUniform) ||
    hasDirty(dirty, Dirty.Texture) ||
    hasDirty(dirty, Dirty.BindGroup) ||
    hasDirty(dirty, Dirty.Pipeline)
  );
}

function cleanDrawBatches(drawBatches: TypeGpuDrawBatch[]): TypeGpuDrawBatch[] {
  return drawBatches.map((batch) => ({
    ...batch,
    instancesChanged: false,
    dirtyRanges: []
  }));
}
