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
import { Frustum } from './frustum';
import { VisibilitySelection } from './batch-visibility';
import { LodSelection } from './lod-selection';
import { HiZOcclusion, isOcclusionEligible, isUsefulOccluder, type OcclusionDraw, type OcclusionState } from './occlusion';
import type { TypeGpuFrameContext } from './frame-tasks';
import { createViewProjectionMatrix } from './camera-math';
import { Dirty } from './dirty';
import { drawBatchKey, drawBatchKeysForItem } from './render-plan';
import { packLightingState } from './lighting-data';
import {
  add3,
  lookAtMatrix,
  multiply4,
  normalize3,
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
import {
  createMeshPipeline,
  createShaderPassPipeline,
  createShadowPipeline
} from './typegpu-pipeline';
import {
  shaderPassPipelineResourceKey,
  writeShaderPassFrameUniforms
} from './shader-pass';
import {
  lightingBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout,
  shaderPassBindGroupLayout,
  shadowBindGroupLayout,
  shadowPassBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  typegpuLightingSchema,
  typegpuShaderPassUniformSchema,
  typegpuShadowSchema,
  typegpuSceneUniformSchema
} from './typegpu-layouts';
import type {
  RgbaTuple,
  TypeGpuCameraSettings,
  TypeGpuDrawBatch,
  TypeGpuLight,
  TypeGpuRenderSettings,
  TypeGpuSceneState,
  TypeGpuShaderPass,
  Vector3Tuple
} from './types';

export { loadMaterialTextureImageSource, type LoadedTextureImage };

// Keep the TypeGPU scene uniform buffer at 96 bytes, matching the explicit padding schema.
export const SCENE_UNIFORM_FLOATS = TYPEGPU_SCENE_UNIFORM_FLOATS;

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
type TypeGpuShaderPassUniformBuffer = TgpuBuffer<typeof typegpuShaderPassUniformSchema> & UniformFlag;
type TypeGpuDepthTexture = TgpuTexture & RenderFlag;
type TypeGpuShadowTexture = TgpuTexture & RenderFlag & SampledFlag;
type TypeGpuMeshPipeline = ReturnType<typeof createMeshPipeline>;
type TypeGpuShadowPipeline = ReturnType<typeof createShadowPipeline>;
type TypeGpuShaderPassPipeline = ReturnType<typeof createShaderPassPipeline>;

export type TypeGpuRenderQueueItem =
  | {
      kind: 'mesh';
      renderOrder: number;
      sortKey: number;
      sourceIndex: number;
      batch: TypeGpuDrawBatch;
    }
  | {
      kind: 'shaderPass';
      renderOrder: number;
      sortKey: number;
      sourceIndex: number;
      shaderPass: TypeGpuShaderPass;
    };

export interface TypeGpuRenderQueueHandlers {
  drawMesh(batch: TypeGpuDrawBatch): void;
  drawShaderPass(shaderPass: TypeGpuShaderPass): void;
}

interface TypeGpuActiveShadow {
  light: TypeGpuLight;
  viewProjection: Float32Array;
}

interface ShaderPassResource {
  buffer: TypeGpuShaderPassUniformBuffer;
  bindGroup: TgpuBindGroup<typeof shaderPassBindGroupLayout.entries>;
}

export interface TypeGpuRenderer {
  /** Update supplied live options; undefined restores that option's default. */
  setOptions(options: Pick<TypeGpuRendererOptions, 'frameloop' | 'maxDevicePixelRatio'>): void;
  setScene(scene: TypeGpuSceneState): void;
  setCamera(camera: TypeGpuCameraSettings): void;
  invalidate(): void;
  renderFrame(timestamp?: number): void;
  setFrameHandler?(handler: ((frame: TypeGpuFrameContext) => boolean) | null): void;
  getRenderSize(): { width: number; height: number };
  /** Last delivered frame; indirect counts are upper bounds when colorCountsExact is false. */
  getRenderStats?(): TypeGpuRenderStats;
  dispose(): void;
}

export interface TypeGpuRenderStats {
  retainedInstances: number;
  candidateInstances: number;
  submittedInstances: number;
  culledInstances: number;
  colorDraws: number;
  colorTriangles: number;
  shadowTriangles: number;
  cullingCpuMs: number;
  boundsTests: number;
  rangeFallbacks: number;
  lodInstances: number;
  lodTrianglesSaved: number;
  lodCpuMs: number;
  lodRangeFallbacks: number;
  /** False means submittedInstances/colorTriangles are pre-occlusion upper bounds. */
  colorCountsExact?: boolean;
  occlusion?: OcclusionState;
  occlusionCandidates?: number;
  occlusionDepthTriangles?: number;
  occlusionCpuMs?: number;
}

export interface TypeGpuRendererOptions {
  canvas: HTMLCanvasElement;
  /** Delivered render frames per second; 0 after 500 ms without a frame. */
  onFps?: (fps: number) => void;
  frameloop?: 'always' | 'demand' | 'manual';
  maxDevicePixelRatio?: number;
  clearColor?: RgbaTuple;
  depth?: boolean;
  alphaMode?: GPUCanvasAlphaMode;
}

export async function createTypeGpuRenderer({
  canvas,
  onFps,
  frameloop = FRAMELOOP_OPTIONS.always.frameloop,
  maxDevicePixelRatio = MAX_DEVICE_PIXEL_RATIO,
  clearColor = [0, 0, 0, 1],
  depth = true,
  alphaMode = 'premultiplied'
}: TypeGpuRendererOptions): Promise<TypeGpuRenderer> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const root = await tgpu.init({ unstable_names: 'strict', device: { optionalFeatures: ['indirect-first-instance'] } });

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
  #camera = { ...DEFAULT_TYPEGPU_CAMERA };
  #context: GPUCanvasContext;
  #depthTexture: TypeGpuDepthTexture | null = null;
  #disposed = false;
  #drawBatches: TypeGpuDrawBatch[] = [];
  #frustum = new Frustum();
  #visibility = new Map<string, VisibilitySelection>();
  #lod = new Map<string, { selection: LodSelection; batches: TypeGpuDrawBatch[] }>();
  #lodRange = { ranges: new Uint32Array(2), rangeCount: 1 };
  #occlusion: HiZOcclusion | null = null;
  #retainedInstances = 0;
  #renderStats: TypeGpuRenderStats = {
    retainedInstances: 0, candidateInstances: 0, submittedInstances: 0, culledInstances: 0,
    colorDraws: 0, colorTriangles: 0, shadowTriangles: 0, cullingCpuMs: 0, boundsTests: 0, rangeFallbacks: 0,
    lodInstances: 0, lodTrianglesSaved: 0, lodCpuMs: 0, lodRangeFallbacks: 0
  };
  #fpsMeter;
  #frame: number | null = null;
  #geometryResources: GeometryResourceCache;
  #instanceBuffers: InstanceBufferCache;
  #lastTimestamp: number | null = null;
  #elapsed = 0;
  #rendering = false;
  #needsFollowUpFrame = false;
  #continueFrame = false;
  #frameHandler: ((frame: TypeGpuFrameContext) => boolean) | null = null;
  #lightingBindGroup: TgpuBindGroup<typeof lightingBindGroupLayout.entries>;
  #lightingBuffer: TypeGpuLightingUniformBuffer;
  #lights: TypeGpuLight[] = [];
  #materialResources: MaterialResourceCache;
  #pipelines: PipelineResourceCache;
  #projectionDirty = true;
  #renderQueue: TypeGpuRenderQueueItem[] = [];
  #renderSettings: TypeGpuRenderSettings;
  #renderSize = { width: 0, height: 0 };
  #displaySize: { width: number; height: number };
  #resizeObserver: ResizeObserver | null = null;
  #samplerResources: SamplerResourceCache;
  #sceneBindGroup: TgpuBindGroup<typeof sceneBindGroupLayout.entries>;
  #shaderPassResources = new Map<TypeGpuShaderPass['node'], ShaderPassResource>();
  #shaderPassPipelines = new Map<string, TypeGpuShaderPassPipeline>();
  #shadowBindGroup: TgpuBindGroup<typeof shadowBindGroupLayout.entries>;
  #shadowBuffer: TypeGpuShadowUniformBuffer;
  #shadowMapSize = 0;
  #shadowPassBindGroup: TgpuBindGroup<typeof shadowPassBindGroupLayout.entries>;
  #shadowPipeline: TypeGpuShadowPipeline | null = null;
  #shadowPipelineKey = '';
  #shadowSampler: TgpuFixedComparisonSampler;
  #shadowTexture: TypeGpuShadowTexture;
  #textureResources: TextureResourceCache;
  #time = 0;
  #uniformBuffer: TypeGpuSceneUniformBuffer;
  #uniformData = new Float32Array(SCENE_UNIFORM_FLOATS);

  readonly #format: GPUTextureFormat;
  #frameloop: TypeGpuFrameLoop;
  #maxDevicePixelRatio: number;

  constructor(
    private readonly root: TgpuRoot,
    private readonly options: Required<Omit<TypeGpuRendererOptions, 'onFps'>> & Pick<TypeGpuRendererOptions, 'onFps'>
  ) {
    this.#format = navigator.gpu.getPreferredCanvasFormat();
    this.#frameloop = normalizeFrameloop(options.frameloop);
    this.#maxDevicePixelRatio = normalizePixelRatio(options.maxDevicePixelRatio);
    this.#displaySize = { width: options.canvas.width || 1, height: options.canvas.height || 1 };
    this.#renderSettings = {
      clearColor: options.clearColor,
      depth: options.depth,
      alphaMode: options.alphaMode
    };
    this.#context = this.#configureContext();
    this.#fpsMeter = options.onFps ? createFpsMeter(options.onFps) : null;
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
    this.#shadowPassBindGroup = root.createBindGroup(shadowPassBindGroupLayout, {
      shadow: this.#shadowBuffer
    });
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
    this.#syncResizeObserver();
    this.setScene({
      dirty: Dirty.None,
      camera: DEFAULT_TYPEGPU_CAMERA,
      cameraNode: null,
      cameraControllerNode: null,
      cameraController: null,
      renderSettings: this.#renderSettings,
      lights: [],
      lightsChanged: true,
      drawBatches: [],
      drawBatchesChanged: true,
      shaderPasses: [],
      shaderPassesChanged: true,
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

  setOptions(options: Pick<TypeGpuRendererOptions, 'frameloop' | 'maxDevicePixelRatio'>): void {
    if (this.#disposed) return;
    const frameloop = 'frameloop' in options ? normalizeFrameloop(options.frameloop) : this.#frameloop;
    const ratio = 'maxDevicePixelRatio' in options ? normalizePixelRatio(options.maxDevicePixelRatio) : this.#maxDevicePixelRatio;
    const modeChanged = frameloop !== this.#frameloop;
    if (!modeChanged && ratio === this.#maxDevicePixelRatio) return;
    this.#maxDevicePixelRatio = ratio;
    this.#frameloop = frameloop;
    if (modeChanged) this.#syncResizeObserver();

    if (frameloop === 'manual') {
      if (this.#frame !== null) cancelAnimationFrame(this.#frame);
      this.#frame = null;
      this.#needsFollowUpFrame = false;
      this.#continueFrame = false;
    } else if (this.#rendering) {
      // Options can change in a frame task or onFps, even after resizing/drawing.
      this.#needsFollowUpFrame = true;
    } else if (this.#frame === null) {
      this.invalidate();
    }
  }

  setScene(scene: TypeGpuSceneState): void {
    if (this.#disposed) return;
    // Picking/listener changes are reconciled by the runtime, not by drawing.
    if (
      scene.dirty === Dirty.Interaction && !scene.lightsChanged &&
      !scene.drawBatchesChanged && !scene.shaderPassesChanged &&
      !scene.instanceUpdates?.length && !scene.materialUpdates?.length
    ) return;

    const depthChanged = this.#renderSettings.depth !== scene.renderSettings.depth;
    // A scene update is one invalidation, including its camera projection.
    this.#camera = scene.camera;
    this.#projectionDirty = true;
    this.#updateRenderSettings(scene.renderSettings);
    this.#lights = scene.lights;
    this.#drawBatches = scene.drawBatches;

    if (scene.lightsChanged) {
      this.#lightingBuffer.write(packLightingState(scene.lights));
    }

    if (scene.drawBatchesChanged) {
      this.#retainedInstances = scene.resourceItems?.length ?? scene.drawBatches.reduce((sum, batch) => sum + batch.instanceCount, 0);
      this.#syncMeshResources(scene);
    } else {
      for (const material of scene.materialUpdates ?? []) {
        this.#materialResources.updateUniforms(material);
      }
      for (const batch of scene.instanceUpdates ?? []) {
        this.#instanceBuffers.upload(batch, batch.dirtyRanges);
        this.#occlusion?.updateBounds(batch, batch.dirtyRanges);
      }
    }
    if (scene.drawBatchesChanged || depthChanged) this.#syncPipelines(scene);

    if (scene.shaderPassesChanged || depthChanged) {
      pruneShaderPassPipelineCache(this.#shaderPassPipelines, scene.shaderPasses, scene.renderSettings.depth);
    }
    if (scene.shaderPassesChanged) {
      const liveNodes = scene.shaderPassNodes ??
        new Set(scene.shaderPasses.map((shaderPass) => shaderPass.node));
      for (const [node, resource] of this.#shaderPassResources) {
        if (liveNodes.has(node)) continue;
        resource.buffer.destroy();
        this.#shaderPassResources.delete(node);
      }
    }
    if (scene.drawBatchesChanged || scene.shaderPassesChanged) {
      this.#renderQueue = createTypeGpuRenderQueue(scene.drawBatches, scene.shaderPasses);
    }
    this.invalidate();
  }

  #syncMeshResources(scene: TypeGpuSceneState): void {
    const activeBatches = new Set(scene.drawBatches.map(batch => batch.key));
    this.#occlusion?.prune(activeBatches);
    for (const key of this.#visibility.keys()) if (!activeBatches.has(key)) this.#visibility.delete(key);
    for (const key of this.#lod.keys()) if (!activeBatches.has(key)) this.#lod.delete(key);
    for (const batch of scene.drawBatches) {
      if (!this.#visibility.has(batch.key)) this.#visibility.set(batch.key, new VisibilitySelection());
      this.#geometryResources.getOrCreate(batch);
      if (batch.geometry.lod && batch.visibility) {
        const previous = this.#lod.get(batch.key)?.selection;
        const selection = previous?.policy === batch.geometry.lod && previous.clusterLevels.length >= batch.visibility.leafBase
          ? previous : new LodSelection(batch.visibility.leafBase, batch.geometry.lod);
        const batches = [batch, ...batch.geometry.lod.levels.map(level => ({ ...batch,
          geometry: level.geometry, geometryKey: level.geometry.key }))];
        for (const variant of batches) this.#geometryResources.getOrCreate(variant);
        this.#lod.set(batch.key, { selection, batches });
      } else this.#lod.delete(batch.key);
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

      const instanceResource = this.#instanceBuffers.getOrCreate(batch);

      if (batch.instancesChanged || !instanceResource.buffer) {
        const dirtyRanges = batch.dirtyRanges.length
          ? batch.dirtyRanges
          : batch.instanceCount > 0
            ? [{ start: 0, count: batch.instanceCount }]
            : [];

        this.#instanceBuffers.upload(batch, dirtyRanges);
      } else {
        instanceResource.instanceCount = batch.instanceCount;
      }
      this.#occlusion?.updateBounds(batch, batch.dirtyRanges);
    }

    this.#geometryResources.prune(scene.liveResourceKeys.geometries);
    this.#materialResources.prune(
      new Set(
        scene.resourceItems
          ? scene.resourceItems.map((item) => materialResourceKeyFor(item.material))
          : scene.drawBatches
              .filter((batch) => scene.liveResourceKeys.materials.has(batch.materialKey))
              .map((batch) => materialResourceKeyFor(batch.material))
      )
    );
    this.#textureResources.prune(scene.liveResourceKeys.textures);
    this.#samplerResources.prune(scene.liveResourceKeys.samplers);
    this.#instanceBuffers.prune(new Set(
      scene.resourceItems
        ? scene.resourceItems.map((item) => drawBatchKey(drawBatchKeysForItem(item)))
        : scene.drawBatches.map((batch) => batch.key)
    ));
  }

  #syncPipelines(scene: TypeGpuSceneState): void {
    for (const batch of scene.drawBatches) {
      this.#pipelines.getOrCreate(batch, scene.renderSettings.depth);
    }
    this.#pipelines.prune(
      new Set(
        scene.resourceItems
          ? scene.resourceItems.map((item) => pipelineResourceKeyFor(
              { ...drawBatchKeysForItem(item), material: item.material },
              scene.renderSettings.depth
            ))
          : scene.drawBatches
              .filter((batch) => scene.liveResourceKeys.pipelines.has(batch.pipelineKey))
              .map((batch) => pipelineResourceKeyFor(batch, scene.renderSettings.depth))
      )
    );
  }

  setCamera(camera: TypeGpuCameraSettings): void {
    if (this.#disposed) return;

    this.#camera = camera;
    this.#projectionDirty = true;
    this.invalidate();
  }

  invalidate(): void {
    if (this.#disposed || this.#rendering || this.#frameloop === 'manual') return;
    if (this.#frame !== null) {
      // External RAF producers can update immediately before our queued callback.
      // Keep one follow-up frame so demand rendering does not skip alternate ticks.
      this.#needsFollowUpFrame = true;
      return;
    }

    this.#frame = requestAnimationFrame((timestamp) => this.#onAnimationFrame(timestamp));
  }

  setFrameHandler(handler: ((frame: TypeGpuFrameContext) => boolean) | null): void {
    if (this.#disposed) return;
    this.#frameHandler = handler;
    this.#continueFrame = false;
    if (handler) this.invalidate();
  }

  renderFrame(timestamp = typeof performance === 'undefined' ? 0 : performance.now()): void {
    if (this.#disposed || this.#rendering) return;
    this.#rendering = true;
    try {
      this.#drawFrame(timestamp);
    } finally {
      this.#rendering = false;
      if (this.#needsFollowUpFrame && this.#frame === null) {
        this.#needsFollowUpFrame = false;
        this.invalidate();
      }
    }
  }

  #drawFrame(timestamp: number): void {
    const now = Number.isFinite(timestamp)
      ? Math.max(this.#lastTimestamp ?? timestamp, timestamp)
      : this.#lastTimestamp ?? 0;
    const delta = this.#lastTimestamp === null ? 0 : Math.min(50, now - this.#lastTimestamp);
    this.#lastTimestamp = now;
    this.#elapsed += delta / 1000;
    this.#continueFrame =
      this.#frameHandler?.({ timestamp: now, delta: delta / 1000, elapsed: this.#elapsed }) ?? false;
    if (this.#disposed) return;

    this.#time += (delta / 16.67) * 0.018;

    this.#resize();
    this.#writeUniforms();
    this.#frustum.setMatrix(this.#uniformData);
    const stats = this.#renderStats;
    stats.retainedInstances = this.#retainedInstances;
    stats.candidateInstances = stats.submittedInstances = stats.culledInstances = 0;
    stats.colorDraws = stats.colorTriangles = stats.shadowTriangles = 0;
    stats.cullingCpuMs = stats.boundsTests = stats.rangeFallbacks = 0;
    stats.lodInstances = stats.lodTrianglesSaved = stats.lodCpuMs = stats.lodRangeFallbacks = 0;
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
            stats.shadowTriangles += (geometryResource.indexCount ?? batch.geometry.vertexCount) / 3 * instanceResource.instanceCount;

            drawTypeGpuShadowBatch({
              pipeline: shadowPipeline,
              pass,
              shadowPassBindGroup: this.#shadowPassBindGroup,
              geometryResource,
              instanceResource,
              batch
            });
          }
        }
      });
    }

    this.#prepareOcclusion();

    beginTypeGpuRenderPass({
      root: this.root,
      context: this.#context,
      clearColor: this.#renderSettings.clearColor,
      depthTexture: this.#renderSettings.depth ? this.#depthTexture : null,
      draw: (pass) => {
        drawTypeGpuRenderQueue(this.#renderQueue, {
          drawMesh: (batch) => {
            const selection = this.#visibility.get(batch.key)!;
            const start = performance.now();
            selection.select(this.#frustum, this.#renderSettings.frustumCulling !== false ? batch.visibility : undefined, batch.instanceCount);
            stats.cullingCpuMs += performance.now() - start;
            stats.boundsTests += selection.boundsTests;
            stats.rangeFallbacks += Number(selection.fallback);
            stats.candidateInstances += batch.instanceCount;
            stats.culledInstances += batch.instanceCount - selection.instanceCount;
            if (!selection.instanceCount) return;
            const instanceResource = this.#instanceBuffers.getOrCreate(batch);
            const materialResource = this.#materialResources.getOrCreate(batch.material);
            const pipeline = this.#pipelines.getOrCreate(batch, this.#renderSettings.depth);
            const indirect = this.#occlusion?.draws.get(batch.key);

            if (!instanceResource.buffer || instanceResource.instanceCount === 0) return;
            stats.submittedInstances += selection.instanceCount;
            const lod = this.#lod.get(batch.key);
            if (lod) {
              const start = performance.now();
              lod.selection.select(this.#uniformData, this.#frustum.revision, this.#displaySize.height, batch.visibility!, selection);
              stats.lodCpuMs += performance.now() - start;
              stats.lodRangeFallbacks += Number(lod.selection.fallback);
              stats.colorDraws += lod.selection.rangeCount;
              const fullTriangles = (batch.geometry.indexCount ?? batch.geometry.vertexCount) / 3;
              for (let range = 0; range < lod.selection.rangeCount; range++) {
                const level = lod.selection.levels[range], variant = lod.batches[level];
                const geometryResource = this.#geometryResources.getOrCreate(variant);
                const count = lod.selection.ranges[range * 2 + 1];
                const triangles = (geometryResource.indexCount ?? variant.geometry.vertexCount) / 3 * count;
                stats.colorTriangles += triangles;
                stats.lodTrianglesSaved += fullTriangles * count - triangles;
                if (level > 0) stats.lodInstances += count;
                this.#lodRange.ranges[0] = lod.selection.ranges[range * 2];
                this.#lodRange.ranges[1] = count;
                drawTypeGpuMaterialBatch({ pipeline, pass, sceneBindGroup: this.#sceneBindGroup,
                  lightingBindGroup: this.#lightingBindGroup, shadowBindGroup: this.#shadowBindGroup,
                  geometryResource, instanceResource, materialResource, batch: variant, selection: this.#lodRange,
                  indirect, indirectRange: range });
              }
              return;
            }
            const geometryResource = this.#geometryResources.getOrCreate(batch);
            stats.colorDraws += selection.rangeCount;
            stats.colorTriangles += (geometryResource.indexCount ?? batch.geometry.vertexCount) / 3 * selection.instanceCount;

            drawTypeGpuMaterialBatch({
              pipeline,
              pass,
              sceneBindGroup: this.#sceneBindGroup,
              lightingBindGroup: this.#lightingBindGroup,
              shadowBindGroup: this.#shadowBindGroup,
              geometryResource,
              instanceResource,
              materialResource,
              batch,
              selection,
              indirect
            });
          },
          drawShaderPass: (shaderPass) => {
            const resource = this.#shaderPassResourceFor(shaderPass);
            writeShaderPassFrameUniforms(resource.buffer, {
              time: this.#time,
              renderSize: this.#renderSize,
              uniforms: shaderPass.uniforms
            });
            drawTypeGpuShaderPass({
              pipeline: this.#shaderPassPipelineFor(shaderPass),
              pass,
              shaderPassBindGroup: resource.bindGroup
            });
          }
        });
      }
    });

    this.#fpsMeter?.record(now);
  }

  getRenderSize(): { width: number; height: number } {
    return { ...this.#renderSize };
  }

  getRenderStats(): TypeGpuRenderStats {
    return { ...this.#renderStats };
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;
    this.#fpsMeter?.dispose();
    this.#needsFollowUpFrame = false;
    this.#frameHandler = null;
    this.#continueFrame = false;

    if (this.#frame !== null) {
      cancelAnimationFrame(this.#frame);
      this.#frame = null;
    }

    this.#resizeObserver?.disconnect();
    this.#occlusion?.dispose();
    this.#occlusion = null;
    this.#depthTexture?.destroy();
    this.#shadowTexture?.destroy();
    this.#geometryResources.dispose();
    this.#instanceBuffers.dispose();
    this.#materialResources.dispose();
    this.#pipelines.dispose();
    this.#textureResources.dispose();
    this.#shaderPassPipelines.clear();
    this.#lightingBuffer.destroy();
    for (const resource of this.#shaderPassResources.values()) resource.buffer.destroy();
    this.#shaderPassResources.clear();
    this.#renderQueue = [];
    this.#visibility.clear();
    this.#lod.clear();
    this.#shadowBuffer.destroy();
    this.#uniformBuffer.destroy();
    this.root.destroy();
  }

  #onAnimationFrame(timestamp: number): void {
    const needsFollowUpFrame = this.#needsFollowUpFrame;
    this.#needsFollowUpFrame = false;
    this.#frame = null;
    this.renderFrame(timestamp);

    if (!this.#disposed && this.#frame === null && (this.#frameloop === 'always' || this.#continueFrame || needsFollowUpFrame)) {
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

  #syncResizeObserver(): void {
    if (this.#frameloop !== 'demand') {
      this.#resizeObserver?.disconnect();
      return;
    }
    if (typeof ResizeObserver === 'undefined') return;
    this.#resizeObserver ??= new ResizeObserver(() => this.invalidate());
    this.#resizeObserver.observe(this.options.canvas);
  }

  #updateRenderSettings(settings: TypeGpuRenderSettings): void {
    const alphaModeChanged = this.#renderSettings.alphaMode !== settings.alphaMode;
    const depthChanged = this.#renderSettings.depth !== settings.depth;

    this.#renderSettings = settings;
    if (settings.occlusion !== 'hi-z' && this.#occlusion) {
      this.#occlusion.dispose();
      this.#occlusion = null;
    }

    if (alphaModeChanged) {
      this.#context = this.#configureContext();
    }

    if (depthChanged) {
      this.#depthTexture?.destroy();
      this.#depthTexture = null;
      this.#projectionDirty = true;
    }
  }

  #prepareOcclusion(): void {
    const stats = this.#renderStats;
    this.#occlusion?.draws.clear();
    stats.colorCountsExact = true;
    stats.occlusion = 'disabled';
    stats.occlusionCandidates = stats.occlusionDepthTriangles = stats.occlusionCpuMs = 0;
    if (this.#renderSettings.occlusion !== 'hi-z') return;
    stats.occlusion = 'unsupported';
    const { width, height } = this.#renderSize;
    if (!this.#renderSettings.depth || !HiZOcclusion.supported(this.root, width, height) ||
      this.#renderQueue.some(item => item.kind === 'shaderPass') ||
      this.#drawBatches.some(batch => batch.material.depthTest === false && batch.material.depthWrite !== false)) return;
    const start = performance.now();
    // Selections are cached by camera/bounds revision, so the color pass reuses
    // exactly these ranges without rebuilding or repacking canonical instances.
    for (const batch of this.#drawBatches) {
      const selection = this.#visibility.get(batch.key)!;
      selection.select(this.#frustum, this.#renderSettings.frustumCulling !== false ? batch.visibility : undefined, batch.instanceCount);
      const lod = this.#lod.get(batch.key);
      lod?.selection.select(this.#uniformData, this.#frustum.revision, this.#displaySize.height, batch.visibility!, selection);
    }
    let occluderCount = 0;
    this.#occlusion?.occluders.clear();
    for (const batch of this.#drawBatches) {
      if (occluderCount === 16) break;
      if (!this.#visibility.get(batch.key)!.instanceCount || !isUsefulOccluder(batch, this.#uniformData)) continue;
      this.#occlusion ??= new HiZOcclusion(this.root);
      this.#occlusion.occluders.add(batch.key);
      occluderCount++;
    }
    stats.occlusion = 'no-occluders';
    if (!occluderCount) { stats.occlusionCpuMs = performance.now() - start; return; }
    const occlusion = this.#occlusion!;
    occlusion.begin(width, height, this.#uniformData);
    for (const batch of this.#drawBatches) {
      if (occlusion.occluders.has(batch.key) || !isOcclusionEligible(batch)) continue;
      const buffer = this.#instanceBuffers.getOrCreate(batch).buffer;
      const lod = this.#lod.get(batch.key);
      const selection = lod?.selection ?? this.#visibility.get(batch.key)!;
      if (buffer && occlusion.prepare(batch, selection, lod?.batches, buffer.buffer)) {
        stats.occlusionCandidates! += this.#visibility.get(batch.key)!.instanceCount;
      }
    }
    if (!occlusion.draws.size) { stats.occlusionCpuMs = performance.now() - start; return; }
    const encoder = this.root.device.createCommandEncoder({ label: 'Occlusion current-frame visibility' });
    const pass = occlusion.depthPass(encoder);
    try {
      for (const batch of this.#drawBatches) {
        if (!occlusion.occluders.has(batch.key)) continue;
        const geometryResource = this.#geometryResources.getOrCreate(batch);
        const instanceResource = this.#instanceBuffers.getOrCreate(batch);
        if (!instanceResource.buffer) continue;
        stats.occlusionDepthTriangles! += (batch.geometry.indexCount ?? batch.geometry.vertexCount) / 3 * batch.instanceCount;
        drawTypeGpuShadowBatch({ pipeline: occlusion.depthPipeline(batch.material.cullMode), pass,
          shadowPassBindGroup: occlusion.depthGroup, geometryResource, instanceResource, batch });
      }
    } finally { pass.end(); }
    occlusion.encode(encoder);
    this.root.device.queue.submit([encoder.finish()]);
    stats.occlusion = 'active';
    stats.colorCountsExact = false;
    stats.occlusionCpuMs = performance.now() - start;
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

  #shaderPassPipelineFor(shaderPass: TypeGpuShaderPass): TypeGpuShaderPassPipeline {
    const key = shaderPassPipelineResourceKey(shaderPass, this.#renderSettings.depth);
    const existing = this.#shaderPassPipelines.get(key);

    if (existing) return existing;

    const pipeline = createShaderPassPipeline(this.root, this.#format, shaderPass, {
      depth: this.#renderSettings.depth
    });
    this.#shaderPassPipelines.set(key, pipeline);
    return pipeline;
  }

  #resize(): void {
    const canvas = this.options.canvas;
    const dpr = Math.min(this.#maxDevicePixelRatio, window.devicePixelRatio || 1);
    // Hidden canvases retain their last CSS size, never their DPR-scaled output.
    const measuredWidth = canvas.clientWidth, measuredHeight = canvas.clientHeight;
    if (measuredWidth > 0) this.#displaySize.width = measuredWidth;
    if (measuredHeight > 0) this.#displaySize.height = measuredHeight;
    const width = Math.max(1, Math.floor(this.#displaySize.width * dpr));
    const height = Math.max(1, Math.floor(this.#displaySize.height * dpr));
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
    this.#uniformBuffer.write(arrayBufferFor(this.#uniformData));
  }

  #shaderPassResourceFor(shaderPass: TypeGpuShaderPass): ShaderPassResource {
    const existing = this.#shaderPassResources.get(shaderPass.node);
    if (existing) return existing;

    const buffer = this.root.createBuffer(typegpuShaderPassUniformSchema)
      .$usage('uniform')
      .$name(`TypeGPU shader pass uniforms ${shaderPass.key}`);
    const resource = {
      buffer,
      bindGroup: this.root.createBindGroup(shaderPassBindGroupLayout, { uniforms: buffer })
    };
    this.#shaderPassResources.set(shaderPass.node, resource);
    return resource;
  }
}

export function createTypeGpuRenderQueue(
  drawBatches: TypeGpuDrawBatch[],
  shaderPasses: TypeGpuShaderPass[]
): TypeGpuRenderQueueItem[] {
  const queue: TypeGpuRenderQueueItem[] = [
    ...drawBatches.map((batch, sourceIndex) => ({
      kind: 'mesh' as const,
      renderOrder: batch.renderOrder,
      sortKey: batch.sortKey,
      sourceIndex,
      batch
    })),
    ...shaderPasses.map((shaderPass, sourceIndex) => ({
      kind: 'shaderPass' as const,
      renderOrder: shaderPass.renderOrder,
      sortKey: shaderPass.sortKey,
      sourceIndex,
      shaderPass
    }))
  ];

  return queue.sort(compareRenderQueueItems);
}

export function drawTypeGpuRenderQueue(
  queue: TypeGpuRenderQueueItem[],
  handlers: TypeGpuRenderQueueHandlers
): void {
  for (const item of queue) {
    if (item.kind === 'mesh') {
      handlers.drawMesh(item.batch);
    } else {
      handlers.drawShaderPass(item.shaderPass);
    }
  }
}

export function pruneShaderPassPipelineCache<T>(
  cache: Map<string, T>,
  shaderPasses: TypeGpuShaderPass[],
  depth: boolean
): void {
  const liveKeys = new Set(
    shaderPasses.map((shaderPass) => shaderPassPipelineResourceKey(shaderPass, depth))
  );

  for (const key of cache.keys()) {
    if (!liveKeys.has(key)) cache.delete(key);
  }
}

function compareRenderQueueItems(
  left: TypeGpuRenderQueueItem,
  right: TypeGpuRenderQueueItem
): number {
  return (
    left.renderOrder - right.renderOrder ||
    renderQueueKindRank(left.kind) - renderQueueKindRank(right.kind) ||
    left.sortKey - right.sortKey ||
    left.sourceIndex - right.sourceIndex
  );
}

function renderQueueKindRank(kind: TypeGpuRenderQueueItem['kind']): number {
  return kind === 'mesh' ? 0 : 1;
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

export function drawTypeGpuMaterialBatch({
  pipeline,
  pass,
  sceneBindGroup,
  lightingBindGroup,
  shadowBindGroup,
  geometryResource,
  instanceResource,
  materialResource,
  batch,
  selection,
  indirect,
  indirectRange = 0
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
  selection: Pick<VisibilitySelection, 'ranges' | 'rangeCount'>;
  indirect?: OcclusionDraw;
  indirectRange?: number;
}): void {
  if (!instanceResource.buffer) return;

  const passPipeline = pipeline.with(pass).with(sceneBindGroup).with(lightingBindGroup).with(shadowBindGroup);
  const materialPipeline = passPipeline
    .with(materialResource.bindGroup)
    .with(meshVertexLayout, geometryResource.vertexBuffer.buffer)
    .with(meshInstanceLayout, indirect?.instances ?? instanceResource.buffer.buffer);

  if (geometryResource.indexBuffer && geometryResource.indexCount && geometryResource.indexFormat) {
    const indexed = materialPipeline.withIndexBuffer(geometryResource.indexBuffer.buffer, geometryResource.indexFormat);
    for (let i = 0; i < selection.rangeCount * 2; i += 2) {
      if (indirect) indexed.drawIndexedIndirect(indirect.args, (indirectRange + i / 2) * 32);
      else indexed.drawIndexed(geometryResource.indexCount, selection.ranges[i + 1], 0, 0, selection.ranges[i]);
    }
    return;
  }

  for (let i = 0; i < selection.rangeCount * 2; i += 2) {
    if (indirect) materialPipeline.drawIndirect(indirect.args, (indirectRange + i / 2) * 32);
    else materialPipeline.draw(batch.geometry.vertexCount, selection.ranges[i + 1], 0, selection.ranges[i]);
  }
}

export function drawTypeGpuShadowBatch({
  pipeline,
  pass,
  shadowPassBindGroup,
  geometryResource,
  instanceResource,
  batch
}: {
  pipeline: TypeGpuShadowPipeline;
  pass: GPURenderPassEncoder;
  shadowPassBindGroup: TgpuBindGroup<typeof shadowPassBindGroupLayout.entries>;
  geometryResource: TypeGpuVertexBufferResource;
  instanceResource: TypeGpuInstanceBufferResource;
  batch: TypeGpuDrawBatch;
}): void {
  if (!instanceResource.buffer) return;

  const shadowPipeline = pipeline
    .with(pass)
    .with(shadowPassBindGroup)
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

export function drawTypeGpuShaderPass({
  pipeline,
  pass,
  shaderPassBindGroup
}: {
  pipeline: TypeGpuShaderPassPipeline;
  pass: GPURenderPassEncoder;
  shaderPassBindGroup: TgpuBindGroup<typeof shaderPassBindGroupLayout.entries>;
}): void {
  pipeline.with(pass).with(shaderPassBindGroup).draw(6);
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

export function createDirectionalShadowViewProjection(
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
  const up: Vector3Tuple = Math.abs(direction[2]) > 0.95 ? [0, 1, 0] : [0, 0, 1];
  const view = lookAtMatrix(eye, center, up);
  const projection = orthographicDepthZeroToOneMatrix(-radius, radius, -radius, radius, 0.1, radius * 4);

  return multiply4(projection, view);
}

export function shadowBoundsForDrawBatches(
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
      const instanceBounds = conservativeShadowBoundsForInstance(
        localBounds,
        scale,
        position
      );

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

function conservativeShadowBoundsForInstance(
  bounds: { min: Vector3Tuple; max: Vector3Tuple },
  scale: Vector3Tuple,
  position: Vector3Tuple
): { min: Vector3Tuple; max: Vector3Tuple } {
  let radius = 0;

  for (const x of [bounds.min[0], bounds.max[0]]) {
    for (const y of [bounds.min[1], bounds.max[1]]) {
      for (const z of [bounds.min[2], bounds.max[2]]) {
        radius = Math.max(
          radius,
          Math.hypot(x * scale[0], y * scale[1], z * scale[2])
        );
      }
    }
  }

  return {
    min: [position[0] - radius, position[1] - radius, position[2] - radius],
    max: [position[0] + radius, position[1] + radius, position[2] + radius]
  };
}

function shadowRadiusForBounds(bounds: { min: Vector3Tuple; max: Vector3Tuple }): number {
  const width = bounds.max[0] - bounds.min[0];
  const height = bounds.max[1] - bounds.min[1];
  const depth = bounds.max[2] - bounds.min[2];
  const radius = Math.hypot(width, height, depth) / 2;

  return Math.max(1, radius);
}

export function shadowDepthForPoint(matrix: Float32Array, point: Vector3Tuple): number {
  const x = point[0];
  const y = point[1];
  const z = point[2];
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

  if (!Number.isFinite(w) || Math.abs(w) <= 1e-12) {
    throw new Error('Cannot compute shadow depth for a point with invalid clip-space w.');
  }

  return (matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]) / w;
}

function orthographicDepthZeroToOneMatrix(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number
): Float32Array {
  const matrix = new Float32Array(16);

  matrix[0] = 2 / (right - left);
  matrix[5] = 2 / (top - bottom);
  matrix[10] = -1 / (far - near);
  matrix[12] = -(right + left) / (right - left);
  matrix[13] = -(top + bottom) / (top - bottom);
  matrix[14] = -near / (far - near);
  matrix[15] = 1;

  return matrix;
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
  return frameloop && Object.hasOwn(FRAMELOOP_OPTIONS, frameloop) ? frameloop : FRAMELOOP_OPTIONS.always.frameloop;
}

function normalizePixelRatio(value: number | undefined): number {
  return typeof value === 'number' && value > 0 ? value : MAX_DEVICE_PIXEL_RATIO;
}

function arrayBufferFor(data: Float32Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
