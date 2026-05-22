import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENE_UNIFORM_FLOATS } from './gpu-renderer';
import { MESH_INSTANCE_FLOATS, MESH_ROTATION_OFFSET } from './instance-data';

describe('TypeGPU GPU renderer', () => {
  const source = readFileSync('src/lib/typegpu-renderer/gpu-renderer.ts', 'utf8');

  it('allocates enough floats for the WGSL scene uniform struct alignment', () => {
    expect(SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT).toBe(96);
  });

  it('uses the mesh instance layout expected by the render pipeline', () => {
    expect(MESH_INSTANCE_FLOATS).toBe(20);
    expect(MESH_ROTATION_OFFSET).toBe(13);
  });

  it('uses TypeGPU vertex layouts and vertex buffers for mesh data', () => {
    expect(source).toContain('meshVertexLayout.vertexLayout');
    expect(source).toContain('meshInstanceLayout.vertexLayout');
    expect(source).toContain('.createBuffer(d.arrayOf(d.f32');
    expect(source).toMatch(/\.\$usage\('vertex'(?: as never)?\)/);
    expect(source).not.toContain('arrayStride: MESH_VERTEX_FLOATS');
    expect(source).not.toContain('arrayStride: MESH_INSTANCE_FLOATS');
  });
});
