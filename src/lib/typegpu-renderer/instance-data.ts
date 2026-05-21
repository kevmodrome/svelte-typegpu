import { colorTuple, dimensionArg, numberArg, vectorTuple } from './attributes';
import type { TypeGpuNode } from './core';

export const PRIMITIVE_VERTEX_FLOATS = 6;
export const PRIMITIVE_INSTANCE_FLOATS = 13;
export const PRIMITIVE_SPIN_SPEED_OFFSET = 11;
export const PRIMITIVE_SPIN_OFFSET_OFFSET = 12;

export function packPrimitiveInstance(
  node: TypeGpuNode,
  instances: Float32Array,
  offset: number
): void {
  const position = vectorTuple(node.attributes.position);
  const color = colorTuple(node.attributes.color);

  instances[offset] = position[0];
  instances[offset + 1] = position[1];
  instances[offset + 2] = position[2];
  instances[offset + 3] = numberArg(node.attributes.phase, 0);
  instances[offset + 4] = color[0];
  instances[offset + 5] = color[1];
  instances[offset + 6] = color[2];
  instances[offset + 7] = color[3];
  instances[offset + 8] = dimensionArg(node.attributes.width, 1);
  instances[offset + 9] = dimensionArg(node.attributes.height, 1);
  instances[offset + 10] = dimensionArg(node.attributes.depth, 1);
  instances[offset + PRIMITIVE_SPIN_SPEED_OFFSET] = numberArg(node.attributes.spinSpeed, 0);
  instances[offset + PRIMITIVE_SPIN_OFFSET_OFFSET] = 0;
}
