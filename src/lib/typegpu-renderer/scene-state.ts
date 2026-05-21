import { createBoxInstanceBuffer } from './components/box';
import { readPerspectiveCamera } from './components/perspective-camera';
import type { TypeGpuNode } from './core';
import type { TypeGpuSceneState } from './types';

export function createSceneState(root: TypeGpuNode): TypeGpuSceneState {
  const boxes = createBoxInstanceBuffer(root);

  return {
    camera: readPerspectiveCamera(root),
    instances: boxes.instances,
    instanceIds: boxes.instanceIds,
    instanceCount: boxes.instanceCount
  };
}
