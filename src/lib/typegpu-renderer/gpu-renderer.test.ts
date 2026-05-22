import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SCENE_UNIFORM_FLOATS } from './gpu-renderer';
import { MESH_INSTANCE_FLOATS, MESH_ROTATION_OFFSET } from './instance-data';

describe('TypeGPU GPU renderer', () => {
  const rendererSource = readFileSync('src/lib/typegpu-renderer/gpu-renderer.ts', 'utf8');
  const svelteRendererSource = readFileSync(
    'src/lib/typegpu-renderer/svelte-renderer.ts',
    'utf8'
  );
  const pipelineSource = readFileSync('src/lib/typegpu-renderer/typegpu-pipeline.ts', 'utf8');
  const layoutsSource = readFileSync('src/lib/typegpu-renderer/typegpu-layouts.ts', 'utf8');
  const source = [rendererSource, pipelineSource, layoutsSource].join('\n');

  it('allocates enough floats for the WGSL scene uniform struct alignment', () => {
    expect(SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT).toBe(96);
  });

  it('uses the mesh instance layout expected by the render pipeline', () => {
    expect(MESH_INSTANCE_FLOATS).toBe(20);
    expect(MESH_ROTATION_OFFSET).toBe(13);
  });

  it('uses TypeGPU vertex layouts and vertex buffers for mesh data', () => {
    expect(layoutsSource).toContain('tgpu.vertexLayout');
    expect(rendererSource).toContain('.createBuffer(d.arrayOf(d.f32');
    expect(rendererSource).toMatch(/\.\$usage\('vertex'(?: as never)?\)/);
    expect(rendererSource).toContain('pass.setVertexBuffer(0, buffers.vertexBuffer.buffer)');
    expect(rendererSource).toContain('pass.setVertexBuffer(1, buffers.instanceBuffer.buffer)');
    expect(pipelineSource).toContain('meshVertexLayout.attrib.position');
    expect(pipelineSource).toContain('meshInstanceLayout.attrib.position');
    expect(source).not.toContain('arrayStride: MESH_VERTEX_FLOATS');
    expect(source).not.toContain('arrayStride: MESH_INSTANCE_FLOATS');
  });

  it('uses TypeGPU pipeline and bind group resources for rendering', () => {
    expect(rendererSource).toContain('root.createBindGroup(sceneBindGroupLayout');
    expect(pipelineSource).toMatch(/root\s*\.\s*createRenderPipeline/);
    expect(rendererSource).toContain('root.unwrap(this.#pipeline)');
    expect(rendererSource).toContain('root.unwrap(this.#bindGroup)');
    expect(rendererSource).not.toContain('.with(this.#bindGroup)');
    expect(rendererSource).not.toContain('.with(meshVertexLayout');
    expect(rendererSource).not.toContain('.with(meshInstanceLayout');
    expect(source).not.toContain('device.createBindGroup');
    expect(source).not.toContain('device.createRenderPipeline');
  });

  it('uses a TypeGPU lighting bind group without raw lighting resource creation', () => {
    expect(layoutsSource).toContain('lightingBindGroupLayout');
    expect(rendererSource).toContain('root.createBindGroup(lightingBindGroupLayout');
    expect(rendererSource).toContain('root.createBuffer(typegpuLightingSchema)');
    expect(rendererSource).toContain(".$usage('uniform')");
    expect(rendererSource).toContain('packLightingState(scene.lights)');
    expect(rendererSource).toContain('pass.setBindGroup(1, this.#rawLightingBindGroup)');
    expect(source).not.toContain('device.createBindGroup');
    expect(source).not.toContain('device.createRenderPipeline');
  });

  it('loads renderer runtime source for lighting dirtiness assertions', () => {
    expect(svelteRendererSource).toContain('reuseLights: !lightsDirty');
  });

  it('treats lighting changes as buffer writes separate from mesh uploads', () => {
    expect(rendererSource).toContain('if (scene.lightsChanged)');
    expect(rendererSource).toContain('this.#lightingBuffer.write(packLightingState(scene.lights))');
    expect(rendererSource).not.toContain('packMeshInstance(scene.lights');
  });
});
