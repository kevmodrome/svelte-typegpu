import { numberArg } from '../attributes';
import { findFirst, type TypeGpuNode } from '../core';

export interface TypeGpuSceneSettings {
  scale: number;
  animationSpeed: number;
  colorShift: number;
}

export function readSceneSettings(root: TypeGpuNode): TypeGpuSceneSettings {
  const scene = findFirst(root, (node) => node.name === 'scene');

  return {
    scale: numberArg(scene?.attributes.scale, 1),
    animationSpeed: numberArg(scene?.attributes.animationSpeed, 1),
    colorShift: numberArg(scene?.attributes.colorShift, 0)
  };
}
