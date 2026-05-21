import { dimensionArg } from '../attributes';
import type { TypeGpuNode } from '../core';
import type { TypeGpuGeometryDescriptor } from '../types';

export interface TypeGpuGeometryReadResult {
  node: TypeGpuNode;
  descriptor: TypeGpuGeometryDescriptor;
}

export function readMeshGeometry(mesh: TypeGpuNode): TypeGpuGeometryDescriptor | null {
  return readMeshGeometryWithNode(mesh)?.descriptor ?? null;
}

export function readMeshGeometryWithNode(mesh: TypeGpuNode): TypeGpuGeometryReadResult | null {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const descriptor = readGeometryDescriptor(child);
    if (descriptor) return { node: child, descriptor };
  }

  return null;
}

function readGeometryDescriptor(node: TypeGpuNode): TypeGpuGeometryDescriptor | null {
  if (node.name === 'boxGeometry') {
    return {
      kind: 'box',
      size: [
        dimensionArg(node.attributes.width, 1),
        dimensionArg(node.attributes.height, 1),
        dimensionArg(node.attributes.depth, 1)
      ]
    };
  }

  if (node.name === 'sphereGeometry') {
    const diameter = dimensionArg(node.attributes.radius, 0.5) * 2;

    return {
      kind: 'sphere',
      size: [
        dimensionArg(node.attributes.width, diameter),
        dimensionArg(node.attributes.height, diameter),
        dimensionArg(node.attributes.depth, diameter)
      ]
    };
  }

  return null;
}
