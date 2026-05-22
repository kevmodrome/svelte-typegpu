import { collectLights } from './components/lights';
import { readPerspectiveCamera } from './components/perspective-camera';
import { readSceneSettings } from './components/scene';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuDrawBatch, TypeGpuLight, TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
}

export interface TypeGpuSceneStateOptions {
  reuseDrawBatches?: boolean;
  reuseLights?: boolean;
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache(),
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
    : cache.drawBatchCache.read(root);
  const lights = options.reuseLights ? cache.cleanLights : collectLights(root);

  if (!options.reuseDrawBatches) {
    cache.cleanDrawBatches = cleanDrawBatches(drawBatches);
  }

  if (!options.reuseLights) {
    cache.cleanLights = lights;
  }

  return {
    camera: readPerspectiveCamera(root),
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
