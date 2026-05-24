import {
  d,
  type IndexFlag,
  type SampledFlag,
  type TgpuBindGroup,
  type TgpuBuffer,
  type TgpuFixedSampler,
  type TgpuRoot,
  type TgpuTexture,
  type TgpuVertexLayout
} from 'typegpu';
import { DEFAULT_SAMPLER, textureKeyFor } from './material-descriptors';
import { createMeshPipeline } from './typegpu-pipeline';
import { materialBindGroupLayout, meshInstanceLayout, meshVertexLayout } from './typegpu-layouts';
import type {
  TypeGpuDrawBatch,
  TypeGpuInstanceDirtyRange,
  TypeGpuMaterialDescriptor,
  TypeGpuSamplerDescriptor,
  TypeGpuTextureSource
} from './types';

type TypeGpuVertexBuffer = {
  buffer: GPUBuffer;
  write(data: ArrayBuffer, options?: { startOffset?: number; endOffset?: number }): void;
  destroy(): void;
};
type TypeGpuIndexBuffer = TgpuBuffer<ReturnType<typeof d.arrayOf>> & IndexFlag;

type TypeGpuMaterialTexture = TgpuTexture & SampledFlag;
type TypeGpuMeshPipeline = ReturnType<typeof createMeshPipeline>;
type TypeGpuExternalImageSource =
  | HTMLCanvasElement
  | HTMLImageElement
  | HTMLVideoElement
  | ImageBitmap
  | ImageData
  | OffscreenCanvas
  | VideoFrame;

export interface LoadedTextureImage {
  source: TypeGpuExternalImageSource | Uint8Array | Uint8ClampedArray | Float32Array;
  width: number;
  height: number;
  close(): void;
}

export interface TypeGpuVertexBufferResource {
  key: string;
  vertexBuffer: TypeGpuVertexBuffer;
  indexBuffer?: TypeGpuIndexBuffer;
  vertexCount: number;
  indexCount?: number;
  indexFormat?: GPUIndexFormat;
}

export interface TypeGpuInstanceBufferResource {
  key: string;
  buffer: TypeGpuVertexBuffer | null;
  byteLength: number;
  instanceCount: number;
}

export interface TypeGpuTextureResource {
  key: string;
  texture: TypeGpuMaterialTexture;
  width: number;
  height: number;
  generation: number;
  status: 'ready' | 'loading' | 'failed' | 'fallback';
}

export interface TypeGpuMaterialResource {
  key: string;
  textureKey: string;
  samplerKey: string;
  bindGroup: TgpuBindGroup<typeof materialBindGroupLayout.entries>;
  status: TypeGpuTextureResource['status'];
}

export class GeometryResourceCache {
  readonly #resources = new Map<string, TypeGpuVertexBufferResource>();

  constructor(private readonly root: TgpuRoot) {}

  getOrCreate(batch: TypeGpuDrawBatch): TypeGpuVertexBufferResource {
    const key = batch.geometryKey;
    const existing = this.#resources.get(key);

    if (existing) return existing;

    const resource = {
      key,
      vertexBuffer: createAndUploadBuffer(
        this.root,
        meshVertexLayout,
        `TypeGPU ${batch.geometry.key} vertices`,
        batch.geometry.vertexData
      ),
      indexBuffer: batch.geometry.indexData
        ? createAndUploadIndexBuffer(
            this.root,
            `TypeGPU ${batch.geometry.key} indices`,
            batch.geometry.indexData
          )
        : undefined,
      vertexCount: batch.geometry.vertexCount,
      indexCount: batch.geometry.indexCount,
      indexFormat: batch.geometry.indexFormat
    };

    this.#resources.set(key, resource);
    return resource;
  }

  prune(liveKeys: Set<string>): void {
    for (const [key, resource] of this.#resources) {
      if (liveKeys.has(key)) continue;

      resource.vertexBuffer.destroy();
      resource.indexBuffer?.destroy();
      this.#resources.delete(key);
    }
  }

  dispose(): void {
    for (const resource of this.#resources.values()) {
      resource.vertexBuffer.destroy();
      resource.indexBuffer?.destroy();
    }

    this.#resources.clear();
  }
}

export class InstanceBufferCache {
  readonly #resources = new Map<string, TypeGpuInstanceBufferResource>();

  constructor(private readonly root: TgpuRoot) {}

  getOrCreate(batch: TypeGpuDrawBatch): TypeGpuInstanceBufferResource {
    const existing = this.#resources.get(batch.key);

    if (existing) return existing;

    const resource = {
      key: batch.key,
      buffer: null,
      byteLength: 0,
      instanceCount: 0
    };

    this.#resources.set(batch.key, resource);
    return resource;
  }

  upload(batch: TypeGpuDrawBatch, dirtyRanges: TypeGpuInstanceDirtyRange[]): void {
    const resource = this.getOrCreate(batch);
    const byteLength = Math.max(meshInstanceLayout.stride, batch.instances.byteLength);

    if (!resource.buffer || resource.byteLength !== byteLength) {
      resource.buffer?.destroy();
      resource.buffer = createAndUploadBuffer(
        this.root,
        meshInstanceLayout,
        `TypeGPU ${batch.key} instances`,
        batch.instances
      );
      resource.byteLength = byteLength;
      resource.instanceCount = batch.instanceCount;
      return;
    }

    for (const range of dirtyRanges) {
      writeFloat32BufferRange(
        resource.buffer,
        batch.instances,
        range.start * batch.floatsPerInstance,
        range.count * batch.floatsPerInstance
      );
    }

    resource.instanceCount = batch.instanceCount;
  }

  prune(liveBatchKeys: Set<string>): void {
    for (const [key, resource] of this.#resources) {
      if (liveBatchKeys.has(key)) continue;

      resource.buffer?.destroy();
      this.#resources.delete(key);
    }
  }

  dispose(): void {
    for (const resource of this.#resources.values()) {
      resource.buffer?.destroy();
    }

    this.#resources.clear();
  }
}

export class TextureResourceCache {
  #disposed = false;
  readonly #fallback: TypeGpuTextureResource;
  readonly #resources = new Map<string, TypeGpuTextureResource>();

  constructor(
    private readonly root: TgpuRoot,
    private readonly onSettled: () => void = () => {}
  ) {
    const texture = this.root.createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      dimension: '2d'
    })
      .$usage('sampled')
      .$name('TypeGPU fallback white texture');

    texture.write(new Uint8Array([255, 255, 255, 255]));
    this.#fallback = {
      key: 'solid:white',
      texture,
      width: 1,
      height: 1,
      generation: 0,
      status: 'fallback'
    };
    this.#resources.set(this.#fallback.key, this.#fallback);
  }

  getOrLoad(source: TypeGpuTextureSource | null): TypeGpuTextureResource {
    const key = textureResourceKey(source);

    if (key === this.#fallback.key || !source) {
      return this.#fallback;
    }

    const existing = this.#resources.get(key);
    if (existing) return existing;

    const resource = {
      key,
      texture: this.#fallback.texture,
      width: textureSourceWidth(source),
      height: textureSourceHeight(source),
      generation: 0,
      status: 'loading' as const
    };
    const generation = (resource.generation += 1);

    this.#resources.set(key, resource);
    void this.#load(resource, source, generation);
    return resource;
  }

  prune(liveKeys: Set<string>): void {
    for (const [key, resource] of this.#resources) {
      if (key === this.#fallback.key || liveKeys.has(key)) continue;

      if (resource.texture !== this.#fallback.texture) {
        resource.texture.destroy();
      }

      resource.generation += 1;
      this.#resources.delete(key);
    }
  }

  dispose(): void {
    this.#disposed = true;

    for (const resource of this.#resources.values()) {
      resource.generation += 1;

      if (resource.texture !== this.#fallback.texture) {
        resource.texture.destroy();
      }
    }

    this.#fallback.texture.destroy();
    this.#resources.clear();
  }

  async #load(
    resource: TypeGpuTextureResource,
    source: TypeGpuTextureSource,
    generation: number
  ): Promise<void> {
    let image: LoadedTextureImage | null = null;
    let texture: TypeGpuMaterialTexture | null = null;

    try {
      image = await loadMaterialTextureImageSource(source);

      if (!this.#isLiveResource(resource, generation)) {
        image.close();
        image = null;
        return;
      }

      const root = this.root;
      texture = root.createTexture({
        size: [image.width, image.height],
        format: source.format ?? 'rgba8unorm',
        dimension: '2d'
      })
        .$usage('sampled')
        .$name(`TypeGPU material texture ${textureSourceLabel(source)}`);

      writeLoadedTexture(texture, image);

      if (!this.#isLiveResource(resource, generation)) {
        texture.destroy();
        texture = null;
        image.close();
        image = null;
        return;
      }

      if (resource.texture !== this.#fallback.texture) {
        resource.texture.destroy();
      }

      resource.texture = texture;
      resource.width = image.width;
      resource.height = image.height;
      resource.status = 'ready';
      texture = null;
      this.onSettled();
    } catch {
      texture?.destroy();

      if (this.#isLiveResource(resource, generation)) {
        resource.texture = this.#fallback.texture;
        resource.width = 1;
        resource.height = 1;
        resource.status = 'failed';
        this.onSettled();
      }
    } finally {
      image?.close();
    }
  }

  #isLiveResource(resource: TypeGpuTextureResource, generation: number): boolean {
    if (resource.generation !== generation) return false;

    return (
      !this.#disposed &&
      this.#resources.get(resource.key) === resource
    );
  }
}

export class SamplerResourceCache {
  readonly #resources = new Map<string, TgpuFixedSampler>();

  constructor(private readonly root: TgpuRoot) {}

  getOrCreate(descriptor: TypeGpuSamplerDescriptor): TgpuFixedSampler {
    const key = descriptor.key;
    const existing = this.#resources.get(key);

    if (existing) return existing;

    const root = this.root;
    const sampler = root.createSampler({
      magFilter: descriptor.magFilter,
      minFilter: descriptor.minFilter,
      mipmapFilter: descriptor.mipmapFilter,
      addressModeU: descriptor.addressModeU,
      addressModeV: descriptor.addressModeV,
      addressModeW: descriptor.addressModeW
    });

    this.#resources.set(key, sampler);
    return sampler;
  }

  prune(liveKeys: Set<string>): void {
    for (const key of this.#resources.keys()) {
      if (!liveKeys.has(key)) this.#resources.delete(key);
    }
  }
}

export class MaterialResourceCache {
  readonly #resources = new Map<string, TypeGpuMaterialResource>();

  constructor(
    private readonly root: TgpuRoot,
    private readonly textureResources: TextureResourceCache,
    private readonly samplerResources: SamplerResourceCache
  ) {}

  getOrCreate(material: TypeGpuMaterialDescriptor): TypeGpuMaterialResource {
    const key = materialResourceKeyFor(material);
    const textureResource = this.textureResources.getOrLoad(material.map ?? material.texture ?? null);
    const samplerResource = this.samplerResources.getOrCreate(material.sampler ?? DEFAULT_SAMPLER);
    const samplerKey = material.samplerKey ?? DEFAULT_SAMPLER.key;
    const existing = this.#resources.get(key);

    if (
      existing &&
      existing.textureKey === textureResource.key &&
      existing.samplerKey === samplerKey &&
      existing.status === textureResource.status
    ) {
      return existing;
    }

    const root = this.root;
    const resource = {
      key,
      textureKey: textureResource.key,
      samplerKey,
      bindGroup: root.createBindGroup(materialBindGroupLayout, {
        baseColorTexture: textureResource.texture,
        baseColorSampler: samplerResource
      }),
      status: textureResource.status
    };

    this.#resources.set(key, resource);
    return resource;
  }

  prune(liveKeys: Set<string>): void {
    for (const key of this.#resources.keys()) {
      if (!liveKeys.has(key)) this.#resources.delete(key);
    }
  }

  dispose(): void {
    this.#resources.clear();
  }
}

export class PipelineResourceCache {
  readonly #resources = new Map<string, TypeGpuMeshPipeline>();

  constructor(
    private readonly root: TgpuRoot,
    private readonly format: GPUTextureFormat
  ) {}

  getOrCreate(batch: TypeGpuDrawBatch, depth = true): TypeGpuMeshPipeline {
    const key = pipelineResourceKeyFor(batch, depth);
    const existing = this.#resources.get(key);

    if (existing) return existing;

    const pipeline = createMeshPipeline(this.root, this.format, meshPipelineOptionsFor(batch, depth));
    this.#resources.set(key, pipeline);
    return pipeline;
  }

  prune(liveKeys: Set<string>): void {
    for (const key of this.#resources.keys()) {
      if (!liveKeys.has(key)) this.#resources.delete(key);
    }
  }
}

export function pipelineResourceKeyFor(batch: TypeGpuDrawBatch, depth: boolean): string {
  return [
    batch.pipelineKey,
    meshMaterialPipelineKeyFor(batch.material),
    `sceneDepth:${depth ? 'enabled' : 'disabled'}`
  ].join('|');
}

export function materialResourceKeyFor(material: TypeGpuMaterialDescriptor): string {
  return material.bindGroupKey ?? [
    material.textureKey ?? 'solid:white',
    material.samplerKey ?? DEFAULT_SAMPLER.key
  ].join('|');
}

function meshPipelineOptionsFor(batch: TypeGpuDrawBatch, depth: boolean) {
  return {
    depth,
    blendMode: batch.material.blendMode ?? 'opaque',
    cullMode: batch.material.cullMode ?? 'back',
    depthWrite: batch.material.depthWrite !== false,
    depthTest: batch.material.depthTest !== false
  };
}

function meshMaterialPipelineKeyFor(material: TypeGpuMaterialDescriptor): string {
  return [
    material.pipelineKey ?? 'pipeline:mesh',
    `blend:${material.blendMode ?? 'opaque'}`,
    `depthWrite:${material.depthWrite !== false}`,
    `depthTest:${material.depthTest !== false}`,
    `cull:${material.cullMode ?? 'back'}`
  ].join('|');
}

export async function loadMaterialTextureImageSource(
  source: TypeGpuTextureSource
): Promise<LoadedTextureImage> {
  if (source.kind === 'data') {
    return {
      source: source.data,
      width: source.width ?? 1,
      height: source.height ?? 1,
      close: () => {}
    };
  }

  if (source.kind === 'embedded') {
    const bytes = new Uint8Array(source.data.byteLength);
    bytes.set(source.data);
    return loadTextureBlob(new Blob([bytes], { type: source.mimeType }));
  }

  return loadUrlTextureImageSource(source.src);
}

async function loadUrlTextureImageSource(src: string): Promise<LoadedTextureImage> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`Failed to load material texture ${src}: ${response.status}`);
  }

  const blob = await response.blob();

  return loadTextureBlob(blob);
}

async function loadTextureBlob(blob: Blob): Promise<LoadedTextureImage> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(blob);

      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        close: () => bitmap.close()
      };
    } catch {
      // Some browsers cannot decode SVG blobs through createImageBitmap, but they can
      // decode them as HTML images that we rasterize before uploading with TypeGPU.
    }
  }

  return loadHtmlTextureImage(blob);
}

function textureSourceLabel(source: TypeGpuTextureSource): string {
  return source.kind === 'url' ? source.src : source.key;
}

function textureResourceKey(source: TypeGpuTextureSource | null): string {
  return source?.key ?? textureKeyFor(source);
}

function textureSourceWidth(source: TypeGpuTextureSource): number {
  return source.kind === 'data' ? (source.width ?? 1) : 1;
}

function textureSourceHeight(source: TypeGpuTextureSource): number {
  return source.kind === 'data' ? (source.height ?? 1) : 1;
}

function loadHtmlTextureImage(blob: Blob): Promise<LoadedTextureImage> {
  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;

  return image
    .decode()
    .then(() => ({
      width: image.naturalWidth || image.width,
      height: image.naturalHeight || image.height,
      source: rasterizeImage(image, image.naturalWidth || image.width, image.naturalHeight || image.height),
      close: () => {
        URL.revokeObjectURL(objectUrl);
        image.removeAttribute('src');
      }
    }))
    .catch((error: unknown) => {
      URL.revokeObjectURL(objectUrl);
      image.removeAttribute('src');
      throw error;
    });
}

function writeLoadedTexture(texture: TypeGpuMaterialTexture, image: LoadedTextureImage): void {
  if (image.source instanceof Uint8ClampedArray) {
    texture.write(
      new Uint8Array(image.source.buffer, image.source.byteOffset, image.source.byteLength)
    );
    return;
  }

  if (image.source instanceof Uint8Array || image.source instanceof Float32Array) {
    texture.write(image.source);
    return;
  }

  texture.write(image.source);
}

function rasterizeImage(image: CanvasImageSource, width: number, height: number): Uint8ClampedArray {
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;

  if (!context) {
    throw new Error('Unable to rasterize material texture.');
  }

  context.drawImage(image, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

function createAndUploadBuffer(
  root: TgpuRoot,
  layout: TgpuVertexLayout,
  label: string,
  data: Float32Array
): TypeGpuVertexBuffer {
  const byteLength = Math.max(layout.stride, data.byteLength);
  const buffer = root
    .createBuffer(d.arrayOf(d.f32, byteLength / Float32Array.BYTES_PER_ELEMENT))
    .$usage('vertex')
    .$name(label);

  if (data.length > 0) {
    buffer.write(arrayBufferFor(data));
  }

  return buffer;
}

function createAndUploadIndexBuffer(
  root: TgpuRoot,
  label: string,
  data: Uint16Array | Uint32Array
): TypeGpuIndexBuffer {
  const schema = data instanceof Uint16Array
    ? d.arrayOf(d.u16, Math.max(1, data.length))
    : d.arrayOf(d.u32, Math.max(1, data.length));
  const buffer = root
    .createBuffer(schema as never)
    .$usage('index')
    .$name(label) as TypeGpuIndexBuffer;

  if (data.length > 0) {
    buffer.write(arrayBufferFor(data));
  }

  return buffer;
}

function writeFloat32BufferRange(
  buffer: TypeGpuVertexBuffer,
  data: Float32Array,
  startFloat: number,
  floatCount: number
): void {
  if (floatCount === 0) return;

  const startByte = startFloat * Float32Array.BYTES_PER_ELEMENT;
  const endByte = startByte + floatCount * Float32Array.BYTES_PER_ELEMENT;

  buffer.write(arrayBufferFor(data.subarray(startFloat, startFloat + floatCount)), {
    startOffset: startByte,
    endOffset: endByte
  });
}

function arrayBufferFor(data: Float32Array | Uint16Array | Uint32Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
