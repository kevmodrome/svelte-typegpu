import { isSupportedLightNode, subtreeHasSupportedLight } from './components/lights';
import type { TypeGpuNode } from './core';

export function invalidatesDrawBatches(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) return true;

  return (
    dirtyNode.name !== 'scene' &&
    dirtyNode.name !== 'perspectiveCamera' &&
    !isSupportedLightNode(dirtyNode)
  );
}

export function invalidatesLights(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) return true;
  if (isSupportedLightNode(dirtyNode)) return true;

  return dirtyNode.name === 'group' && subtreeHasSupportedLight(dirtyNode);
}
