import type { TypeGpuMeshDrawItem } from './types';

export const MESH_VERTEX_FLOATS = 6;
export const MESH_INSTANCE_FLOATS = 20;
export const MESH_SPIN_SPEED_OFFSET = 11;
export const MESH_SPIN_OFFSET_OFFSET = 12;
export const MESH_ROTATION_OFFSET = 13;
export const MESH_ROUGHNESS_OFFSET = 16;
export const MESH_METALNESS_OFFSET = 17;

export function packMeshInstance(
  item: TypeGpuMeshDrawItem,
  instances: Float32Array,
  offset: number
): void {
  instances[offset] = item.transform.position[0];
  instances[offset + 1] = item.transform.position[1];
  instances[offset + 2] = item.transform.position[2];
  instances[offset + 3] = item.phase;
  instances[offset + 4] = item.material.color[0];
  instances[offset + 5] = item.material.color[1];
  instances[offset + 6] = item.material.color[2];
  instances[offset + 7] = item.material.color[3];
  instances[offset + 8] = item.geometry.size[0] * item.transform.scale[0];
  instances[offset + 9] = item.geometry.size[1] * item.transform.scale[1];
  instances[offset + 10] = item.geometry.size[2] * item.transform.scale[2];
  instances[offset + MESH_SPIN_SPEED_OFFSET] = item.spinSpeed;
  instances[offset + MESH_SPIN_OFFSET_OFFSET] = 0;
  instances[offset + MESH_ROTATION_OFFSET] = item.transform.rotation[0];
  instances[offset + MESH_ROTATION_OFFSET + 1] = item.transform.rotation[1];
  instances[offset + MESH_ROTATION_OFFSET + 2] = item.transform.rotation[2];
  instances[offset + MESH_ROUGHNESS_OFFSET] = item.material.roughness;
  instances[offset + MESH_METALNESS_OFFSET] = item.material.metalness;
  instances[offset + 18] = 0;
  instances[offset + 19] = 0;
}

// Keep the current GPU renderer layout stable until the Task 3 renderer update.
export const PRIMITIVE_VERTEX_FLOATS = MESH_VERTEX_FLOATS;
export const PRIMITIVE_INSTANCE_FLOATS = 13;
export const PRIMITIVE_SPIN_SPEED_OFFSET = 11;
export const PRIMITIVE_SPIN_OFFSET_OFFSET = 12;
