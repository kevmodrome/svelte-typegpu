import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadMaterialTextureImageSource, SCENE_UNIFORM_FLOATS } from './gpu-renderer';
import { MESH_INSTANCE_FLOATS, MESH_ROTATION_OFFSET } from './instance-data';

function readSource(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

describe('TypeGPU GPU renderer', () => {
  const rendererSource = readSource('src/lib/typegpu-renderer/gpu-renderer.ts');
  const cacheSource = readSource('src/lib/typegpu-renderer/resource-caches.ts');
  const pipelineSource = readFileSync('src/lib/typegpu-renderer/typegpu-pipeline.ts', 'utf8');
  const layoutsSource = readFileSync('src/lib/typegpu-renderer/typegpu-layouts.ts', 'utf8');
  const source = [rendererSource, cacheSource, pipelineSource, layoutsSource].join('\n');

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

  it('owns explicit GPU resource caches', () => {
    expect(cacheSource).toContain('GeometryResourceCache');
    expect(cacheSource).toContain('InstanceBufferCache');
    expect(cacheSource).toContain('MaterialResourceCache');
    expect(cacheSource).toContain('TextureResourceCache');
    expect(cacheSource).toContain('SamplerResourceCache');
    expect(cacheSource).toContain('PipelineResourceCache');
    expect(rendererSource).toContain('#geometryResources');
    expect(rendererSource).toContain('#instanceBuffers');
    expect(rendererSource).toContain('#materialResources');
    expect(rendererSource).toContain('#textureResources');
    expect(rendererSource).toContain('#samplerResources');
    expect(rendererSource).toContain('#pipelines');
  });

  it('prunes GPU resources from scene live keys', () => {
    expect(rendererSource).toContain('scene.liveResourceKeys.geometries');
    expect(rendererSource).toContain('scene.liveResourceKeys.materials');
    expect(rendererSource).toContain('scene.liveResourceKeys.textures');
    expect(rendererSource).toContain('scene.liveResourceKeys.samplers');
    expect(rendererSource).toContain('scene.liveResourceKeys.pipelines');
  });

  it('looks up pipelines by draw batch pipeline key', () => {
    expect(rendererSource).toContain('batch.pipelineKey');
    expect(pipelineSource).toContain('createMeshPipeline');
  });

  it('implements always, demand, and manual frame loops truthfully', () => {
    expect(rendererSource).toContain("frameloop: 'always'");
    expect(rendererSource).toContain("frameloop: 'demand'");
    expect(rendererSource).toContain("frameloop: 'manual'");
    expect(rendererSource).toContain('invalidate(): void');
    expect(rendererSource).toContain('renderFrame(timestamp?: number): void');
  });

  it('uses TypeGPU vertex layouts and vertex buffers for mesh data', () => {
    expect(layoutsSource).toContain('tgpu.vertexLayout');
    expect(cacheSource).toContain('.createBuffer(d.arrayOf(d.f32');
    expect(cacheSource).toMatch(/\.\$usage\('vertex'(?: as never)?\)/);
    expect(pipelineSource).toContain('meshVertexLayout.attrib.position');
    expect(pipelineSource).toContain('meshInstanceLayout.attrib.position');
    expect(source).not.toContain('arrayStride: MESH_VERTEX_FLOATS');
    expect(source).not.toContain('arrayStride: MESH_INSTANCE_FLOATS');
  });

  it('creates material resources through TypeGPU APIs', () => {
    expect(cacheSource).toContain('root.createTexture');
    expect(cacheSource).toContain('root.createSampler');
    expect(cacheSource).toContain('root.createBindGroup(materialBindGroupLayout');
    expect(cacheSource).toContain('.write(');
    expect(source).not.toContain('device.createTexture');
    expect(source).not.toContain('this.root.device.createTexture');
    expect(source).not.toContain('device.createSampler');
    expect(source).not.toContain('device.createBindGroup');
  });

  it('cleans up decoded texture assets if material loading fails mid-upload', () => {
    expect(cacheSource).toContain('let image: LoadedTextureImage | null = null;');
    expect(cacheSource).toContain('let texture: TypeGpuMaterialTexture | null = null;');
    expect(cacheSource).toMatch(/catch\s*{\s*texture\?\.destroy\(\);/s);
    expect(cacheSource).toMatch(/finally\s*{\s*image\?\.close\(\);\s*}/s);
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

    const image = await loadMaterialTextureImageSource({
      kind: 'url',
      src: '/textures/checker.svg'
    });

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
    expect((createdImage as FakeImage | null)?.src).toBe('');
  });

  it('decodes embedded material texture bytes without fetching', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 }))
    );
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
      })
    );

    await expect(
      loadMaterialTextureImageSource({
        kind: 'embedded',
        key: 'embedded:invalid',
        mimeType: 'image/png',
        data: new Uint8Array([0, 1, 2, 3])
      })
    ).rejects.toBeInstanceOf(Error);

    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses TypeGPU pipeline binding for material draws', () => {
    expect(rendererSource).toContain('root.createBindGroup(sceneBindGroupLayout');
    expect(pipelineSource).toMatch(/root\s*\.\s*createRenderPipeline/);
    expect(rendererSource).toContain('.with(sceneBindGroup)');
    expect(rendererSource).toContain('.with(materialResource.bindGroup)');
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

  it('treats lighting changes as buffer writes separate from mesh uploads', () => {
    expect(rendererSource).toMatch(
      /if\s*\(scene\.lightsChanged\)\s*{\s*this\.\#lightingBuffer\.write\(packLightingState\(scene\.lights\)\);?\s*}/s
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
