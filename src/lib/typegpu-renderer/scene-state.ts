import { readPerspectiveCamera } from './components/perspective-camera';
import { readSceneSettings } from './components/scene';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache()
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache()
): TypeGpuSceneState {
  const scene = readSceneSettings(root);

  return {
    camera: readPerspectiveCamera(root),
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    drawBatches: cache.drawBatchCache.read(root)
  };
}
