import { BOX_INSTANCE_FLOATS, BOX_SPIN_OFFSET_OFFSET, BOX_SPIN_SPEED_OFFSET } from '../box-data';
import { findFirst, type TypeGpuNode } from '../core';
import { createPrimitiveInstanceCache, type PrimitiveInstanceCache } from '../primitive-cache';
import { colorTuple, dimensionArg, numberArg, vectorTuple } from '../attributes';

export interface BoxInstanceBuffer {
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: Array<{ start: number; count: number }>;
}

export function createBoxInstanceCache(): PrimitiveInstanceCache {
  return createPrimitiveInstanceCache({
    floatsPerInstance: BOX_INSTANCE_FLOATS,
    matches: isBoxNode,
    pack: packBoxInstance
  });
}

export function createBoxInstanceBuffer(root: TypeGpuNode): BoxInstanceBuffer {
  return createBoxInstanceCache().read(root);
}

export function findFirstInteractiveBox(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirst(root, (node) => isBoxNode(node) && Boolean(node.listeners.get(type)?.size));
}

function isBoxNode(node: TypeGpuNode): boolean {
  return node.name === 'box';
}

function packBoxInstance(box: TypeGpuNode, instances: Float32Array, offset: number): void {
  const position = vectorTuple(box.attributes.position);
  const color = colorTuple(box.attributes.color);

  instances[offset] = position[0];
  instances[offset + 1] = position[1];
  instances[offset + 2] = position[2];
  instances[offset + 3] = numberArg(box.attributes.phase, 0);
  instances[offset + 4] = color[0];
  instances[offset + 5] = color[1];
  instances[offset + 6] = color[2];
  instances[offset + 7] = color[3];
  instances[offset + 8] = dimensionArg(box.attributes.width, 1);
  instances[offset + 9] = dimensionArg(box.attributes.height, 1);
  instances[offset + 10] = dimensionArg(box.attributes.depth, 1);
  instances[offset + BOX_SPIN_SPEED_OFFSET] = numberArg(box.attributes.spinSpeed, 0);
  instances[offset + BOX_SPIN_OFFSET_OFFSET] = 0;
}
