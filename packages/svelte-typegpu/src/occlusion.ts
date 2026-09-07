import type { TgpuBindGroup, TgpuRoot } from 'typegpu';
import type { TypeGpuDrawBatch, TypeGpuInstanceDirtyRange } from './types';
import { DEPTH_FORMAT } from './render-constants';
import { createShadowPipeline } from './typegpu-pipeline';
import { shadowPassBindGroupLayout } from './typegpu-layouts';
import type { GpuTiming } from './gpu-timing';
import {
  OCCLUSION_BLOCK_SIZE, compact, compactLayout, depthReduce, depthReduceLayout,
  mipReduce, mipReduceLayout, rangeLayout, rangeScan, visibility, visibilityLayout
} from './occlusion-shaders';

export const MAX_OCCLUSION_RANGES = 192;
export type OcclusionState = 'disabled' | 'unsupported' | 'no-occluders' | 'no-candidates' | 'active';
export interface OcclusionRanges {
  ranges: Uint32Array;
  rangeCount: number;
  levels?: Uint8Array;
}
export interface OcclusionDraw {
  instances: GPUBuffer;
  args: GPUBuffer;
}

/** Only the built-in, ordinary opaque depth contract is understood here. */
export function isOcclusionEligible(batch: TypeGpuDrawBatch): boolean {
  const m = batch.material;
  return !!batch.visibility && batch.floatsPerInstance === 24 && m.kind !== 'shader' &&
    !m.transparent && (m.blendMode ?? 'opaque') === 'opaque' && m.opacity >= 1 && m.color[3] >= 1 &&
    m.depthTest !== false && m.depthWrite !== false &&
    !batch.geometry.hasVertexAlpha && !(batch.geometry.lod?.levels.some(level => level.geometry.hasVertexAlpha)) &&
    (batch.geometry.topology ?? 'triangle-list') === 'triangle-list';
}

export function pyramidSize(width: number, height: number) {
  const x = 2 ** Math.ceil(Math.log2(Math.max(1, width)));
  const y = 2 ** Math.ceil(Math.log2(Math.max(1, height)));
  const w = Math.max(1, x / 2), h = Math.max(1, y / 2);
  return { width: w, height: h, levels: Math.floor(Math.log2(Math.max(w, h))) + 1 };
}

/** Widen both float32 rounding and small CPU/GPU transform differences. */
export function packOcclusionBounds(batch: TypeGpuDrawBatch, target: Float32Array, start: number, count: number): void {
  const bounds = batch.visibility!.items;
  for (let index = start; index < start + count; index++) {
    const source = index * 6, dest = index * 8;
    let valid = batch.instances[index * 24 + 7] >= 1;
    for (let axis = 0; axis < 3; axis++) {
      const lo = bounds[source + axis], hi = bounds[source + axis + 3];
      const epsilon = Math.max(0.0001, Math.abs(lo) * 0.00001, Math.abs(hi) * 0.00001);
      target[dest + axis] = lo - epsilon;
      target[dest + axis + 4] = hi + epsilon;
      valid &&= Number.isFinite(lo) && Number.isFinite(hi) && Math.abs(lo) < 1e25 && Math.abs(hi) < 1e25 && lo <= hi;
    }
    target[dest + 3] = Number(valid);
  }
}

interface BatchResource extends OcclusionDraw {
  capacity: number;
  source: GPUBuffer;
  boundsOwner: TypeGpuDrawBatch['visibility'];
  boundsRevision: number;
  boundsCount: number;
  boundsData: Float32Array;
  rangesData: Uint32Array;
  blocksData: Uint32Array;
  bounds: GPUBuffer;
  ranges: GPUBuffer;
  blocks: GPUBuffer;
  prefix: GPUBuffer;
  sums: GPUBuffer;
  offsets: GPUBuffer;
  blockCount: number;
  rangeCount: number;
  visibilityGroup?: TgpuBindGroup<typeof visibilityLayout.entries>;
  rangeGroup: TgpuBindGroup<typeof rangeLayout.entries>;
  compactGroup: TgpuBindGroup<typeof compactLayout.entries>;
}

/** GPU visibility has no asynchronous CPU feedback and never schedules a frame. */
export class HiZOcclusion {
  readonly resources = new Map<string, BatchResource>();
  readonly draws = new Map<string, OcclusionDraw>();
  readonly #params: GPUBuffer;
  readonly #paramsData = new Float32Array(20);
  readonly depthGroup;
  readonly #depthPipelines = new Map<GPUCullMode, ReturnType<typeof createShadowPipeline>>();
  readonly #depthReduce;
  readonly #mipReduce;
  readonly #visibility;
  readonly #rangeScan;
  readonly #compact;
  #depth: GPUTexture | null = null;
  #pyramid: GPUTexture | null = null;
  #depthView: GPUTextureView | null = null;
  #pyramidView: GPUTextureView | null = null;
  #reduceGroups: TgpuBindGroup[] = [];
  #width = 0;
  #height = 0;
  #size = pyramidSize(1, 1);

  constructor(readonly root: TgpuRoot) {
    this.#params = root.device.createBuffer({ label: 'Occlusion camera', size: 80, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.depthGroup = root.createBindGroup(shadowPassBindGroupLayout, { shadow: this.#params });
    this.#depthReduce = root.createComputePipeline({ compute: depthReduce });
    this.#mipReduce = root.createComputePipeline({ compute: mipReduce });
    this.#visibility = root.createComputePipeline({ compute: visibility });
    this.#rangeScan = root.createComputePipeline({ compute: rangeScan });
    this.#compact = root.createComputePipeline({ compute: compact });
  }

  static supported(root: TgpuRoot, width: number, height: number): boolean {
    return root.device.features?.has('indirect-first-instance') === true &&
      Math.max(width, height) <= root.device.limits.maxTextureDimension2D &&
      root.device.limits.maxStorageBuffersPerShaderStage >= 6 &&
      root.device.limits.maxComputeWorkgroupSizeX >= OCCLUSION_BLOCK_SIZE &&
      root.device.limits.maxComputeInvocationsPerWorkgroup >= OCCLUSION_BLOCK_SIZE;
  }

  begin(width: number, height: number, matrix: Float32Array): void {
    this.draws.clear();
    this.#paramsData.set(matrix.subarray(0, 16));
    this.#paramsData[16] = width; this.#paramsData[17] = height;
    this.root.device.queue.writeBuffer(this.#params, 0, this.#paramsData);
    if (width === this.#width && height === this.#height) return;
    this.#depth?.destroy(); this.#pyramid?.destroy();
    this.#width = width; this.#height = height;
    this.#size = pyramidSize(width, height);
    const { device } = this.root;
    this.#depth = device.createTexture({ label: 'Occlusion depth', size: [width, height], format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    this.#pyramid = device.createTexture({ label: 'Occlusion Hi-Z', size: [this.#size.width, this.#size.height], format: 'r32float',
      mipLevelCount: this.#size.levels, usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING });
    this.#depthView = this.#depth.createView(); this.#pyramidView = this.#pyramid.createView();
    const views = Array.from({ length: this.#size.levels }, (_, i) => this.#pyramid!.createView({ baseMipLevel: i, mipLevelCount: 1 }));
    this.#reduceGroups = views.map((target, i) => i === 0
      ? this.root.createBindGroup(depthReduceLayout, { source: this.#depthView!, target })
      : this.root.createBindGroup(mipReduceLayout, { source: views[i - 1], target }));
    for (const resource of this.resources.values()) resource.visibilityGroup = undefined;
  }

  depthPass(encoder: GPUCommandEncoder, timestampWrites?: GPURenderPassTimestampWrites): GPURenderPassEncoder {
    return encoder.beginRenderPass({ label: 'Occlusion depth', timestampWrites, colorAttachments: [], depthStencilAttachment: {
      view: this.#depthView!, depthLoadOp: 'clear', depthStoreOp: 'store', depthClearValue: 1
    } });
  }

  depthPipeline(cullMode: GPUCullMode = 'back') {
    let pipeline = this.#depthPipelines.get(cullMode);
    if (!pipeline) {
      pipeline = createShadowPipeline(this.root, { cullMode, depthBias: 0, depthBiasSlopeScale: 0 });
      this.#depthPipelines.set(cullMode, pipeline);
    }
    return pipeline;
  }

  updateBounds(batch: TypeGpuDrawBatch, dirty?: TypeGpuInstanceDirtyRange[]): void {
    const resource = this.resources.get(batch.key);
    if (!resource || !batch.visibility || batch.instanceCount > resource.capacity) return;
    const full = resource.boundsOwner !== batch.visibility || resource.boundsCount !== batch.instanceCount;
    if (!full && resource.boundsRevision === batch.visibility.revision && !dirty?.length) return;
    const ranges = !full && dirty?.length ? dirty : [{ start: 0, count: batch.instanceCount }];
    for (const range of ranges) {
      packOcclusionBounds(batch, resource.boundsData, range.start, range.count);
      if (range.count) this.root.device.queue.writeBuffer(resource.bounds, range.start * 32,
        resource.boundsData.buffer, range.start * 32, range.count * 32);
    }
    resource.boundsOwner = batch.visibility;
    resource.boundsRevision = batch.visibility.revision;
    resource.boundsCount = batch.instanceCount;
  }

  prepare(batch: TypeGpuDrawBatch, selection: OcclusionRanges, variants: readonly TypeGpuDrawBatch[] | undefined, source: GPUBuffer): boolean {
    if (!selection.rangeCount || selection.rangeCount > MAX_OCCLUSION_RANGES) return false;
    const capacity = 2 ** Math.ceil(Math.log2(Math.max(1, batch.instanceCount)));
    const limits = this.root.device.limits;
    if (capacity * 96 > Math.min(limits.maxStorageBufferBindingSize, limits.maxBufferSize) ||
      Math.ceil(capacity / 128) + MAX_OCCLUSION_RANGES > limits.maxComputeWorkgroupsPerDimension) return false;
    let r = this.resources.get(batch.key);
    if (!r || r.capacity < capacity || r.source !== source) {
      if (r) this.#destroyBatch(r);
      r = this.#createBatch(batch.key, capacity, source);
      this.resources.set(batch.key, r);
    }
    this.updateBounds(batch);
    let changed = r.rangeCount !== selection.rangeCount;
    for (let i = 0; i < selection.rangeCount; i++) {
      const geometry = variants?.[selection.levels?.[i] ?? 0].geometry ?? batch.geometry;
      const offset = i * 8;
      const first = selection.ranges[i * 2], count = selection.ranges[i * 2 + 1];
      const drawCount = geometry.indexCount ?? geometry.vertexCount, indexed = Number(!!geometry.indexCount);
      changed ||= r.rangesData[offset + 2] !== first || r.rangesData[offset + 3] !== count ||
        r.rangesData[offset + 4] !== drawCount || r.rangesData[offset + 5] !== indexed;
      r.rangesData[offset + 2] = first; r.rangesData[offset + 3] = count;
      r.rangesData[offset + 4] = drawCount; r.rangesData[offset + 5] = indexed;
    }
    if (changed) {
      r.blockCount = 0; r.rangeCount = selection.rangeCount;
      for (let i = 0; i < selection.rangeCount; i++) {
        const offset = i * 8, first = r.rangesData[offset + 2], count = r.rangesData[offset + 3];
        r.rangesData[offset] = r.blockCount;
        r.rangesData[offset + 1] = Math.ceil(count / 128);
        r.rangesData[offset + 7] = 1;
        for (let j = 0; j < count; j += 128) {
          const block = r.blockCount++ * 4;
          r.blocksData[block] = first + j; r.blocksData[block + 1] = Math.min(128, count - j); r.blocksData[block + 2] = i;
        }
      }
      r.rangesData.fill(0, selection.rangeCount * 8);
      this.root.device.queue.writeBuffer(r.ranges, 0, r.rangesData.buffer as ArrayBuffer);
      this.root.device.queue.writeBuffer(r.blocks, 0, r.blocksData.buffer, 0, r.blockCount * 16);
    }
    r.visibilityGroup ??= this.root.createBindGroup(visibilityLayout, {
      params: this.#params, pyramid: this.#pyramidView!, bounds: r.bounds, blocks: r.blocks, prefix: r.prefix, sums: r.sums
    });
    this.draws.set(batch.key, r);
    return true;
  }

  encode(encoder: GPUCommandEncoder, timing?: GpuTiming): void {
    let width = this.#size.width, height = this.#size.height;
    for (let i = 0; i < this.#reduceGroups.length; i++) {
      const pass = encoder.beginComputePass({ label: 'Occlusion pyramid', timestampWrites: timing?.writes('pyramid') });
      (i === 0 ? this.#depthReduce : this.#mipReduce).with(pass).with(this.#reduceGroups[i])
        .dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8));
      pass.end();
      width = Math.max(1, width / 2); height = Math.max(1, height / 2);
    }
    for (const key of this.draws.keys()) {
      const r = this.resources.get(key)!;
      const pass = encoder.beginComputePass({ label: 'Occlusion selection', timestampWrites: timing?.writes('selection') });
      this.#visibility.with(pass).with(r.visibilityGroup!).dispatchWorkgroups(r.blockCount);
      this.#rangeScan.with(pass).with(r.rangeGroup).dispatchWorkgroups(Math.ceil(r.rangeCount / 64));
      this.#compact.with(pass).with(r.compactGroup).dispatchWorkgroups(r.blockCount);
      pass.end();
    }
  }

  prune(keys: Set<string>): void {
    for (const [key, resource] of this.resources) if (!keys.has(key)) {
      this.#destroyBatch(resource); this.resources.delete(key); this.draws.delete(key);
    }
  }

  dispose(): void {
    this.#depth?.destroy(); this.#pyramid?.destroy(); this.#params.destroy();
    for (const resource of this.resources.values()) this.#destroyBatch(resource);
    this.resources.clear(); this.draws.clear(); this.#reduceGroups = [];
  }

  #createBatch(key: string, capacity: number, source: GPUBuffer): BatchResource {
    const make = (name: string, size: number, usage = 0) => this.root.device.createBuffer({
      label: `Occlusion ${name} ${key}`, size, usage: usage | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
    });
    const blockCapacity = Math.ceil(capacity / 128) + MAX_OCCLUSION_RANGES;
    const bounds = make('bounds', capacity * 32), ranges = make('ranges', MAX_OCCLUSION_RANGES * 32);
    const blocks = make('blocks', blockCapacity * 16), prefix = make('prefix', capacity * 4);
    const sums = make('sums', blockCapacity * 4), offsets = make('offsets', blockCapacity * 4);
    const args = make('indirect', MAX_OCCLUSION_RANGES * 32, GPUBufferUsage.INDIRECT);
    const instances = make('instances', capacity * 96, GPUBufferUsage.VERTEX);
    return { capacity, source, bounds, ranges, blocks, prefix, sums, offsets, args, instances,
      boundsOwner: undefined, boundsRevision: -1, boundsCount: -1, blockCount: 0, rangeCount: 0,
      boundsData: new Float32Array(capacity * 8), rangesData: new Uint32Array(MAX_OCCLUSION_RANGES * 8),
      blocksData: new Uint32Array(blockCapacity * 4),
      rangeGroup: this.root.createBindGroup(rangeLayout, { ranges, sums, offsets, args }),
      compactGroup: this.root.createBindGroup(compactLayout, { source, target: instances, blocks, prefix, offsets, ranges }) };
  }

  #destroyBatch(r: BatchResource): void {
    for (const buffer of [r.bounds, r.ranges, r.blocks, r.prefix, r.sums, r.offsets, r.args, r.instances]) buffer.destroy();
  }
}
