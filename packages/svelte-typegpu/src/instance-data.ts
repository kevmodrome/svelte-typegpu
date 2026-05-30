import type { TypeGpuMeshDrawItem } from './types';

export const MESH_VERTEX_FLOATS = 12;
export const MESH_VERTEX_LAYOUT_KEY = 'position:normal:uv:color';
export const MESH_INSTANCE_FLOATS = 24;
export const MESH_SPIN_SPEED_OFFSET = 11;
export const MESH_SPIN_OFFSET_OFFSET = 12;
export const MESH_ROTATION_OFFSET = 13;
export const MESH_MATERIAL_PARAMS_OFFSET = 16;
export const MESH_ROUGHNESS_OFFSET = MESH_MATERIAL_PARAMS_OFFSET;
export const MESH_METALNESS_OFFSET = MESH_MATERIAL_PARAMS_OFFSET + 1;
export const MESH_OPACITY_OFFSET = MESH_MATERIAL_PARAMS_OFFSET + 2;
export const MESH_MATERIAL_EXTRA_OFFSET = 20;
export const MESH_SPECULAR_EXPONENT_OFFSET = MESH_MATERIAL_EXTRA_OFFSET;
export const MESH_HAS_TEXTURE_FLAG = 1;
export const MESH_TRANSPARENT_FLAG = 2;
export const MESH_DEPTH_WRITE_DISABLED_FLAG = 4;
export const MESH_RECEIVE_SHADOW_FLAG = 8;

export function packMeshInstance(
  item: TypeGpuMeshDrawItem,
  instances: Float32Array,
  offset: number
): void {
  instances[offset] = item.transform.position[0];
  instances[offset + 1] = item.transform.position[1];
  instances[offset + 2] = item.transform.position[2];
  instances[offset + 3] = item.phase;
  instances[offset + 4] = item.color[0];
  instances[offset + 5] = item.color[1];
  instances[offset + 6] = item.color[2];
  instances[offset + 7] = item.color[3];
  instances[offset + 8] = item.transform.scale[0];
  instances[offset + 9] = item.transform.scale[1];
  instances[offset + 10] = item.transform.scale[2];
  instances[offset + MESH_SPIN_SPEED_OFFSET] = item.spinSpeed;
  instances[offset + MESH_SPIN_OFFSET_OFFSET] = 0;
  instances[offset + MESH_ROTATION_OFFSET] = item.transform.rotation[0];
  instances[offset + MESH_ROTATION_OFFSET + 1] = item.transform.rotation[1];
  instances[offset + MESH_ROTATION_OFFSET + 2] = item.transform.rotation[2];
  instances[offset + MESH_ROUGHNESS_OFFSET] = item.material.roughness;
  instances[offset + MESH_METALNESS_OFFSET] = item.material.metalness;
  instances[offset + MESH_OPACITY_OFFSET] = item.material.opacity;
  instances[offset + MESH_MATERIAL_PARAMS_OFFSET + 3] = materialFlags(item);
  instances[offset + MESH_SPECULAR_EXPONENT_OFFSET] = item.material.specularExponent ?? 0;
}

function materialFlags(item: TypeGpuMeshDrawItem): number {
  let flags = 0;
  if (item.material.textureKey && item.material.textureKey !== 'solid:white') {
    flags |= MESH_HAS_TEXTURE_FLAG;
  }
  if (item.material.transparent || item.material.opacity < 1 || item.color[3] < 1) {
    flags |= MESH_TRANSPARENT_FLAG;
  }
  if (item.material.depthWrite === false) flags |= MESH_DEPTH_WRITE_DISABLED_FLAG;
  if (item.receiveShadow) flags |= MESH_RECEIVE_SHADOW_FLAG;
  return flags;
}
