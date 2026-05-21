import { BOX_INSTANCE_FLOATS, createBoxGeometryData } from '../box-data';
import { findFirst, type TypeGpuNode } from '../core';
import { packPrimitiveInstance } from '../instance-data';
import { createPrimitiveInstanceCache, type PrimitiveInstanceCache } from '../primitive-cache';

export interface BoxInstanceBuffer {
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: Array<{ start: number; count: number }>;
}

export function createBoxInstanceCache(): PrimitiveInstanceCache {
  return createPrimitiveInstanceCache({
    key: 'primitive:box',
    geometry: createBoxGeometryData(),
    floatsPerInstance: BOX_INSTANCE_FLOATS,
    matches: isBoxNode,
    pack: packPrimitiveInstance
  });
}

export function createBoxInstanceBuffer(root: TypeGpuNode): BoxInstanceBuffer {
  return createBoxInstanceCache().read(root);
}

export function findFirstInteractiveBox(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirstInteractivePrimitive(root, type);
}

export function findFirstInteractivePrimitive(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirst(
    root,
    (node) => isPrimitiveNode(node) && Boolean(node.listeners.get(type)?.size)
  );
}

function isBoxNode(node: TypeGpuNode): boolean {
  return node.name === 'box';
}

function isPrimitiveNode(node: TypeGpuNode): boolean {
  return node.name === 'box' || node.name === 'sphere';
}
