import { numberArg } from '../attributes';
import type { TypeGpuNode } from '../core';
import type { TypeGpuLoadedModelMesh } from '../glb-loader';
import type { TypeGpuModelCache } from '../model-cache';
import { composeTransforms, readLocalTransform } from '../transform';
import type { TypeGpuMeshDrawItem, TypeGpuTransform } from '../types';

export interface ModelWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function readModelDrawItems(
  modelNode: TypeGpuNode,
  context: ModelWalkContext,
  modelCache: TypeGpuModelCache
): TypeGpuMeshDrawItem[] {
  const entry = modelCache.read({
    src: modelNode.attributes.src,
    data: modelNode.attributes.data
  });

  if (entry.status !== 'ready') return [];

  const modelTransform = composeTransforms(context.transform, readLocalTransform(modelNode));
  const baseRevision = combineRevision(context.revision, modelNode, entry.revision);

  return entry.model.meshes.map((mesh, index) =>
    modelMeshDrawItem(modelNode, mesh, modelTransform, baseRevision, index)
  );
}

export function subtreeHasModelNode(node: TypeGpuNode | undefined): boolean {
  if (!node) return false;
  if (node.name === 'model') return true;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (subtreeHasModelNode(child)) return true;
  }

  return false;
}

function modelMeshDrawItem(
  modelNode: TypeGpuNode,
  mesh: TypeGpuLoadedModelMesh,
  modelTransform: TypeGpuTransform,
  baseRevision: number,
  index: number
): TypeGpuMeshDrawItem {
  return {
    id: modelNode.uid * 1000 + index,
    revision: combineRevision(baseRevision, null, index),
    geometry: {
      kind: 'imported',
      key: mesh.geometry.key,
      size: [1, 1, 1],
      data: mesh.geometry
    },
    material: mesh.material,
    transform: composeTransforms(modelTransform, mesh.transform),
    phase: numberArg(modelNode.attributes.phase, 0),
    spinSpeed: numberArg(modelNode.attributes.spinSpeed, 0)
  };
}

function combineRevision(seed: number, node: TypeGpuNode | null, extra = 0): number {
  const nodeRevision = node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
  return nodeRevision * 31 + extra;
}
