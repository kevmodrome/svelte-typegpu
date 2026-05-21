import { createBoxInstanceCache } from './components/box';
import { readPerspectiveCamera } from './components/perspective-camera';
import { readSceneSettings } from './components/scene';
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
  const scene = readSceneSettings(root);

  return {
    camera: readPerspectiveCamera(root),
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    drawBatches: cache.primitiveCaches.map((primitiveCache) => primitiveCache.read(root))
  };
}
