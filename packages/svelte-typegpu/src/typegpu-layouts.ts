import tgpu, { d } from 'typegpu';
import { MAX_TYPEGPU_LIGHTS } from './types';

export { MAX_TYPEGPU_LIGHTS };

export const typegpuMeshVertexSchema = d.unstruct({
  position: d.location(0, d.float32x3),
  normal: d.location(1, d.float32x3),
  uv: d.location(2, d.float32x2),
  color: d.location(3, d.float32x4)
});

export const typegpuMeshInstanceSchema = d.unstruct({
  position: d.location(4, d.float32x3),
  padding0: d.location(5, d.float32),
  color: d.location(6, d.float32x4),
  shape: d.location(7, d.float32x4),
  padding1: d.location(8, d.float32),
  worldRotation: d.location(9, d.float32x3),
  material: d.location(10, d.float32x4),
  materialExtra: d.location(11, d.float32x4)
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
    padding0: d.f32,
    padding1: d.f32,
    padding2: d.f32,
    padding3: d.vec4f
  })
  .$name('SceneUniforms');

export const sceneBindGroupLayout = tgpu
  .bindGroupLayout({
    scene: { uniform: typegpuSceneUniformSchema }
  })
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
  .$name('TypeGPU lighting bind group layout');

export const TYPEGPU_SHADOW_UNIFORM_FLOATS = 24;
export const TYPEGPU_SHADOW_UNIFORM_BYTES =
  TYPEGPU_SHADOW_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const typegpuShadowSchema = d
  .struct({
    view_projection: d.mat4x4f,
    params: d.vec4f,
    camera_depth: d.vec4f
  })
  .$name('TypeGpuShadow');

export const materialBindGroupLayout = tgpu
  .bindGroupLayout({
    baseColorTexture: { texture: d.texture2d(), visibility: ['fragment'] },
    baseColorSampler: { sampler: 'filtering', visibility: ['fragment'] },
    uniforms: {
      uniform: d
        .struct({
          value0: d.vec4f,
          value1: d.vec4f,
          value2: d.vec4f,
          value3: d.vec4f,
          value4: d.vec4f,
          value5: d.vec4f,
          value6: d.vec4f,
          value7: d.vec4f
        })
        .$name('TypeGpuMaterialUniforms'),
      visibility: ['fragment']
    }
  })
  .$name('TypeGPU standard material bind group layout');

export const shadowBindGroupLayout = tgpu
  .bindGroupLayout({
    shadow: { uniform: typegpuShadowSchema },
    shadowMap: { texture: d.textureDepth2d(), visibility: ['fragment'] },
    shadowSampler: { sampler: 'comparison', visibility: ['fragment'] }
  })
  .$name('TypeGPU shadow map bind group layout');

export const shadowPassBindGroupLayout = tgpu
  .bindGroupLayout({
    shadow: { uniform: typegpuShadowSchema, visibility: ['vertex'] }
  })
  .$idx(0)
  .$name('TypeGPU shadow pass bind group layout');

export const TYPEGPU_SHADER_PASS_UNIFORM_FLOATS = 36;
export const TYPEGPU_SHADER_PASS_UNIFORM_BYTES =
  TYPEGPU_SHADER_PASS_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT;

export const typegpuShaderPassUniformSchema = d
  .struct({
    time: d.f32,
    padding0: d.f32,
    resolution: d.vec2f,
    value0: d.vec4f,
    value1: d.vec4f,
    value2: d.vec4f,
    value3: d.vec4f,
    value4: d.vec4f,
    value5: d.vec4f,
    value6: d.vec4f,
    value7: d.vec4f
  })
  .$name('TypeGpuShaderPassUniforms');

export const shaderPassBindGroupLayout = tgpu
  .bindGroupLayout({
    uniforms: { uniform: typegpuShaderPassUniformSchema, visibility: ['fragment'] }
  })
  .$idx(0)
  .$name('TypeGPU shader pass bind group layout');
