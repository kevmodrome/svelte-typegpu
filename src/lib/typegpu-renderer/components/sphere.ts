import { findFirst, type TypeGpuNode } from '../core';
import { PRIMITIVE_INSTANCE_FLOATS, packPrimitiveInstance } from '../instance-data';
import { createPrimitiveInstanceCache, type PrimitiveInstanceCache } from '../primitive-cache';
import { createSphereGeometryData } from '../sphere-data';

export function createSphereInstanceCache(): PrimitiveInstanceCache {
  return createPrimitiveInstanceCache({
    key: 'primitive:sphere',
    geometry: createSphereGeometryData(),
    floatsPerInstance: PRIMITIVE_INSTANCE_FLOATS,
    matches: isSphereNode,
    pack: packPrimitiveInstance
  });
}

export function findFirstInteractiveSphere(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirst(root, (node) => isSphereNode(node) && Boolean(node.listeners.get(type)?.size));
}

function isSphereNode(node: TypeGpuNode): boolean {
  return node.name === 'sphere';
}
