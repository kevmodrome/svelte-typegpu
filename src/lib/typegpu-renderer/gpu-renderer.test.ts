import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadTextureImageSource, SCENE_UNIFORM_FLOATS } from './gpu-renderer';
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

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

  it('cleans up decoded texture assets if material loading fails mid-upload', () => {
    expect(rendererSource).toContain('let image: LoadedTextureImage | null = null;');
    expect(rendererSource).toContain('let texture: TypeGpuMaterialTexture | null = null;');
    expect(rendererSource).toMatch(/catch\s*{\s*texture\?\.destroy\(\);/s);
    expect(rendererSource).toMatch(/finally\s*{\s*image\?\.close\(\);\s*}/s);
  });

  it('falls back to an HTML image source when createImageBitmap cannot decode a texture blob', async () => {
    const createImageBitmap = vi.fn(async () => {
      throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:checker');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    const drawImage = vi.fn();
    const getImageData = vi.fn(() => ({ data: pixels }));
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => ({ drawImage, getImageData }))
    };
    let createdImage: FakeImage | null = null;

    class FakeImage {
      decoding = '';
      naturalWidth = 64;
      naturalHeight = 64;
      src = '';

      constructor() {
        createdImage = this;
      }

      async decode(): Promise<void> {}

      removeAttribute(name: string): void {
        if (name === 'src') this.src = '';
      }
    }

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<svg></svg>', { status: 200 }))
    );
    vi.stubGlobal('createImageBitmap', createImageBitmap);
    vi.stubGlobal('Image', FakeImage);
    vi.stubGlobal('document', { createElement: vi.fn(() => canvas) });

    const image = await loadTextureImageSource('/textures/checker.svg');

    expect(createImageBitmap).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(image.width).toBe(64);
    expect(image.height).toBe(64);
    expect(image.source).toBe(pixels);
    expect(canvas.width).toBe(64);
    expect(canvas.height).toBe(64);
    expect(drawImage).toHaveBeenCalledWith(expect.any(FakeImage), 0, 0, 64, 64);
    expect(getImageData).toHaveBeenCalledWith(0, 0, 64, 64);

    image.close();

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:checker');
    expect(createdImage?.src).toBe('');
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

  it('uses a TypeGPU lighting bind group without raw lighting resource creation', () => {
    expect(layoutsSource).toContain('lightingBindGroupLayout');
    expect(rendererSource).toContain('root.createBindGroup(lightingBindGroupLayout');
    expect(rendererSource).toContain('root.createBuffer(typegpuLightingSchema)');
    expect(rendererSource).toContain(".$usage('uniform')");
    expect(rendererSource).toContain('packLightingState(scene.lights)');
    expect(rendererSource).toContain('.with(lightingBindGroup)');
    expect(source).not.toContain('device.createBindGroup');
    expect(source).not.toContain('device.createRenderPipeline');
  });

  it('seeds initial scene state with empty camera metadata', () => {
    expect(rendererSource).toMatch(
      /this\.setScene\(\{[\s\S]*cameraNode:\s*null[\s\S]*cameraControllerNode:\s*null[\s\S]*cameraController:\s*null/s
    );
  });

  it('exposes a narrow camera update method for runtime controls', () => {
    expect(rendererSource).toContain('setCamera(camera: TypeGpuCameraSettings): void');
    expect(rendererSource).toContain('setCamera(camera: TypeGpuCameraSettings): void {');
    expect(rendererSource).toContain('this.setCamera(scene.camera);');
  });

  it('loads renderer runtime source for lighting dirtiness assertions', () => {
    expect(svelteRendererSource).toMatch(
      /lightsDirty\s*\|\|=\s*invalidatesLights\(root,\s*dirtyNode,\s*syncedTreeRevision\)/
    );
    expect(svelteRendererSource).toMatch(
      /createSceneState\(\s*root,\s*sceneCache,\s*{[\s\S]*reuseLights:\s*!lightsDirty[\s\S]*}\s*\)/
    );
  });

  it('treats lighting changes as buffer writes separate from mesh uploads', () => {
    expect(rendererSource).toMatch(
      /if\s*\(scene\.lightsChanged\)\s*{\s*this\.#lightingBuffer\.write\(packLightingState\(scene\.lights\)\);?\s*}/s
    );
    expect(rendererSource).not.toMatch(
      /scene\.lights[\s\S]{0,120}packMeshInstance|packMeshInstance[\s\S]{0,120}scene\.lights/
    );
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
    expect(rendererSource).toContain('pipeline.with(pass).with(sceneBindGroup).with(lightingBindGroup)');
    expect(drawCallScopes).toEqual(['drawTypeGpuMaterialBatch']);
  });
});
