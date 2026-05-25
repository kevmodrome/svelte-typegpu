import tgpu, {
  type RenderFlag,
  type SampledFlag,
  type TgpuBindGroup,
  type TgpuBuffer,
  type TgpuFixedComparisonSampler,
  type TgpuRoot,
  type TgpuTexture,
  type UniformFlag
} from 'typegpu';
import { createFpsMeter } from './fps-meter';
import { createViewProjectionMatrix } from './camera-math';
import { createContinuityTracker } from './continuity';
import { Dirty } from './dirty';
import {
  MESH_SPIN_OFFSET_OFFSET,
  MESH_SPIN_SPEED_OFFSET
} from './instance-data';
import { packLightingState } from './lighting-data';
import {
  add3,
  lookAtMatrix,
  multiply4,
  normalize3,
  orthographicMatrix,
  scale3
} from './math3d';
import { DEPTH_FORMAT } from './render-constants';
import {
  GeometryResourceCache,
  InstanceBufferCache,
  MaterialResourceCache,
  PipelineResourceCache,
  SamplerResourceCache,
  TextureResourceCache,
  loadMaterialTextureImageSource,
  materialResourceKeyFor,
  pipelineResourceKeyFor,
  type LoadedTextureImage,
  type TypeGpuInstanceBufferResource,
  type TypeGpuMaterialResource,
  type TypeGpuVertexBufferResource
} from './resource-caches';
import { createMeshPipeline, createShadowPipeline } from './typegpu-pipeline';
import {
  lightingBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout,
  shadowBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  typegpuLightingSchema,
  typegpuShadowSchema,
  typegpuSceneUniformSchema
} from './typegpu-layouts';
import type {
  RgbaTuple,
  TypeGpuCameraSettings,
  TypeGpuDrawBatch,
  TypeGpuInstanceDirtyRange,
  TypeGpuLight,
  TypeGpuRenderSettings,
  TypeGpuSceneState,
  Vector3Tuple
} from './types';

export { loadMaterialTextureImageSource, type LoadedTextureImage };

// Keep the TypeGPU scene uniform buffer at 96 bytes, matching the explicit padding schema.
export const SCENE_UNIFORM_FLOATS = TYPEGPU_SCENE_UNIFORM_FLOATS;

const DEGREES_TO_RADIANS = Math.PI / 180;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const DEFAULT_SHADOW_CAMERA_RADIUS = 10;
const DEFAULT_TYPEGPU_CAMERA: TypeGpuCameraSettings = {
  projection: 'perspective',
  position: [9, 7, 13],
  target: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

const FRAMELOOP_OPTIONS = {
  always: { frameloop: 'always' },
  demand: { frameloop: 'demand' },
  manual: { frameloop: 'manual' }
} as const;

type TypeGpuFrameLoop = keyof typeof FRAMELOOP_OPTIONS;
type TypeGpuSceneUniformBuffer = TgpuBuffer<typeof typegpuSceneUniformSchema> & UniformFlag;
type TypeGpuLightingUniformBuffer = TgpuBuffer<typeof typegpuLightingSchema> & UniformFlag;
type TypeGpuShadowUniformBuffer = TgpuBuffer<typeof typegpuShadowSchema> & UniformFlag;
type TypeGpuDepthTexture = TgpuTexture & RenderFlag;
type TypeGpuShadowTexture = TgpuTexture & RenderFlag & SampledFlag;
type TypeGpuMeshPipeline = ReturnType<typeof createMeshPipeline>;
type TypeGpuShadowPipeline = ReturnType<typeof createShadowPipeline>;

interface TypeGpuActiveShadow {
  light: TypeGpuLight;
  viewProjection: Float32Array;
}

export interface TypeGpuRenderer {
  setScene(scene: TypeGpuSceneState): void;
  setCamera(camera: TypeGpuCameraSettings): void;
  invalidate(): void;
  renderFrame(timestamp?: number): void;
  getRenderSize(): { width: number; height: number };
  dispose(): void;
}

export interface TypeGpuRendererOptions {
  canvas: HTMLCanvasElement;
  onFps?: (fps: number) => void;
  frameloop?: 'always' | 'demand' | 'manual';
  maxDevicePixelRatio?: number;
  clearColor?: RgbaTuple;
  depth?: boolean;
  alphaMode?: GPUCanvasAlphaMode;
}

export async function createTypeGpuRenderer({
  canvas,
  onFps = () => {},
  frameloop = FRAMELOOP_OPTIONS.always.frameloop,
  maxDevicePixelRatio = MAX_DEVICE_PIXEL_RATIO,
  clearColor = [0, 0, 0, 1],
  depth = true,
  alphaMode = 'premultiplied'
}: TypeGpuRendererOptions): Promise<TypeGpuRenderer> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const root = await tgpu.init({ unstable_names: 'strict' });

  return new TypeGpuSceneRenderer(root, {
    canvas,
    onFps,
    frameloop,
    maxDevicePixelRatio,
    clearColor,
    depth,
    alphaMode
  });
}

class TypeGpuSceneRenderer implements TypeGpuRenderer {
  #animationOffset = 0;
  #animationSpeed = 1;
  #camera = { ...DEFAULT_TYPEGPU_CAMERA };
  #colorShift = 0;
  #context: GPUCanvasContext;
  #continuity = createContinuityTracker();
  #depthTexture: TypeGpuDepthTexture | null = null;
  #disposed = false;
  #drawBatches: TypeGpuDrawBatch[] = [];
  #fpsMeter;
  #frame: number | null = null;
  #geometryResources: GeometryResourceCache;
  #instanceBuffers: InstanceBufferCache;
  #lastTimestamp = 0;
  #lightingBindGroup: TgpuBindGroup<typeof lightingBindGroupLayout.entries>;
  #lightingBuffer: TypeGpuLightingUniformBuffer;
  #lights: TypeGpuLight[] = [];
  #materialResources: MaterialResourceCache;
  #pipelines: PipelineResourceCache;
  #projectionDirty = true;
  #renderSettings: TypeGpuRenderSettings;
  #renderSize = { width: 0, height: 0 };
  #resizeObserver: ResizeObserver | null = null;
  #samplerResources: SamplerResourceCache;
  #scale = 1;
  #sceneBindGroup: TgpuBindGroup<typeof sceneBindGroupLayout.entries>;
  #shadowBindGroup: TgpuBindGroup<typeof shadowBindGroupLayout.entries>;
  #shadowBuffer: TypeGpuShadowUniformBuffer;
  #shadowMapSize = 0;
  #shadowPipeline: TypeGpuShadowPipeline | null = null;
  #shadowPipelineKey = '';
  #shadowSampler: TgpuFixedComparisonSampler;
  #shadowTexture: TypeGpuShadowTexture;
  #textureResources: TextureResourceCache;
  #time = 0;
  #uniformBuffer: TypeGpuSceneUniformBuffer;
  #uniformData = new Float32Array(SCENE_UNIFORM_FLOATS);

  readonly #format: GPUTextureFormat;
  readonly #frameloop: TypeGpuFrameLoop;
  readonly #maxDevicePixelRatio: number;
  readonly #onFps: (fps: number) => void;

  constructor(
    private readonly root: TgpuRoot,
    private readonly options: Required<TypeGpuRendererOptions>
  ) {
    this.#format = navigator.gpu.getPreferredCanvasFormat();
    this.#frameloop = normalizeFrameloop(options.frameloop);
    this.#maxDevicePixelRatio = options.maxDevicePixelRatio;
    this.#onFps = options.onFps;
    this.#renderSettings = {
      clearColor: options.clearColor,
      depth: options.depth,
      alphaMode: options.alphaMode
    };
    this.#context = this.#configureContext();
    this.#fpsMeter = createFpsMeter((fps) => this.#onFps(fps));
    this.#uniformBuffer = root
      .createBuffer(typegpuSceneUniformSchema)
      .$usage('uniform')
      .$name('TypeGPU scene uniforms');
    this.#lightingBuffer = root.createBuffer(typegpuLightingSchema)
      .$usage('uniform')
      .$name('TypeGPU lighting uniforms');
    this.#lightingBindGroup = root.createBindGroup(lightingBindGroupLayout, {
      lighting: this.#lightingBuffer
    });
    this.#sceneBindGroup = root.createBindGroup(sceneBindGroupLayout, { scene: this.#uniformBuffer });
    this.#shadowBuffer = root.createBuffer(typegpuShadowSchema)
      .$usage('uniform')
      .$name('TypeGPU shadow uniforms');
    this.#shadowSampler = root.createComparisonSampler({
      compare: 'less-equal',
      magFilter: 'linear',
      minFilter: 'linear',
      addressModeU: 'clamp-to-edge',
      addressModeV: 'clamp-to-edge',
      addressModeW: 'clamp-to-edge'
    });
    this.#shadowTexture = this.#createShadowTexture(1);
    this.#shadowBindGroup = this.#createShadowBindGroup(this.#shadowTexture);
    this.#geometryResources = new GeometryResourceCache(root);
    this.#instanceBuffers = new InstanceBufferCache(root);
    this.#textureResources = new TextureResourceCache(root, () => this.invalidate());
    this.#samplerResources = new SamplerResourceCache(root);
    this.#materialResources = new MaterialResourceCache(
      root,
      this.#textureResources,
      this.#samplerResources
    );
    this.#pipelines = new PipelineResourceCache(root, this.#format);
    this.#resizeObserver = this.#createResizeObserver();
    this.setScene({
      dirty: Dirty.None,
      camera: DEFAULT_TYPEGPU_CAMERA,
      cameraNode: null,
      cameraControllerNode: null,
      cameraController: null,
      renderSettings: this.#renderSettings,
      scale: 1,
      animationSpeed: 1,
      colorShift: 0,
      lights: [],
      lightsChanged: true,
      drawBatches: [],
      drawBatchesChanged: true,
      interaction: {
        targets: [],
        pick: () => null
      },
      interactionChanged: true,
      liveResourceKeys: {
        geometries: new Set(),
        materials: new Set(),
        textures: new Set(),
        samplers: new Set(),
        pipelines: new Set()
      }
    });
  }

  setScene(scene: TypeGpuSceneState): void {
    if (this.#disposed) return;

    this.setCamera(scene.camera);
    this.#updateRenderSettings(scene.renderSettings);
    this.#scale = scene.scale;
    this.#setAnimationSpeed(scene.animationSpeed);
    this.#colorShift = scene.colorShift;
    this.#lights = scene.lights;
    this.#drawBatches = scene.drawBatches;
    this.#continuity.prune(this.#drawBatches.flatMap((batch) => batch.instanceIds));

    if (scene.lightsChanged) {
      this.#lightingBuffer.write(packLightingState(scene.lights));
    }

    for (const batch of scene.drawBatches) {
      this.#geometryResources.getOrCreate(batch);
      this.#textureResources.getOrLoad(batch.material.map ?? batch.material.texture ?? null);
      this.#samplerResources.getOrCreate(batch.material.sampler ?? {
        key: batch.material.samplerKey ?? 'sampler:default',
        magFilter: 'linear',
        minFilter: 'linear',
        mipmapFilter: 'linear',
        addressModeU: 'repeat',
        addressModeV: 'repeat',
        addressModeW: 'repeat'
      });
      this.#materialResources.getOrCreate(batch.material);
      this.#pipelines.getOrCreate(batch, scene.renderSettings.depth);

      const instanceResource = this.#instanceBuffers.getOrCreate(batch);

      if (batch.instancesChanged || !instanceResource.buffer) {
        const dirtyRanges = batch.dirtyRanges.length
          ? batch.dirtyRanges
          : batch.instanceCount > 0
            ? [{ start: 0, count: batch.instanceCount }]
            : [];

        this.#instanceBuffers.upload(batch, this.#applyContinuity(batch, dirtyRanges));
      } else {
        instanceResource.instanceCount = batch.instanceCount;
      }
    }

    this.#geometryResources.prune(scene.liveResourceKeys.geometries);
    this.#materialResources.prune(
      new Set(
        scene.drawBatches
          .filter((batch) => scene.liveResourceKeys.materials.has(batch.materialKey))
          .map((batch) => materialResourceKeyFor(batch.material))
      )
    );
    this.#textureResources.prune(scene.liveResourceKeys.textures);
    this.#samplerResources.prune(scene.liveResourceKeys.samplers);
    this.#pipelines.prune(
      new Set(
        scene.drawBatches
          .filter((batch) => scene.liveResourceKeys.pipelines.has(batch.pipelineKey))
          .map((batch) => pipelineResourceKeyFor(batch, scene.renderSettings.depth))
      )
    );
    this.#instanceBuffers.prune(new Set(scene.drawBatches.map((batch) => batch.key)));
    this.invalidate();
  }

  setCamera(camera: TypeGpuCameraSettings): void {
    if (this.#disposed) return;

    this.#camera = camera;
    this.#projectionDirty = true;
    this.invalidate();
  }

  invalidate(): void {
    if (this.#disposed || this.#frameloop === 'manual' || this.#frame !== null) return;

    this.#frame = requestAnimationFrame((timestamp) => this.#onAnimationFrame(timestamp));
  }

  renderFrame(timestamp = typeof performance === 'undefined' ? 0 : performance.now()): void {
    if (this.#disposed) return;

    const delta = this.#lastTimestamp ? Math.min(48, timestamp - this.#lastTimestamp) : 0;
    this.#lastTimestamp = timestamp;
    this.#time += (delta / 16.67) * 0.018;

    this.#resize();
    this.#writeUniforms();
    const activeShadow = this.#activeShadow();

    this.#prepareShadowResources(activeShadow);
    this.#shadowBuffer.write(packShadowState(activeShadow));

    if (activeShadow) {
      const shadowPipeline = this.#shadowPipelineFor(activeShadow.light);

      beginTypeGpuShadowPass({
        root: this.root,
        shadowTexture: this.#shadowTexture,
        draw: (pass) => {
          for (const batch of this.#drawBatches) {
            if (!batch.castShadow) continue;

            const geometryResource = this.#geometryResources.getOrCreate(batch);
            const instanceResource = this.#instanceBuffers.getOrCreate(batch);

            if (!instanceResource.buffer || instanceResource.instanceCount === 0) continue;

            drawTypeGpuShadowBatch({
              pipeline: shadowPipeline,
              pass,
              sceneBindGroup: this.#sceneBindGroup,
              shadowBindGroup: this.#shadowBindGroup,
              geometryResource,
              instanceResource,
              batch
            });
          }
        }
      });
    }

    beginTypeGpuRenderPass({
      root: this.root,
      context: this.#context,
      clearColor: this.#renderSettings.clearColor,
      depthTexture: this.#renderSettings.depth ? this.#depthTexture : null,
      draw: (pass) => {
        for (const batch of this.#drawBatches) {
          const geometryResource = this.#geometryResources.getOrCreate(batch);
          const instanceResource = this.#instanceBuffers.getOrCreate(batch);
          const materialResource = this.#materialResources.getOrCreate(batch.material);
          const pipeline = this.#pipelineForBatch(batch, this.#renderSettings.depth);

          if (!instanceResource.buffer || instanceResource.instanceCount === 0) continue;

          drawTypeGpuMaterialBatch({
            pipeline,
            pass,
            sceneBindGroup: this.#sceneBindGroup,
            lightingBindGroup: this.#lightingBindGroup,
            shadowBindGroup: this.#shadowBindGroup,
            geometryResource,
            instanceResource,
            materialResource,
            batch
          });
        }
      }
    });

    this.#fpsMeter.record(timestamp);
  }

  getRenderSize(): { width: number; height: number } {
    return { ...this.#renderSize };
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;

    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }

    this.#resizeObserver?.disconnect();
    this.#depthTexture?.destroy();
    this.#shadowTexture?.destroy();
    this.#geometryResources.dispose();
    this.#instanceBuffers.dispose();
    this.#materialResources.dispose();
    this.#textureResources.dispose();
    this.#lightingBuffer.destroy();
    this.#shadowBuffer.destroy();
    this.#uniformBuffer.destroy();
    this.root.destroy();
  }

  #onAnimationFrame(timestamp: number): void {
    this.#frame = null;
    this.renderFrame(timestamp);

    if (!this.#disposed && this.#frameloop === 'always') {
      this.invalidate();
    }
  }

  #configureContext(): GPUCanvasContext {
    return this.root.configureContext({
      canvas: this.options.canvas,
      format: this.#format,
      alphaMode: this.#renderSettings.alphaMode
    });
  }

  #createResizeObserver(): ResizeObserver | null {
    if (this.#frameloop !== 'demand' || typeof ResizeObserver === 'undefined') return null;

    const observer = new ResizeObserver(() => this.invalidate());
    observer.observe(this.options.canvas);
    return observer;
  }

  #updateRenderSettings(settings: TypeGpuRenderSettings): void {
    const alphaModeChanged = this.#renderSettings.alphaMode !== settings.alphaMode;
    const depthChanged = this.#renderSettings.depth !== settings.depth;

    this.#renderSettings = settings;

    if (alphaModeChanged) {
      this.#context = this.#configureContext();
    }

    if (depthChanged) {
      this.#depthTexture?.destroy();
      this.#depthTexture = null;
      this.#projectionDirty = true;
    }
  }

  #activeShadow(): TypeGpuActiveShadow | null {
    const light = this.#lights.find(
      (candidate) =>
        candidate.kind === 'directional' &&
        candidate.castsShadow &&
        candidate.shadowIndex === 0
    );

    if (!light) return null;

    return {
      light,
      viewProjection: createDirectionalShadowViewProjection(light, this.#drawBatches)
    };
  }

  #prepareShadowResources(activeShadow: TypeGpuActiveShadow | null): void {
    const mapSize = activeShadow?.light.shadowMapSize ?? 1;

    if (this.#shadowMapSize !== mapSize) {
      this.#shadowTexture?.destroy();
      this.#shadowTexture = this.#createShadowTexture(mapSize);
      this.#shadowMapSize = mapSize;
      this.#shadowBindGroup = this.#createShadowBindGroup(this.#shadowTexture);
    }
  }

  #createShadowTexture(mapSize: number): TypeGpuShadowTexture {
    const root = this.root;
    const texture = root
      .createTexture({
        size: [mapSize, mapSize],
        format: DEPTH_FORMAT,
        dimension: '2d'
      })
      .$usage('render', 'sampled')
      .$name(`TypeGPU shadow map ${mapSize}x${mapSize}`);

    this.#shadowMapSize = mapSize;
    return texture;
  }

  #createShadowBindGroup(
    shadowTexture: TypeGpuShadowTexture
  ): TgpuBindGroup<typeof shadowBindGroupLayout.entries> {
    const root = this.root;

    return root.createBindGroup(shadowBindGroupLayout, {
      shadow: this.#shadowBuffer,
      shadowMap: shadowTexture,
      shadowSampler: this.#shadowSampler
    });
  }

  #shadowPipelineFor(light: TypeGpuLight): TypeGpuShadowPipeline {
    const key = [
      'shadow',
      `bias:${light.shadowBias}`,
      `slope:${light.shadowSlopeBias}`
    ].join('|');

    if (!this.#shadowPipeline || this.#shadowPipelineKey !== key) {
      this.#shadowPipeline = createShadowPipeline(this.root, {
        depthBias: light.shadowBias,
        depthBiasSlopeScale: light.shadowSlopeBias
      });
      this.#shadowPipelineKey = key;
    }

    return this.#shadowPipeline;
  }

  #pipelineForBatch(batch: TypeGpuDrawBatch, depth: boolean): TypeGpuMeshPipeline {
    const pipelineKey = batch.pipelineKey;

    if (!pipelineKey) {
      return this.#pipelines.getOrCreate(batch, depth);
    }

    return this.#pipelines.getOrCreate(batch, depth);
  }

  #setAnimationSpeed(nextSpeed: number): void {
    if (this.#animationSpeed === nextSpeed) return;

    this.#animationOffset += this.#time * (this.#animationSpeed - nextSpeed);
    this.#animationSpeed = nextSpeed;
  }

  #applyContinuity(
    batch: TypeGpuDrawBatch,
    dirtyRanges: TypeGpuInstanceDirtyRange[]
  ): TypeGpuInstanceDirtyRange[] {
    for (const range of dirtyRanges) {
      const end = Math.min(batch.instanceIds.length, range.start + range.count);

      for (let index = range.start; index < end; index += 1) {
        const offset = index * batch.floatsPerInstance;
        const animationTime = this.#time * this.#animationSpeed + this.#animationOffset;

        batch.instances[offset + MESH_SPIN_OFFSET_OFFSET] = this.#continuity.offsetFor({
          key: batch.instanceIds[index],
          rate: batch.instances[offset + MESH_SPIN_SPEED_OFFSET],
          time: animationTime
        });
      }
    }

    return dirtyRanges;
  }

  #resize(): void {
    const canvas = this.options.canvas;
    const dpr = Math.min(this.#maxDevicePixelRatio, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor((canvas.clientWidth || canvas.width || 1) * dpr));
    const height = Math.max(1, Math.floor((canvas.clientHeight || canvas.height || 1) * dpr));
    const sizeChanged = this.#renderSize.width !== width || this.#renderSize.height !== height;
    const needsDepthTexture = this.#renderSettings.depth && !this.#depthTexture;

    if (!sizeChanged && !needsDepthTexture) return;

    if (sizeChanged) {
      canvas.width = width;
      canvas.height = height;
      this.#renderSize = { width, height };
      this.#depthTexture?.destroy();
      this.#depthTexture = null;
      this.#projectionDirty = true;
    }

    if (this.#renderSettings.depth && (sizeChanged || needsDepthTexture)) {
      const root = this.root;
      this.#depthTexture = root
        .createTexture({
          size: [width, height],
          format: DEPTH_FORMAT,
          dimension: '2d'
        })
        .$usage('render')
        .$name('TypeGPU depth texture');
    }
  }

  #writeUniforms(): void {
    if (this.#projectionDirty) {
      const aspect = this.#renderSize.width / this.#renderSize.height || 1;
      this.#uniformData.set(createViewProjectionMatrix(aspect, this.#camera), 0);
      this.#projectionDirty = false;
    }

    this.#uniformData[16] = this.#time;
    this.#uniformData[17] = this.#scale;
    this.#uniformData[18] = this.#animationSpeed;
    this.#uniformData[19] = this.#animationOffset;
    this.#uniformData[20] = this.#colorShift * DEGREES_TO_RADIANS;
    this.#uniformBuffer.write(arrayBufferFor(this.#uniformData));
  }
}

function beginTypeGpuRenderPass({
  root,
  context,
  clearColor,
  depthTexture,
  draw
}: {
  root: TgpuRoot;
  context: GPUCanvasContext;
  clearColor: RgbaTuple;
  depthTexture: TypeGpuDepthTexture | null;
  draw(pass: GPURenderPassEncoder): void;
}): void {
  const commandEncoder = root.device.createCommandEncoder();
  const descriptor: GPURenderPassDescriptor = {
    colorAttachments: [
      {
        view: context.getCurrentTexture().createView(),
        loadOp: 'clear',
        storeOp: 'store',
        clearValue: {
          r: clearColor[0],
          g: clearColor[1],
          b: clearColor[2],
          a: clearColor[3]
        }
      }
    ]
  };

  if (depthTexture) {
    descriptor.depthStencilAttachment = {
      view: root.unwrap(depthTexture).createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store'
    };
  }

  const pass = commandEncoder.beginRenderPass(descriptor);
  let shouldSubmit = false;

  // Bare TypeGPU draw() creates and submits a render pass per call. This helper owns
  // the raw pass lifetime so a frame gets one color clear, one depth clear, and many
  // pass-bound TypeGPU draws without using raw WebGPU for material resources.
  try {
    draw(pass);
    shouldSubmit = true;
  } finally {
    pass.end();
  }

  if (shouldSubmit) {
    root.device.queue.submit([commandEncoder.finish()]);
  }
}

function beginTypeGpuShadowPass({
  root,
  shadowTexture,
  draw
}: {
  root: TgpuRoot;
  shadowTexture: TypeGpuShadowTexture;
  draw(pass: GPURenderPassEncoder): void;
}): void {
  const commandEncoder = root.device.createCommandEncoder();
  const pass = commandEncoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: root.unwrap(shadowTexture).createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store'
    }
  });
  let shouldSubmit = false;

  try {
    draw(pass);
    shouldSubmit = true;
  } finally {
    pass.end();
  }

  if (shouldSubmit) {
    root.device.queue.submit([commandEncoder.finish()]);
  }
}

function drawTypeGpuMaterialBatch({
  pipeline,
  pass,
  sceneBindGroup,
  lightingBindGroup,
  shadowBindGroup,
  geometryResource,
  instanceResource,
  materialResource,
  batch
}: {
  pipeline: TypeGpuMeshPipeline;
  pass: GPURenderPassEncoder;
  sceneBindGroup: TgpuBindGroup<typeof sceneBindGroupLayout.entries>;
  lightingBindGroup: TgpuBindGroup<typeof lightingBindGroupLayout.entries>;
  shadowBindGroup: TgpuBindGroup<typeof shadowBindGroupLayout.entries>;
  geometryResource: TypeGpuVertexBufferResource;
  instanceResource: TypeGpuInstanceBufferResource;
  materialResource: TypeGpuMaterialResource;
  batch: TypeGpuDrawBatch;
}): void {
  if (!instanceResource.buffer) return;

  const passPipeline = pipeline.with(pass).with(sceneBindGroup).with(lightingBindGroup).with(shadowBindGroup);
  const materialPipeline = passPipeline
    .with(materialResource.bindGroup)
    .with(meshVertexLayout, geometryResource.vertexBuffer.buffer)
    .with(meshInstanceLayout, instanceResource.buffer.buffer);

  if (geometryResource.indexBuffer && geometryResource.indexCount && geometryResource.indexFormat) {
    materialPipeline
      .withIndexBuffer(geometryResource.indexBuffer.buffer, geometryResource.indexFormat)
      .drawIndexed(geometryResource.indexCount, instanceResource.instanceCount);
    return;
  }

  materialPipeline.draw(batch.geometry.vertexCount, instanceResource.instanceCount);
}

function drawTypeGpuShadowBatch({
  pipeline,
  pass,
  sceneBindGroup,
  shadowBindGroup,
  geometryResource,
  instanceResource,
  batch
}: {
  pipeline: TypeGpuShadowPipeline;
  pass: GPURenderPassEncoder;
  sceneBindGroup: TgpuBindGroup<typeof sceneBindGroupLayout.entries>;
  shadowBindGroup: TgpuBindGroup<typeof shadowBindGroupLayout.entries>;
  geometryResource: TypeGpuVertexBufferResource;
  instanceResource: TypeGpuInstanceBufferResource;
  batch: TypeGpuDrawBatch;
}): void {
  if (!instanceResource.buffer) return;

  const shadowPipeline = pipeline
    .with(pass)
    .with(sceneBindGroup)
    .with(shadowBindGroup)
    .with(meshVertexLayout, geometryResource.vertexBuffer.buffer)
    .with(meshInstanceLayout, instanceResource.buffer.buffer);

  if (geometryResource.indexBuffer && geometryResource.indexCount && geometryResource.indexFormat) {
    shadowPipeline
      .withIndexBuffer(geometryResource.indexBuffer.buffer, geometryResource.indexFormat)
      .drawIndexed(geometryResource.indexCount, instanceResource.instanceCount);
    return;
  }

  shadowPipeline.draw(batch.geometry.vertexCount, instanceResource.instanceCount);
}

function packShadowState(activeShadow: TypeGpuActiveShadow | null): ArrayBuffer {
  const data = new Float32Array(20);

  data.set(activeShadow?.viewProjection ?? identityMatrix4(), 0);
  data[16] = activeShadow?.light.shadowBias ?? 0;
  data[17] = activeShadow ? 1 : 0;
  data[18] = activeShadow?.light.shadowMapSize ?? 1;
  data[19] = 0;

  return arrayBufferFor(data);
}

function createDirectionalShadowViewProjection(
  light: TypeGpuLight,
  drawBatches: TypeGpuDrawBatch[]
): Float32Array {
  const bounds = shadowBoundsForDrawBatches(drawBatches);
  const center = bounds
    ? ([
        (bounds.min[0] + bounds.max[0]) / 2,
        (bounds.min[1] + bounds.max[1]) / 2,
        (bounds.min[2] + bounds.max[2]) / 2
      ] as Vector3Tuple)
    : [0, 0, 0] as Vector3Tuple;
  const radius = bounds ? shadowRadiusForBounds(bounds) : DEFAULT_SHADOW_CAMERA_RADIUS;
  const direction = normalize3(light.direction, [0, -1, 0]);
  const eye = add3(center, scale3(direction, -radius * 2));
  const up: Vector3Tuple = Math.abs(direction[1]) > 0.95 ? [0, 0, 1] : [0, 1, 0];
  const view = lookAtMatrix(eye, center, up);
  const projection = orthographicMatrix(-radius, radius, -radius, radius, 0.1, radius * 4);

  return multiply4(projection, view);
}

function shadowBoundsForDrawBatches(
  drawBatches: TypeGpuDrawBatch[]
): { min: Vector3Tuple; max: Vector3Tuple } | null {
  let min: Vector3Tuple | null = null;
  let max: Vector3Tuple | null = null;

  for (const batch of drawBatches) {
    const localBounds = batch.geometry.bounds ?? {
      min: [-0.5, -0.5, -0.5] as Vector3Tuple,
      max: [0.5, 0.5, 0.5] as Vector3Tuple
    };

    for (let index = 0; index < batch.instanceCount; index += 1) {
      const offset = index * batch.floatsPerInstance;
      const position: Vector3Tuple = [
        batch.instances[offset],
        batch.instances[offset + 1],
        batch.instances[offset + 2]
      ];
      const scale: Vector3Tuple = [
        batch.instances[offset + 8],
        batch.instances[offset + 9],
        batch.instances[offset + 10]
      ];
      const instanceBounds = transformAabbByScaleAndPosition(localBounds, scale, position);

      if (!min || !max) {
        min = [...instanceBounds.min] as Vector3Tuple;
        max = [...instanceBounds.max] as Vector3Tuple;
        continue;
      }

      min = [
        Math.min(min[0], instanceBounds.min[0]),
        Math.min(min[1], instanceBounds.min[1]),
        Math.min(min[2], instanceBounds.min[2])
      ];
      max = [
        Math.max(max[0], instanceBounds.max[0]),
        Math.max(max[1], instanceBounds.max[1]),
        Math.max(max[2], instanceBounds.max[2])
      ];
    }
  }

  return min && max ? { min, max } : null;
}

function transformAabbByScaleAndPosition(
  bounds: { min: Vector3Tuple; max: Vector3Tuple },
  scale: Vector3Tuple,
  position: Vector3Tuple
): { min: Vector3Tuple; max: Vector3Tuple } {
  const min: Vector3Tuple = [0, 0, 0];
  const max: Vector3Tuple = [0, 0, 0];

  for (let axis = 0; axis < 3; axis += 1) {
    const a = bounds.min[axis] * scale[axis];
    const b = bounds.max[axis] * scale[axis];
    min[axis] = position[axis] + Math.min(a, b);
    max[axis] = position[axis] + Math.max(a, b);
  }

  return { min, max };
}

function shadowRadiusForBounds(bounds: { min: Vector3Tuple; max: Vector3Tuple }): number {
  const width = bounds.max[0] - bounds.min[0];
  const height = bounds.max[1] - bounds.min[1];
  const depth = bounds.max[2] - bounds.min[2];
  const radius = Math.hypot(width, height, depth) / 2;

  return Math.max(1, radius);
}

function identityMatrix4(): Float32Array {
  const matrix = new Float32Array(16);
  matrix[0] = 1;
  matrix[5] = 1;
  matrix[10] = 1;
  matrix[15] = 1;
  return matrix;
}

function normalizeFrameloop(frameloop: TypeGpuRendererOptions['frameloop']): TypeGpuFrameLoop {
  return frameloop && frameloop in FRAMELOOP_OPTIONS ? frameloop : FRAMELOOP_OPTIONS.always.frameloop;
}

function arrayBufferFor(data: Float32Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
