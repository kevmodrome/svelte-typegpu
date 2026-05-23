import {
  DEFAULT_STANDARD_MATERIAL,
  isStandardMaterialObject,
  normalizeStandardMaterial
} from '../materials';
import type { TypeGpuNode } from '../core';
import type { TypeGpuStandardMaterialDescriptor } from '../types';

export interface TypeGpuMaterialReadResult {
  node: TypeGpuNode | null;
  descriptor: TypeGpuStandardMaterialDescriptor;
}

export function readMeshMaterial(mesh: TypeGpuNode): TypeGpuStandardMaterialDescriptor {
  return readMeshMaterialWithNode(mesh).descriptor;
}

export function readMeshMaterialWithNode(mesh: TypeGpuNode): TypeGpuMaterialReadResult {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'standardMaterial') continue;

    const materialAttr = child.attributes.material;
    const base = isStandardMaterialObject(materialAttr)
      ? materialAttr
      : DEFAULT_STANDARD_MATERIAL;

    return {
      node: child,
      descriptor: normalizeStandardMaterial(base, child.attributes)
    };
  }

  return {
    node: null,
    descriptor: normalizeStandardMaterial(DEFAULT_STANDARD_MATERIAL, {})
  };
}
