import { createBoxInstanceCache } from './components/box';
import { readPerspectiveCamera } from './components/perspective-camera';
import { createSphereInstanceCache } from './components/sphere';
import type { PrimitiveInstanceCache } from './primitive-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  primitiveCaches: PrimitiveInstanceCache[];
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    primitiveCaches: [createBoxInstanceCache(), createSphereInstanceCache()]
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache()
): TypeGpuSceneState {
  return {
    camera: readPerspectiveCamera(root),
    drawBatches: cache.primitiveCaches.map((primitiveCache) => primitiveCache.read(root))
  };
}
