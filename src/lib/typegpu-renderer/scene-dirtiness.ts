import { isSupportedLightNode, subtreeHasSupportedLight } from './components/lights';
import { subtreeHasMeshNode } from './components/mesh';
import { isCameraControlNode } from './components/perspective-camera';
import type { TypeGpuNode } from './core';

export function invalidatesDrawBatches(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) {
    if (dirtyNode.name === 'group') {
      return subtreeHasMeshNode(dirtyNode);
    }

    return (
      dirtyNode.name !== 'scene' &&
      !isCameraControlNode(dirtyNode) &&
      !isSupportedLightNode(dirtyNode)
    );
  }

  if (dirtyNode.name === 'group') {
    return subtreeHasMeshNode(dirtyNode);
  }

  return (
    dirtyNode.name !== 'scene' &&
    !isCameraControlNode(dirtyNode) &&
    !isSupportedLightNode(dirtyNode)
  );
}

export function invalidatesLights(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) {
    if (isCameraControlNode(dirtyNode)) return false;
    if (isSupportedLightNode(dirtyNode)) return true;

    return dirtyNode.name === 'group' && subtreeHasSupportedLight(dirtyNode);
  }
  if (isCameraControlNode(dirtyNode)) return false;
  if (isSupportedLightNode(dirtyNode)) return true;

  return dirtyNode.name === 'group' && subtreeHasSupportedLight(dirtyNode);
}
