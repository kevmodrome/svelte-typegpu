import { readPerspectiveCamera } from './components/perspective-camera';
import { readSceneSettings } from './components/scene';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuDrawBatch, TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
}

export interface TypeGpuSceneStateOptions {
  reuseDrawBatches?: boolean;
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache(),
    cleanDrawBatches: []
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

  if (!options.reuseDrawBatches) {
    cache.cleanDrawBatches = cleanDrawBatches(drawBatches);
  }

  return {
    camera: readPerspectiveCamera(root),
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
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
