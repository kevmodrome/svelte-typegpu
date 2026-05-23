import type { TypeGpuNode } from './core';
import type { TypeGpuTransform } from './types';
import {
  IDENTITY_TRANSFORM,
  composeTransforms as composeMathTransforms,
  readTransformAttributes
} from './math3d';

export { IDENTITY_TRANSFORM };

export function readLocalTransform(node: TypeGpuNode): TypeGpuTransform {
  return readTransformAttributes(node.attributes);
}

export function composeTransforms(
  parent: TypeGpuTransform,
  child: TypeGpuTransform
): TypeGpuTransform {
  return composeMathTransforms(parent, child);
}
