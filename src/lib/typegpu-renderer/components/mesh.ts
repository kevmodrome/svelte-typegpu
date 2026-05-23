import { numberArg } from '../attributes';
import { findFirst, type TypeGpuNode } from '../core';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from '../transform';
import type { TypeGpuMeshDrawItem, TypeGpuTransform } from '../types';
import { readMeshGeometryWithNode } from './geometry';
import { readMeshMaterialWithNode } from './material';

interface MeshWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function collectMeshDrawItems(root: TypeGpuNode): TypeGpuMeshDrawItem[] {
  const items: TypeGpuMeshDrawItem[] = [];

  collectFromNode(root, { transform: IDENTITY_TRANSFORM, revision: root.treeRevision }, items);

  return items;
}

export function findFirstInteractiveMesh(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirst(root, (node) => node.name === 'mesh' && Boolean(node.listeners.get(type)?.size));
}

export function subtreeHasMeshNode(node: TypeGpuNode | undefined): boolean {
  if (!node) return false;
  if (node.name === 'mesh') return true;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (subtreeHasMeshNode(child)) return true;
  }

  return false;
}

function collectFromNode(
  node: TypeGpuNode,
  context: MeshWalkContext,
  items: TypeGpuMeshDrawItem[]
): void {
  let childContext = context;

  if (node.name === 'group') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: combineNodeRevision(context.revision, node)
    };
  } else if (node.name === 'mesh') {
    childContext = readMesh(node, context, items);
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectFromNode(child, childContext, items);
  }
}

function readMesh(
  mesh: TypeGpuNode,
  context: MeshWalkContext,
  items: TypeGpuMeshDrawItem[]
): MeshWalkContext {
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

function combineNodeRevision(seed: number, node: TypeGpuNode | null): number {
  return node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
}
