import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createTypeGpuRenderQueue,
  createDirectionalShadowViewProjection,
  drawTypeGpuRenderQueue,
  drawTypeGpuShaderPass,
  drawTypeGpuShadowBatch,
  loadMaterialTextureImageSource,
  pruneShaderPassPipelineCache,
  SCENE_UNIFORM_FLOATS,
  shadowBoundsForDrawBatches,
  shadowDepthForPoint
} from './gpu-renderer';
import { MESH_INSTANCE_FLOATS, MESH_ROTATION_OFFSET, MESH_VERTEX_FLOATS } from './instance-data';
import { TextureResourceCache } from './resource-caches';
import {
  normalizeShaderPassUniforms,
  packShaderPassUniforms,
  shaderPassPipelineResourceKey,
  writeShaderPassFrameUniforms
} from './shader-pass';
import type {
  TypeGpuDrawBatch,
  TypeGpuLight,
  TypeGpuShaderPass,
  TypeGpuTextureSource
} from './types';

describe('TypeGPU GPU renderer', () => {
  const rendererSource = readFileSync(new URL('./gpu-renderer.ts', import.meta.url), 'utf8');
  const cacheSource = readFileSync(new URL('./resource-caches.ts', import.meta.url), 'utf8');
  const pipelineSource = readFileSync(new URL('./typegpu-pipeline.ts', import.meta.url), 'utf8');
  const layoutsSource = readFileSync(new URL('./typegpu-layouts.ts', import.meta.url), 'utf8');
  const source = [rendererSource, cacheSource, pipelineSource, layoutsSource].join('\n');

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('allocates enough floats for the WGSL scene uniform struct alignment', () => {
    expect(SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT).toBe(96);
  });

  it('uses the mesh instance layout expected by the render pipeline', () => {
    expect(MESH_INSTANCE_FLOATS).toBe(24);
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
    expect(rendererSource).toContain('#shadowTexture');
    expect(rendererSource).toContain('#shadowBindGroup');
    expect(rendererSource).toContain('#shadowPipeline');
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

  it('keeps pipeline cache selection depth-aware when render passes omit depth', () => {
    expect(pipelineSource).toContain('depth?: boolean');
    expect(pipelineSource).toContain('if (options.depth !== false)');
    expect(cacheSource).toContain('pipelineResourceKeyFor(batch, depth)');
    expect(cacheSource).toContain('meshPipelineOptionsFor(batch, depth)');
    expect(rendererSource).toContain('pipelineResourceKeyFor(batch, scene.renderSettings.depth)');
    expect(rendererSource).toContain('this.#pipelines.getOrCreate(batch, this.#renderSettings.depth)');
  });

  it('keeps pipeline descriptors aligned with material pipeline state', () => {
    expect(pipelineSource).toContain("blendMode?: TypeGpuMaterialDescriptor['blendMode'];");
    expect(pipelineSource).toContain('cullMode?: GPUCullMode;');
    expect(pipelineSource).toContain('depthWrite?: boolean;');
    expect(pipelineSource).toContain('depthTest?: boolean;');
    expect(pipelineSource).toContain("cullMode: options.cullMode ?? 'back'");
    expect(pipelineSource).toContain('blend: blendStateFor(options.blendMode)');
    expect(pipelineSource).toContain('depthWriteEnabled: options.depthWrite !== false');
    expect(pipelineSource).toContain("depthCompare: options.depthTest === false ? 'always' : 'less'");
    expect(cacheSource).toContain("blend:${material.blendMode ?? 'opaque'}");
    expect(cacheSource).toContain('depthWrite:${material.depthWrite !== false}');
    expect(cacheSource).toContain('depthTest:${material.depthTest !== false}');
    expect(cacheSource).toContain("cull:${material.cullMode ?? 'back'}");
    expect(cacheSource).toContain("import { perlin3d } from '@typegpu/noise'");
    expect(cacheSource).toContain('perlin3d.staticCache');
    expect(cacheSource).toContain('this.root.pipe(this.#perlin3dCache.inject())');
    expect(rendererSource).toContain('this.#pipelines.dispose()');
  });

  it('uses bind-group identity for material resource caching and pruning', () => {
    expect(cacheSource).toContain('materialResourceKeyFor(material)');
    expect(cacheSource).toContain('material.bindGroupKey ?? [');
    expect(rendererSource).toContain('materialResourceKeyFor(batch.material)');
    expect(rendererSource).not.toContain('this.#materialResources.prune(scene.liveResourceKeys.materials)');
  });

  it('guards async texture settlement after prune or dispose', () => {
    expect(cacheSource).toContain('#disposed = false');
    expect(cacheSource).toMatch(/generation\s*\+=\s*1/);
    expect(cacheSource).toContain('resource.generation !== generation');
    expect(cacheSource).toContain('image.close()');
    expect(cacheSource).toContain('if (!this.#isLiveResource(resource, generation)) {');
    expect(cacheSource).toContain('this.#disposed = true');
  });

  it('keeps explicit texture resource dimensions and generation state', () => {
    expect(cacheSource).toContain('width: number;');
    expect(cacheSource).toContain('height: number;');
    expect(cacheSource).toContain('generation: number;');
    expect(cacheSource).toMatch(/status:\s*'ready'\s*\|\s*'loading'\s*\|\s*'failed'\s*\|\s*'fallback'/);
  });

  it('prunes texture and sampler resources separately from material resources', () => {
    expect(rendererSource).toContain('this.#materialResources.prune(');
    expect(rendererSource).toContain('this.#textureResources.prune(scene.liveResourceKeys.textures)');
    expect(rendererSource).toContain('this.#samplerResources.prune(scene.liveResourceKeys.samplers)');
    expect(cacheSource).toMatch(/export class TextureResourceCache[\s\S]*?prune\(liveKeys: Set<string>\): void/);
    expect(cacheSource).toMatch(/export class SamplerResourceCache[\s\S]*?prune\(liveKeys: Set<string>\): void/);
  });

  it('invalidates demand frames when texture loading settles', () => {
    expect(rendererSource).toContain('new TextureResourceCache(root, () => this.invalidate())');
    expect(cacheSource).toContain('this.onSettled()');
  });

  it('closes decoded images without creating GPU textures after stale texture prune', async () => {
    const root = createFakeRoot();
    const cache = new TextureResourceCache(root as never, vi.fn());
    const bitmapClose = vi.fn();
    const bitmap = { width: 8, height: 4, close: bitmapClose };
    const bitmapPromise = deferred<typeof bitmap>();

    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Blob(['png']), { status: 200 })));
    vi.stubGlobal('createImageBitmap', vi.fn(() => bitmapPromise.promise));

    cache.getOrLoad(urlTexture('/textures/stale-before-upload.png'));
    cache.prune(new Set());
    bitmapPromise.resolve(bitmap);
    await settleAsyncTextureLoad();

    expect(root.createdTextures).toHaveLength(1);
    expect(bitmapClose).toHaveBeenCalledOnce();
  });

  it('destroys created textures when a load becomes stale after upload', async () => {
    const root = createFakeRoot();
    const onSettled = vi.fn();
    const cache = new TextureResourceCache(root as never, onSettled);
    const source: TypeGpuTextureSource = {
      kind: 'data',
      key: 'data:test:stale-after-upload',
      src: '',
      data: new Uint8Array([255, 255, 255, 255]),
      width: 1,
      height: 1,
      format: 'rgba8unorm'
    };

    root.onNextMaterialTextureWrite = () => cache.prune(new Set());

    cache.getOrLoad(source);
    await settleAsyncTextureLoad();

    expect(root.createdTextures).toHaveLength(2);
    expect(root.createdTextures[1].destroy).toHaveBeenCalledOnce();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('keeps fallback texture state and invalidates when texture loading fails', async () => {
    const root = createFakeRoot();
    const onSettled = vi.fn();
    const cache = new TextureResourceCache(root as never, onSettled);
    const source = urlTexture('/textures/missing.png');

    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));

    const loading = cache.getOrLoad(source);
    await settleAsyncTextureLoad();
    const failed = cache.getOrLoad(source);

    expect(loading.status).toBe('failed');
    expect(failed.status).toBe('failed');
    expect(failed.texture).toBe(root.createdTextures[0]);
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('recreates depth textures when depth is toggled back on without a resize', () => {
    expect(rendererSource).toContain('const sizeChanged =');
    expect(rendererSource).toContain('const needsDepthTexture = this.#renderSettings.depth && !this.#depthTexture');
    expect(rendererSource).toContain('if (!sizeChanged && !needsDepthTexture) return;');
    expect(rendererSource).toContain('if (sizeChanged) {');
    expect(rendererSource).toContain('if (this.#renderSettings.depth && (sizeChanged || needsDepthTexture))');
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

  it('uses TypeGPU index buffers and indexed draws when geometry has indices', () => {
    expect(cacheSource).toContain(".$usage('index')");
    expect(cacheSource).toContain('indexBuffer');
    expect(rendererSource).toContain('.withIndexBuffer');
    expect(rendererSource).toContain('.drawIndexed(');
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
    expect(rendererSource).toContain('.with(shadowBindGroup)');
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

  it('uses declarative shadow resources without raw WebGPU resource creation', () => {
    expect(layoutsSource).toContain('shadowBindGroupLayout');
    expect(layoutsSource).toContain('shadowPassBindGroupLayout');
    expect(rendererSource).toContain('root.createBindGroup(shadowBindGroupLayout');
    expect(rendererSource).toContain('root.createBindGroup(shadowPassBindGroupLayout');
    expect(rendererSource).toContain('root.createBuffer(typegpuShadowSchema)');
    expect(rendererSource).toContain('root.createComparisonSampler');
    expect(rendererSource).toContain(".$usage('render', 'sampled')");
    expect(rendererSource).toContain('packShadowState');
    expect(rendererSource).toContain('createShadowPipeline');
    expect(rendererSource).toContain('shadowBindGroupLayout');
    expect(source).not.toContain('device.createTexture');
    expect(source).not.toContain('device.createSampler');
    expect(source).not.toContain('device.createBindGroup');
    expect(source).not.toContain('device.createRenderPipeline');
  });

  it('packs fullscreen shader pass built-in uniforms and reactive value slots', () => {
    const data = new Float32Array(
      packShaderPassUniforms({
        time: 1.25,
        width: 640,
        height: 360,
        uniforms: {
          value0: 0.25,
          value1: [0.5, 0.75],
          value2: [0.125, 0.375, 0.625],
          value3: [0.2, 0.4, 0.6, 0.8]
        }
      })
    );

    expect(Array.from(data)).toEqual(Array.from(Float32Array.of(
      1.25, 0, 640, 360,
      0.25, 0, 0, 0,
      0.5, 0.75, 0, 0,
      0.125, 0.375, 0.625, 0,
      0.2, 0.4, 0.6, 0.8,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0
    )));
  });

  it('normalizes supported shader pass built-ins and reactive value slots', () => {
    expect(
      normalizeShaderPassUniforms({
        time: 'time',
        resolution: 'resolution',
        value0: 0.25,
        value1: [0.5, 0.75],
        value2: [0.125, 0.375, 0.625],
        value3: [0.2, 0.4, 0.6, 0.8],
        value8: [1, 1, 1, 1],
        customTime: 'time',
        timeAlias: 'resolution',
        ignored: 'custom'
      })
    ).toEqual({
      time: 'time',
      resolution: 'resolution',
      value0: [0.25, 0, 0, 0],
      value1: [0.5, 0.75, 0, 0],
      value2: [0.125, 0.375, 0.625, 0],
      value3: [0.2, 0.4, 0.6, 0.8]
    });
  });

  it('keeps shader pass pipeline keys independent from reactive uniform values', () => {
    const fragment = shaderPassFixture({ key: 'uniform-slots' }).fragment;
    const first = shaderPassFixture({
      key: 'uniform-slots',
      fragment,
      uniforms: {
        time: 'time',
        resolution: 'resolution',
        value0: [1, 0, 0, 1]
      }
    });
    const second = shaderPassFixture({
      key: 'uniform-slots',
      fragment,
      uniforms: {
        time: 'time',
        resolution: 'resolution',
        value0: [0, 0, 1, 1]
      }
    });

    expect(shaderPassPipelineResourceKey(first, true)).toBe(
      shaderPassPipelineResourceKey(second, true)
    );
  });

  it('draws fullscreen shader passes through the TypeGPU-compatible full-screen quad pipeline', () => {
    const { pipeline, calls } = createRecordingPipeline();
    const pass = { kind: 'main-render-pass' };
    const shaderPassBindGroup = { kind: 'shader-pass-uniform-bind-group' };

    drawTypeGpuShaderPass({
      pipeline: pipeline as never,
      pass: pass as never,
      shaderPassBindGroup: shaderPassBindGroup as never
    });

    expect(calls).toEqual([[pass], [shaderPassBindGroup]]);
    expect(pipeline.draw).toHaveBeenCalledWith(6);
  });

  it('builds and draws a unified render queue ordered across meshes and shader passes', () => {
    const beforePass = shaderPassFixture({ key: 'before', renderOrder: -1 });
    const middleMesh = drawBatchFixture({ renderOrder: 0 });
    const afterPass = shaderPassFixture({ key: 'after', renderOrder: 3 });
    const queue = createTypeGpuRenderQueue([middleMesh], [afterPass, beforePass]);
    const calls: string[] = [];

    drawTypeGpuRenderQueue(queue, {
      drawMesh(batch) {
        calls.push(`mesh:${batch.renderOrder}`);
      },
      drawShaderPass(shaderPass) {
        calls.push(`shader:${shaderPass.key}`);
      }
    });

    expect(queue.map((item) => item.kind)).toEqual(['shaderPass', 'mesh', 'shaderPass']);
    expect(calls).toEqual(['shader:before', 'mesh:0', 'shader:after']);
  });

  it('uses deterministic tie-breakers when mesh batches and shader passes share renderOrder', () => {
    const firstMesh = drawBatchFixture({ renderOrder: 1, sortKey: 1 });
    const secondMesh = drawBatchFixture({ renderOrder: 1, sortKey: 0 });
    const thirdMesh = drawBatchFixture({ renderOrder: 1, sortKey: 1 });
    const firstPass = shaderPassFixture({ key: 'first-pass', renderOrder: 1, sortKey: 1 });
    const secondPass = shaderPassFixture({ key: 'second-pass', renderOrder: 1, sortKey: 0 });
    const thirdPass = shaderPassFixture({ key: 'third-pass', renderOrder: 1, sortKey: 1 });
    const queue = createTypeGpuRenderQueue(
      [firstMesh, secondMesh, thirdMesh],
      [firstPass, secondPass, thirdPass]
    );

    expect(queue.map((item) => item.kind === 'mesh' ? `mesh:${item.sourceIndex}` : item.shaderPass.key))
      .toEqual(['mesh:1', 'mesh:0', 'mesh:2', 'second-pass', 'first-pass', 'third-pass']);
  });

  it('keeps shader pass pipeline keys stable across non-shader node changes', () => {
    const fragment = shaderPassFixture({ key: 'base' }).fragment;
    const base = shaderPassFixture({
      key: 'base',
      fragment,
      renderOrder: 0,
      revision: 1
    });
    const reordered = {
      ...base,
      renderOrder: 9,
      revision: 2
    };
    const inactive = {
      ...base,
      active: false,
      revision: 3
    };
    const changedFragment = shaderPassFixture({
      key: 'base',
      fragment: shaderPassFixture({ key: 'other' }).fragment
    });

    expect(shaderPassPipelineResourceKey(base, true)).toBe(
      shaderPassPipelineResourceKey(reordered, true)
    );
    expect(shaderPassPipelineResourceKey(base, true)).toBe(
      shaderPassPipelineResourceKey(inactive, true)
    );
    expect(shaderPassPipelineResourceKey(base, true)).not.toBe(
      shaderPassPipelineResourceKey(changedFragment, true)
    );
  });

  it('prunes shader pass pipeline cache entries that are no longer live', () => {
    const fragment = shaderPassFixture({ key: 'live' }).fragment;
    const live = shaderPassFixture({ key: 'live', fragment, renderOrder: 0, revision: 1 });
    const reordered = { ...live, renderOrder: 9, revision: 2 };
    const stale = shaderPassFixture({
      key: 'stale',
      fragment: shaderPassFixture({ key: 'stale-fragment' }).fragment
    });
    const liveKey = shaderPassPipelineResourceKey(live, true);
    const staleKey = shaderPassPipelineResourceKey(stale, true);
    const otherDepthKey = shaderPassPipelineResourceKey(live, false);
    const livePipeline = { kind: 'live-pipeline' };
    const cache = new Map<string, unknown>([
      [liveKey, livePipeline],
      [staleKey, { kind: 'stale-pipeline' }],
      [otherDepthKey, { kind: 'other-depth-pipeline' }]
    ]);

    pruneShaderPassPipelineCache(cache, [reordered], true);

    expect([...cache.entries()]).toEqual([[liveKey, livePipeline]]);
  });

  it('clears shader pass pipeline cache on renderer disposal', () => {
    expect(rendererSource).toMatch(
      /dispose\(\): void \{[\s\S]*this\.\#shaderPassPipelines\.clear\(\);/s
    );
  });

  it('writes updated shader pass resolution uniforms for each render size', () => {
    const writes: number[][] = [];
    const buffer = {
      write(data: ArrayBuffer) {
        writes.push(Array.from(new Float32Array(data)));
      }
    };

    writeShaderPassFrameUniforms(buffer, {
      time: 0.5,
      renderSize: { width: 320, height: 180 },
      uniforms: { value0: [1, 0, 0, 1] }
    });
    writeShaderPassFrameUniforms(buffer, {
      time: 0.75,
      renderSize: { width: 640, height: 360 },
      uniforms: { value1: [0, 0, 1, 1] }
    });

    expect(writes).toEqual([
      [0.5, 0, 320, 180, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      [0.75, 0, 640, 360, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    ]);
  });

  it('binds only the shadow-pass uniform group while drawing the shadow depth pass', () => {
    const { pipeline, calls } = createRecordingPipeline();
    const pass = { kind: 'shadow-pass' };
    const shadowPassBindGroup = { kind: 'shadow-pass-uniform-bind-group' };
    const sampledShadowBindGroup = { kind: 'shadow-sampled-bind-group' };

    drawTypeGpuShadowBatch({
      pipeline: pipeline as never,
      pass: pass as never,
      shadowPassBindGroup: shadowPassBindGroup as never,
      geometryResource: {
        key: 'box',
        vertexBuffer: { buffer: { kind: 'vertices' } },
        vertexCount: 3
      } as never,
      instanceResource: {
        key: 'instances',
        buffer: { buffer: { kind: 'instances' } },
        byteLength: MESH_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
        instanceCount: 1
      } as never,
      batch: drawBatchFixture()
    });

    expect(calls.map((call) => call[0])).toContain(pass);
    expect(calls.map((call) => call[0])).toContain(shadowPassBindGroup);
    expect(calls.map((call) => call[0])).not.toContain(sampledShadowBindGroup);
    expect(calls).not.toContainEqual([undefined]);
    expect(pipeline.draw).toHaveBeenCalledWith(3, 1);
  });

  it('renders the shadow pass before the main material pass and filters non-casters', () => {
    const shadowPassIndex = rendererSource.indexOf('beginTypeGpuShadowPass');
    const mainPassIndex = rendererSource.indexOf('beginTypeGpuRenderPass');

    expect(shadowPassIndex).toBeGreaterThanOrEqual(0);
    expect(mainPassIndex).toBeGreaterThan(shadowPassIndex);
    expect(rendererSource).toContain('if (!batch.castShadow) continue;');
    expect(rendererSource).toContain('drawTypeGpuShadowBatch');
    expect(rendererSource).toContain('shadowPassBindGroup: this.#shadowPassBindGroup');
  });

  it('recreates and destroys the shadow map texture when the declarative map size changes', () => {
    expect(rendererSource).toContain('this.#shadowMapSize !== mapSize');
    expect(rendererSource).toContain('this.#shadowTexture?.destroy()');
    expect(rendererSource).toMatch(/size:\s*\[mapSize,\s*mapSize\]/);
    expect(rendererSource).toContain('this.#shadowTexture?.destroy();');
  });

  it('computes WebGPU 0..1 shadow depths consistently for caster and receiver points', () => {
    const matrix = createDirectionalShadowViewProjection(
      lightFixture({ direction: [0, -1, 0] }),
      [drawBatchFixture()]
    );
    const casterDepth = shadowDepthForPoint(matrix, [0, 1, 0]);
    const receiverDepth = shadowDepthForPoint(matrix, [0, 0, 0]);
    const occludedDepth = shadowDepthForPoint(matrix, [0, -1, 0]);

    expect(casterDepth).toBeGreaterThanOrEqual(0);
    expect(occludedDepth).toBeLessThanOrEqual(1);
    expect(casterDepth).toBeLessThan(receiverDepth);
    expect(receiverDepth).toBeLessThan(occludedDepth);
    expect(shadowDepthForPoint(matrix, [0, 0, 0])).toBeCloseTo(receiverDepth);
  });

  it('keeps the directional shadow projection continuous near vertical light directions', () => {
    const leftOfUp = createDirectionalShadowViewProjection(
      lightFixture({ direction: [0.22, -0.7, 0] }),
      [drawBatchFixture()]
    );
    const rightOfUp = createDirectionalShadowViewProjection(
      lightFixture({ direction: [0.24, -0.7, 0] }),
      [drawBatchFixture()]
    );
    const leftPoint = shadowClipPoint(leftOfUp, [0.5, 0, 0.5]);
    const rightPoint = shadowClipPoint(rightOfUp, [0.5, 0, 0.5]);

    expect(Math.abs(leftPoint[0] - rightPoint[0])).toBeLessThan(0.05);
    expect(Math.abs(leftPoint[1] - rightPoint[1])).toBeLessThan(0.05);
  });

  it('uses conservative shadow bounds that include instance scale and rotations', () => {
    const batch = drawBatchFixture({
      geometryBounds: {
        min: [-5, -0.25, -0.25],
        max: [5, 0.25, 0.25]
      },
      rotation: [0, Math.PI / 2, 0]
    });

    const bounds = shadowBoundsForDrawBatches([batch]);

    expect(bounds).not.toBeNull();
    expect(bounds!.min[2]).toBeLessThanOrEqual(-5);
    expect(bounds!.max[2]).toBeGreaterThanOrEqual(5);
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
    expect(drawCallScopes).toEqual([
      'drawTypeGpuMaterialBatch',
      'drawTypeGpuShadowBatch',
      'drawTypeGpuShaderPass'
    ]);
  });
});

function shadowClipPoint(
  matrix: Float32Array,
  point: [number, number, number]
): [number, number, number] {
  const [x, y, z] = point;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

  return [
    (matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12]) / w,
    (matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13]) / w,
    (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w
  ];
}

function urlTexture(src: string): TypeGpuTextureSource {
  return {
    kind: 'url',
    key: `url:${src}`,
    src
  };
}

function createRecordingPipeline() {
  const calls: unknown[][] = [];
  const pipeline = {
    with: vi.fn((...args: unknown[]) => {
      calls.push(args);
      return pipeline;
    }),
    withIndexBuffer: vi.fn((...args: unknown[]) => {
      calls.push(args);
      return pipeline;
    }),
    draw: vi.fn(),
    drawIndexed: vi.fn()
  };

  return { pipeline, calls };
}

function lightFixture(overrides: Partial<TypeGpuLight> = {}): TypeGpuLight {
  return {
    id: 1,
    revision: 1,
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 2, 0],
    direction: [0, -1, 0],
    range: 0,
    decay: 2,
    angle: Math.PI / 6,
    penumbra: 0,
    groundColor: [0, 0, 0],
    castsShadow: true,
    shadowIndex: 0,
    shadowMapSize: 1024,
    shadowBias: 0.0005,
    shadowSlopeBias: 1.5,
    ...overrides
  };
}

function shaderPassFixture(overrides: Partial<TypeGpuShaderPass> = {}): TypeGpuShaderPass {
  const fragment = {} as TypeGpuShaderPass['fragment'];

  return {
    key: 'shader-pass',
    node: {} as never,
    revision: 1,
    fragment,
    uniforms: { time: 'time', resolution: 'resolution' },
    active: true,
    renderOrder: 0,
    sortKey: 0,
    ...overrides
  };
}

function drawBatchFixture({
  geometryBounds = { min: [-1, -1, -1], max: [1, 1, 1] },
  position = [0, 0, 0],
  scale = [1, 1, 1],
  rotation = [0, 0, 0],
  renderOrder = 0,
  sortKey = 0,
  material = {}
}: {
  geometryBounds?: { min: [number, number, number]; max: [number, number, number] };
  position?: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
  renderOrder?: number;
  sortKey?: number;
  material?: Partial<TypeGpuDrawBatch['material']>;
} = {}): TypeGpuDrawBatch {
  const instances = new Float32Array(MESH_INSTANCE_FLOATS);
  instances[0] = position[0];
  instances[1] = position[1];
  instances[2] = position[2];
  instances[8] = scale[0];
  instances[9] = scale[1];
  instances[10] = scale[2];
  instances[13] = rotation[0];
  instances[14] = rotation[1];
  instances[15] = rotation[2];

  return {
    key: 'pass:main|pipeline:standard:opaque|material:standard:white|bind:solid|box|order:0|shadow:cast',
    passKey: 'pass:main',
    pipelineKey: 'pipeline:standard:opaque',
    materialKey: 'material:standard:white',
    bindGroupKey: 'bind:solid',
    geometryKey: 'box',
    geometry: {
      key: 'box',
      vertexData: new Float32Array(MESH_VERTEX_FLOATS * 3),
      vertexCount: 3,
      vertexFloats: MESH_VERTEX_FLOATS,
      bounds: geometryBounds
    },
    material: {
      kind: 'standard',
      color: [1, 1, 1, 1],
      roughness: 0.45,
      metalness: 0.05,
      opacity: 1,
      textureKey: 'solid:white',
      samplerKey: 'sampler:default',
      transparent: false,
      depthWrite: true,
      depthTest: true,
      cullMode: 'back',
      blendMode: 'opaque',
      map: null,
      ...material
    } as TypeGpuDrawBatch['material'],
    castShadow: true,
    renderOrder,
    floatsPerInstance: MESH_INSTANCE_FLOATS,
    instances,
    instanceIds: ['a'],
    instanceCount: 1,
    instancesChanged: true,
    dirtyRanges: [{ start: 0, count: 1 }],
    sortKey
  };
}

function createFakeRoot() {
  const root = {
    createdTextures: [] as FakeTexture[],
    onNextMaterialTextureWrite: null as (() => void) | null,
    createTexture() {
      const index = root.createdTextures.length;
      const texture: FakeTexture = {
        write: vi.fn(() => {
          if (index > 0) {
            root.onNextMaterialTextureWrite?.();
            root.onNextMaterialTextureWrite = null;
          }
        }),
        destroy: vi.fn(),
        $usage: vi.fn(() => texture),
        $name: vi.fn(() => texture)
      };
      root.createdTextures.push(texture);
      return texture;
    }
  };

  return root;
}

type FakeTexture = {
  write: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  $usage: ReturnType<typeof vi.fn>;
  $name: ReturnType<typeof vi.fn>;
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

async function settleAsyncTextureLoad(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
}
