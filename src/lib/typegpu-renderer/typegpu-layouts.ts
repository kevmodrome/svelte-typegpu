import tgpu, { d } from 'typegpu';
import { MAX_TYPEGPU_LIGHTS } from './types';

export { MAX_TYPEGPU_LIGHTS };

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

export const TYPEGPU_SCENE_UNIFORM_FLOATS = 24;
export const typegpuSceneUniformSchema = d
  .struct({
    view_projection: d.mat4x4f,
    time: d.f32,
    scale: d.f32,
    animation_speed: d.f32,
    animation_offset: d.f32,
    color_transform: d.vec4f
  })
  .$name('SceneUniforms');

export const sceneBindGroupLayout = tgpu
  .bindGroupLayout({
    scene: { uniform: typegpuSceneUniformSchema }
  })
  .$idx(0)
  .$name('TypeGPU scene bind group layout');

export const TYPEGPU_LIGHT_RECORD_BYTES = 96;
export const TYPEGPU_LIGHTING_BYTES = 16 + MAX_TYPEGPU_LIGHTS * TYPEGPU_LIGHT_RECORD_BYTES;

export const typegpuLightSchema = d
  .struct({
    kind: d.u32,
    flags: d.u32,
    shadowIndex: d.u32,
    reserved0: d.u32,
    position_range: d.vec4f,
    direction_angle: d.vec4f,
    color_intensity: d.vec4f,
    secondary_color: d.vec4f,
    params: d.vec4f
  })
  .$name('TypeGpuLight');

export const typegpuLightingSchema = d
  .struct({
    count: d.u32,
    reserved0: d.u32,
    reserved1: d.u32,
    reserved2: d.u32,
    lights: d.arrayOf(typegpuLightSchema, MAX_TYPEGPU_LIGHTS)
  })
  .$name('TypeGpuLighting');

export const lightingBindGroupLayout = tgpu
  .bindGroupLayout({
    lighting: { uniform: typegpuLightingSchema }
  })
  .$idx(1)
  .$name('TypeGPU lighting bind group layout');
