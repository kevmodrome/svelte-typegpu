import { BOX_INSTANCE_FLOATS, BOX_SPIN_OFFSET_OFFSET, BOX_SPIN_SPEED_OFFSET } from '../box-data';
import { findFirst, walk, type TypeGpuNode } from '../core';
import { colorTuple, dimensionArg, numberArg, vectorTuple } from '../attributes';

export interface BoxInstanceBuffer {
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
}

export function createBoxInstanceBuffer(root: TypeGpuNode): BoxInstanceBuffer {
  const boxes = collectBoxNodes(root);
  const instances = new Float32Array(boxes.length * BOX_INSTANCE_FLOATS);

  boxes.forEach((box, index) => {
    const offset = index * BOX_INSTANCE_FLOATS;
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
  });

  return { instances, instanceIds: boxes.map((box) => box.uid), instanceCount: boxes.length };
}

export function findFirstInteractiveBox(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirst(root, (node) => node.name === 'box' && Boolean(node.listeners.get(type)?.size));
}

function collectBoxNodes(root: TypeGpuNode): TypeGpuNode[] {
  const boxes: TypeGpuNode[] = [];

  walk(root, (node) => {
    if (node.name === 'box') boxes.push(node);
  });

  return boxes;
}
