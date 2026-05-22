import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { SCENE_UNIFORM_FLOATS } from './gpu-renderer';
import { MESH_INSTANCE_FLOATS, MESH_ROTATION_OFFSET } from './instance-data';

describe('TypeGPU GPU renderer', () => {
  const rendererSource = readFileSync('src/lib/typegpu-renderer/gpu-renderer.ts', 'utf8');
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
    expect(pipelineSource).toContain('meshVertexLayout.attrib.position');
    expect(pipelineSource).toContain('meshInstanceLayout.attrib.position');
    expect(source).not.toContain('arrayStride: MESH_VERTEX_FLOATS');
    expect(source).not.toContain('arrayStride: MESH_INSTANCE_FLOATS');
  });

  it('creates material resources through TypeGPU APIs', () => {
    expect(rendererSource).toContain('root.createTexture');
    expect(rendererSource).toContain('root.createSampler');
    expect(rendererSource).toContain('root.createBindGroup(materialBindGroupLayout');
    expect(rendererSource).toContain('.write(');
    expect(rendererSource).not.toContain('device.createTexture');
    expect(rendererSource).not.toContain('this.root.device.createTexture');
    expect(rendererSource).not.toContain('device.createSampler');
    expect(rendererSource).not.toContain('device.createBindGroup');
  });

  it('uses TypeGPU pipeline binding for material draws', () => {
    expect(rendererSource).toContain('root.createBindGroup(sceneBindGroupLayout');
    expect(pipelineSource).toMatch(/root\s*\.\s*createRenderPipeline/);
    expect(rendererSource).toContain('.with(sceneBindGroup)');
    expect(rendererSource).toContain('.with(material.bindGroup)');
    expect(rendererSource).toContain('.with(meshVertexLayout');
    expect(rendererSource).toContain('.with(meshInstanceLayout');
    expect(rendererSource).toContain('commandEncoder.beginRenderPass');
    expect(rendererSource).not.toContain('.withColorAttachment');
    expect(rendererSource).not.toContain('.withDepthStencilAttachment');
    expect(rendererSource).toContain('.draw(');
    expect(source).not.toContain('device.createBindGroup');
    expect(source).not.toContain('device.createRenderPipeline');
  });

  it('keeps TypeGPU material draws inside a shared render pass helper', () => {
    const sourceFile = ts.createSourceFile(
      'gpu-renderer.ts',
      rendererSource,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const drawCallScopes: string[] = [];

    function visit(node: ts.Node, functionScope = ''): void {
      const nextScope =
        ts.isFunctionDeclaration(node) && node.name ? node.name.text : functionScope;

      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'draw'
      ) {
        drawCallScopes.push(nextScope);
      }

      node.forEachChild((child) => visit(child, nextScope));
    }

    visit(sourceFile);

    expect(rendererSource).toContain('beginTypeGpuRenderPass');
    expect(rendererSource).toContain('pipeline.with(pass).with(sceneBindGroup)');
    expect(drawCallScopes).toEqual(['drawTypeGpuMaterialBatch']);
  });
});
