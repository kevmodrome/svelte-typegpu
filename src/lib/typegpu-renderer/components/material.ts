import { colorTuple, numberArg } from '../attributes';
import type { TypeGpuNode } from '../core';
import type { TypeGpuMaterialDescriptor } from '../types';

const DEFAULT_MATERIAL: TypeGpuMaterialDescriptor = {
  kind: 'standard',
  color: [1, 1, 1, 1],
  roughness: 0.45,
  metalness: 0.05
};

export interface TypeGpuMaterialReadResult {
  node: TypeGpuNode | null;
  descriptor: TypeGpuMaterialDescriptor;
}

export function readMeshMaterial(mesh: TypeGpuNode): TypeGpuMaterialDescriptor {
  return readMeshMaterialWithNode(mesh).descriptor;
}

export function readMeshMaterialWithNode(mesh: TypeGpuNode): TypeGpuMaterialReadResult {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'standardMaterial') continue;

    return {
      node: child,
      descriptor: {
        kind: 'standard',
        color: colorTuple(child.attributes.color),
        roughness: numberArg(child.attributes.roughness, DEFAULT_MATERIAL.roughness),
        metalness: numberArg(child.attributes.metalness, DEFAULT_MATERIAL.metalness)
      }
    };
  }

  return {
    node: null,
    descriptor: {
      kind: DEFAULT_MATERIAL.kind,
      color: [...DEFAULT_MATERIAL.color],
      roughness: DEFAULT_MATERIAL.roughness,
      metalness: DEFAULT_MATERIAL.metalness
    }
  };
}
