import type { TypeGpuBounds } from 'svelte-typegpu';

export const triangleBounds: TypeGpuBounds = {
  min: [-0.5, -0.5, 0],
  max: [0.5, 0.5, 0]
};

export const triangleVertices = new Float32Array([
  -0.5, -0.5, 0, 0, 0, 1, 0, 0, 1, 1, 1, 1,
  0.5, -0.5, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1,
  0, 0.5, 0, 0, 0, 1, 0.5, 1, 1, 1, 1, 1
]);
