import { describe, expect, it } from 'vitest';
import { d } from 'typegpu';
import {
  materialBindGroupLayout,
  sceneBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  meshInstanceLayout,
  meshVertexLayout,
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
        },
        {
          shaderLocation: 2,
          offset: 6 * Float32Array.BYTES_PER_ELEMENT,
          format: 'float32x2'
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
        { shaderLocation: 3, offset: 0, format: 'float32x3' },
        { shaderLocation: 4, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
        { shaderLocation: 5, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
        { shaderLocation: 6, offset: 8 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
        { shaderLocation: 7, offset: 12 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
        {
          shaderLocation: 8,
          offset: MESH_ROTATION_OFFSET * Float32Array.BYTES_PER_ELEMENT,
          format: 'float32x3'
        },
        {
          shaderLocation: 9,
          offset: MESH_ROUGHNESS_OFFSET * Float32Array.BYTES_PER_ELEMENT,
          format: 'float32x4'
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

  it('describes the standard material texture bind group with current TypeGPU texture APIs', () => {
    expect(materialBindGroupLayout.index).toBe(1);
    expect(materialBindGroupLayout.entries.baseColorTexture?.texture.type).toBe('texture_2d');
    expect(materialBindGroupLayout.entries.baseColorSampler?.sampler).toBe('filtering');
  });
});
