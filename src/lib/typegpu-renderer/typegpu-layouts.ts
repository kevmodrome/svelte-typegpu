import tgpu, { d } from 'typegpu';

export const typegpuMeshVertexSchema = d.unstruct({
  position: d.location(0, d.float32x3),
  normal: d.location(1, d.float32x3)
});

export const typegpuMeshInstanceSchema = d.unstruct({
  position: d.location(2, d.float32x3),
  phase: d.location(3, d.float32),
  color: d.location(4, d.float32x4),
  shape: d.location(5, d.float32x4),
  spinOffset: d.location(6, d.float32),
  worldRotation: d.location(7, d.float32x3),
  material: d.location(8, d.size(16, d.float32x2))
});

export const meshVertexLayout = tgpu.vertexLayout(d.disarrayOf(typegpuMeshVertexSchema), 'vertex');
export const meshInstanceLayout = tgpu.vertexLayout(
  d.disarrayOf(typegpuMeshInstanceSchema),
  'instance'
);
