import { createBoxInstanceCache } from './components/box';
import { readPerspectiveCamera } from './components/perspective-camera';
import type { PrimitiveInstanceCache } from './primitive-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  boxes: PrimitiveInstanceCache;
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    boxes: createBoxInstanceCache()
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache()
): TypeGpuSceneState {
  const boxes = cache.boxes.read(root);

  return {
    camera: readPerspectiveCamera(root),
    instances: boxes.instances,
    instanceIds: boxes.instanceIds,
    instanceCount: boxes.instanceCount,
    instancesChanged: boxes.instancesChanged,
    instanceDirtyRanges: boxes.dirtyRanges
  };
}
