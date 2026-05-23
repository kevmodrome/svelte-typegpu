import { numberArg } from '../attributes';
import type { TypeGpuNode } from '../core';
import type { TypeGpuModelCache } from '../model-cache';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from '../transform';
import type { TypeGpuMeshDrawItem, TypeGpuTransform } from '../types';
import { readMeshGeometryWithNode } from './geometry';
import { readMeshMaterialWithNode } from './material';
import { readModelDrawItems } from './model';

interface DrawItemWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function collectDrawItems(
  root: TypeGpuNode,
  modelCache: TypeGpuModelCache
): TypeGpuMeshDrawItem[] {
  const items: TypeGpuMeshDrawItem[] = [];

  collectFromNode(
    root,
    { transform: IDENTITY_TRANSFORM, revision: root.treeRevision },
    items,
    modelCache
  );

  return items;
}

function collectFromNode(
  node: TypeGpuNode,
  context: DrawItemWalkContext,
  items: TypeGpuMeshDrawItem[],
  modelCache: TypeGpuModelCache
): void {
  let childContext = context;

  if (node.name === 'group') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: combineNodeRevision(context.revision, node)
    };
  } else if (node.name === 'mesh') {
    childContext = readMesh(node, context, items);
  } else if (node.name === 'model') {
    childContext = readModel(node, context, items, modelCache);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectFromNode(child, childContext, items, modelCache);
  }
}

function readMesh(
  mesh: TypeGpuNode,
  context: DrawItemWalkContext,
  items: TypeGpuMeshDrawItem[]
): DrawItemWalkContext {
  const transform = composeTransforms(context.transform, readLocalTransform(mesh));
  const meshRevision = combineNodeRevision(context.revision, mesh);
  const geometry = readMeshGeometryWithNode(mesh);

  if (!geometry) {
    return { transform, revision: meshRevision };
  }

  const material = readMeshMaterialWithNode(mesh);
  const geometryRevision = combineNodeRevision(meshRevision, geometry.node);
  const itemRevision = combineNodeRevision(geometryRevision, material.node);

  items.push({
    id: mesh.uid,
    revision: itemRevision,
    geometry: geometry.descriptor,
    material: material.descriptor,
    transform,
    phase: numberArg(mesh.attributes.phase, 0),
    spinSpeed: numberArg(mesh.attributes.spinSpeed, 0)
  } as unknown as TypeGpuMeshDrawItem);

  return { transform, revision: meshRevision };
}

function readModel(
  modelNode: TypeGpuNode,
  context: DrawItemWalkContext,
  items: TypeGpuMeshDrawItem[],
  modelCache: TypeGpuModelCache
): DrawItemWalkContext {
  const transform = composeTransforms(context.transform, readLocalTransform(modelNode));
  const modelRevision = combineNodeRevision(context.revision, modelNode);

  items.push(...readModelDrawItems(modelNode, context, modelCache));

  return { transform, revision: modelRevision };
}

function combineNodeRevision(seed: number, node: TypeGpuNode | null): number {
  return node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
}
