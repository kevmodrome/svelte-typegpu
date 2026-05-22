import { describe, expect, it } from 'vitest';
import { d } from 'typegpu';
import {
  lightingBindGroupLayout,
  MAX_TYPEGPU_LIGHTS,
  TYPEGPU_LIGHT_RECORD_BYTES,
  TYPEGPU_LIGHTING_BYTES,
  sceneBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  meshInstanceLayout,
  meshVertexLayout,
  typegpuLightSchema,
  typegpuLightingSchema,
  typegpuSceneUniformSchema,
  typegpuMeshInstanceSchema,
  typegpuMeshVertexSchema
} from './typegpu-layouts';
import {
  MESH_INSTANCE_FLOATS,
  MESH_ROUGHNESS_OFFSET,
  MESH_ROTATION_OFFSET,
  MESH_VERTEX_FLOATS
} from './instance-data';
import {
  TYPEGPU_LIGHT_COLOR_OFFSET,
  TYPEGPU_LIGHT_DIRECTION_OFFSET,
  TYPEGPU_LIGHT_FLAGS_OFFSET,
  TYPEGPU_LIGHT_HEADER_BYTES,
  TYPEGPU_LIGHT_KIND_OFFSET,
  TYPEGPU_LIGHT_PARAMS_OFFSET,
  TYPEGPU_LIGHT_POSITION_OFFSET,
  TYPEGPU_LIGHT_SECONDARY_COLOR_OFFSET,
  TYPEGPU_LIGHT_SHADOW_INDEX_OFFSET
} from './lighting-data';

describe('TypeGPU layout schemas', () => {
  it('describes the mesh vertex buffer with a TypeGPU vertex layout', () => {
    expect(typegpuMeshVertexSchema.type).toBe('unstruct');
    expect(meshVertexLayout.stepMode).toBe('vertex');
    expect(meshVertexLayout.stride).toBe(MESH_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT);
    expect(meshVertexLayout.vertexLayout).toMatchObject({
      arrayStride: MESH_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      stepMode: 'vertex',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        {
          shaderLocation: 1,
          offset: 3 * Float32Array.BYTES_PER_ELEMENT,
          format: 'float32x3'
        }
      ]
    });
  });

  it('describes the mesh instance buffer with a TypeGPU vertex layout', () => {
    expect(typegpuMeshInstanceSchema.type).toBe('unstruct');
    expect(meshInstanceLayout.stepMode).toBe('instance');
    expect(meshInstanceLayout.stride).toBe(
      MESH_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT
    );
    expect(meshInstanceLayout.vertexLayout).toMatchObject({
      arrayStride: MESH_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      stepMode: 'instance',
      attributes: [
        { shaderLocation: 2, offset: 0, format: 'float32x3' },
        { shaderLocation: 3, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
        { shaderLocation: 4, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
        { shaderLocation: 5, offset: 8 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
        { shaderLocation: 6, offset: 12 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
        {
          shaderLocation: 7,
          offset: MESH_ROTATION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
          format: 'float32x3'
        },
        {
          shaderLocation: 8,
          offset: MESH_ROUGHNESS_OFFSET * Float32Array.BYTES_PER_ELEMENT,
          format: 'float32x2'
        }
      ]
    });
  });

  it('describes the scene uniforms with a padded TypeGPU bind group layout', () => {
    expect(TYPEGPU_SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT).toBe(96);
    expect(d.sizeOf(typegpuSceneUniformSchema)).toBe(96);
    expect(typegpuSceneUniformSchema.propTypes.color_transform).toBeDefined();
    expect(sceneBindGroupLayout.index).toBe(0);
    expect(sceneBindGroupLayout.entries.scene?.uniform).toBe(typegpuSceneUniformSchema);
  });

  it('describes lighting uniforms with a TypeGPU bind group layout', () => {
    expect(MAX_TYPEGPU_LIGHTS).toBe(32);
    expect(TYPEGPU_LIGHT_RECORD_BYTES).toBe(96);
    expect(d.sizeOf(typegpuLightSchema)).toBe(TYPEGPU_LIGHT_RECORD_BYTES);
    expect(d.sizeOf(typegpuLightingSchema)).toBe(TYPEGPU_LIGHTING_BYTES);
    expect(lightingBindGroupLayout.index).toBe(1);
    expect(lightingBindGroupLayout.entries.lighting?.uniform).toBe(typegpuLightingSchema);
  });

  it('keeps lighting packer offsets aligned with TypeGPU light record layout', () => {
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.kind).offset).toBe(
      TYPEGPU_LIGHT_KIND_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.flags).offset).toBe(
      TYPEGPU_LIGHT_FLAGS_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.shadowIndex).offset).toBe(
      TYPEGPU_LIGHT_SHADOW_INDEX_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.position_range).offset).toBe(
      TYPEGPU_LIGHT_POSITION_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.direction_angle).offset).toBe(
      TYPEGPU_LIGHT_DIRECTION_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.color_intensity).offset).toBe(
      TYPEGPU_LIGHT_COLOR_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.secondary_color).offset).toBe(
      TYPEGPU_LIGHT_SECONDARY_COLOR_OFFSET
    );
    expect(d.memoryLayoutOf(typegpuLightSchema, (light) => light.params).offset).toBe(
      TYPEGPU_LIGHT_PARAMS_OFFSET
    );
  });

  it('keeps lighting packer header aligned with TypeGPU lighting layout', () => {
    expect(d.memoryLayoutOf(typegpuLightingSchema, (lighting) => lighting.lights).offset).toBe(
      TYPEGPU_LIGHT_HEADER_BYTES
    );
  });
});
