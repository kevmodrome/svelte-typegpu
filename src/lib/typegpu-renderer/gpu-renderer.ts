import tgpu, {
  d,
  type TgpuBindGroup,
  type TgpuBuffer,
  type TgpuRenderPipeline,
  type TgpuRoot,
  type TgpuVertexLayout,
  type UniformFlag
} from 'typegpu';
import { createFpsMeter } from '../fps-meter';
import {
  MESH_SPIN_OFFSET_OFFSET,
  MESH_SPIN_SPEED_OFFSET
} from './instance-data';
import { createViewProjectionMatrix } from './camera-math';
import { createContinuityTracker } from './continuity';
import { DEPTH_FORMAT } from './render-constants';
import { createMeshPipeline } from './typegpu-pipeline';
import {
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  typegpuSceneUniformSchema
} from './typegpu-layouts';
import type {
  TypeGpuCameraSettings,
  TypeGpuDrawBatch,
  TypeGpuInstanceDirtyRange,
  TypeGpuSceneState
} from './types';

// Keep the TypeGPU scene uniform buffer at 96 bytes, matching the explicit padding schema.
export const SCENE_UNIFORM_FLOATS = TYPEGPU_SCENE_UNIFORM_FLOATS;
const DEGREES_TO_RADIANS = Math.PI / 180;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const DEFAULT_TYPEGPU_CAMERA: TypeGpuCameraSettings = {
  position: [9, 7, 13],
  lookAt: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

interface TypeGpuBatchBuffers {
  geometryKey: string;
  instanceBuffer: TypeGpuVertexBuffer | null;
  instanceBufferByteLength: number;
  instanceCount: number;
  vertexBuffer: TypeGpuVertexBuffer;
}

interface TypeGpuVertexBuffer {
  buffer: GPUBuffer;
  write(data: ArrayBuffer, options?: { startOffset?: number; endOffset?: number }): void;
  destroy(): void;
}

type TypeGpuSceneUniformBuffer = TgpuBuffer<typeof typegpuSceneUniformSchema> & UniformFlag;

export interface TypeGpuRenderer {
  setScene(scene: TypeGpuSceneState): void;
  dispose(): void;
}

export interface TypeGpuRendererOptions {
  canvas: HTMLCanvasElement;
  onFps?: (fps: number) => void;
}

export async function createTypeGpuRenderer({
  canvas,
  onFps = () => {}
}: TypeGpuRendererOptions): Promise<TypeGpuRenderer> {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not available in this browser.');
  }

  const root = await tgpu.init({ unstable_names: 'strict' });
  const renderer = new TypeGpuSceneRenderer(root, canvas, onFps);
  renderer.start();

  return renderer;
}

class TypeGpuSceneRenderer implements TypeGpuRenderer {
  #camera = { ...DEFAULT_TYPEGPU_CAMERA };
  #context: GPUCanvasContext;
  #continuity = createContinuityTracker();
  #depthTexture: GPUTexture | null = null;
  #disposed = false;
  #drawBatches: TypeGpuDrawBatch[] = [];
  #frame = 0;
  #batchBuffers = new Map<string, TypeGpuBatchBuffers>();
  #lastTimestamp = 0;
  #bindGroup: TgpuBindGroup;
  #fpsMeter;
  #pipeline: TgpuRenderPipeline;
  #projectionDirty = true;
  #rawBindGroup: GPUBindGroup;
  #rawPipeline: GPURenderPipeline;
  #renderSize = { width: 0, height: 0 };
  #scale = 1;
  #animationSpeed = 1;
  #animationOffset = 0;
  #colorShift = 0;
  #time = 0;
  #uniformData = new Float32Array(SCENE_UNIFORM_FLOATS);
  #uniformBuffer: TypeGpuSceneUniformBuffer;

  constructor(
    private readonly root: TgpuRoot,
    private readonly canvas: HTMLCanvasElement,
    private readonly onFps: (fps: number) => void
  ) {
    const format = navigator.gpu.getPreferredCanvasFormat();

    this.#fpsMeter = createFpsMeter((fps) => onFps(fps));
    this.#context = root.configureContext({
      canvas,
      format,
      alphaMode: 'premultiplied'
    });
    this.#uniformBuffer = root
      .createBuffer(typegpuSceneUniformSchema)
      .$usage('uniform')
      .$name('TypeGPU scene uniforms');
    this.#bindGroup = root.createBindGroup(sceneBindGroupLayout, { scene: this.#uniformBuffer });
    this.#pipeline = createMeshPipeline(root, format);
    this.#rawBindGroup = root.unwrap(this.#bindGroup);
    this.#rawPipeline = root.unwrap(this.#pipeline);
    this.setScene({
      camera: DEFAULT_TYPEGPU_CAMERA,
      scale: 1,
      animationSpeed: 1,
      colorShift: 0,
      lights: [],
      lightsChanged: true,
      drawBatches: []
    });
  }

  setScene(scene: TypeGpuSceneState): void {
    if (this.#disposed) return;

    this.#camera = scene.camera;
    this.#projectionDirty = true;
    this.#scale = scene.scale;
    this.#setAnimationSpeed(scene.animationSpeed);
    this.#colorShift = scene.colorShift;
    this.#drawBatches = scene.drawBatches;
    this.#pruneBatchBuffers(scene.drawBatches);

    for (const batch of scene.drawBatches) {
      const buffers = this.#ensureBatchBuffers(batch);

      if (batch.instancesChanged || !buffers.instanceBuffer) {
        const dirtyRanges = batch.dirtyRanges.length
          ? batch.dirtyRanges
          : batch.instanceCount > 0
            ? [{ start: 0, count: batch.instanceCount }]
            : [];

        this.#uploadInstances(buffers, this.#applyContinuity(batch, dirtyRanges), batch, dirtyRanges);
      }

      buffers.instanceCount = batch.instanceCount;
    }
  }

  start(): void {
    this.#frame = requestAnimationFrame((timestamp) => this.#render(timestamp));
  }

  dispose(): void {
    if (this.#disposed) return;

    this.#disposed = true;
    cancelAnimationFrame(this.#frame);
    this.#depthTexture?.destroy();
    for (const buffers of this.#batchBuffers.values()) {
      buffers.instanceBuffer?.destroy();
      buffers.vertexBuffer.destroy();
    }
    this.#uniformBuffer.destroy();
    this.root.destroy();
  }

  #ensureBatchBuffers(batch: TypeGpuDrawBatch): TypeGpuBatchBuffers {
    const existing = this.#batchBuffers.get(batch.key);

    if (existing && existing.geometryKey === batch.geometry.key) {
      return existing;
    }

    existing?.instanceBuffer?.destroy();
    existing?.vertexBuffer.destroy();

    const buffers = {
      geometryKey: batch.geometry.key,
      instanceBuffer: null,
      instanceBufferByteLength: 0,
      instanceCount: 0,
      vertexBuffer: createAndUploadBuffer(
        this.root,
        meshVertexLayout,
        `TypeGPU ${batch.geometry.key} vertices`,
        batch.geometry.vertexData
      )
    };

    this.#batchBuffers.set(batch.key, buffers);
    return buffers;
  }

  #pruneBatchBuffers(drawBatches: TypeGpuDrawBatch[]): void {
    const liveKeys = new Set(drawBatches.map((batch) => batch.key));

    for (const [key, buffers] of this.#batchBuffers) {
      if (liveKeys.has(key)) continue;

      buffers.instanceBuffer?.destroy();
      buffers.vertexBuffer.destroy();
      this.#batchBuffers.delete(key);
    }
  }

  #setAnimationSpeed(nextSpeed: number): void {
    if (this.#animationSpeed === nextSpeed) return;

    this.#animationOffset += this.#time * (this.#animationSpeed - nextSpeed);
    this.#animationSpeed = nextSpeed;
  }

  #uploadInstances(
    buffers: TypeGpuBatchBuffers,
    instanceData: Float32Array,
    batch: TypeGpuDrawBatch,
    dirtyRanges: TypeGpuInstanceDirtyRange[]
  ): void {
    const byteLength = Math.max(meshInstanceLayout.stride, instanceData.byteLength);

    if (!buffers.instanceBuffer || buffers.instanceBufferByteLength !== byteLength) {
      buffers.instanceBuffer?.destroy();
      buffers.instanceBuffer = createAndUploadBuffer(
        this.root,
        meshInstanceLayout,
        `TypeGPU ${batch.key} instances`,
        instanceData
      );
      buffers.instanceBufferByteLength = byteLength;
    } else {
      for (const range of dirtyRanges) {
        writeFloat32BufferRange(
          buffers.instanceBuffer,
          instanceData,
          range.start * batch.floatsPerInstance,
          range.count * batch.floatsPerInstance
        );
      }
    }
  }

  #applyContinuity(
    batch: TypeGpuDrawBatch,
    dirtyRanges: TypeGpuInstanceDirtyRange[]
  ): Float32Array {
    this.#continuity.prune(this.#drawBatches.flatMap((drawBatch) => drawBatch.instanceIds));

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

    return batch.instances;
  }

  #render(timestamp: number): void {
    if (this.#disposed) return;

    const device = this.root.device;
    const delta = this.#lastTimestamp ? Math.min(48, timestamp - this.#lastTimestamp) : 0;
    this.#lastTimestamp = timestamp;

    this.#time += (delta / 16.67) * 0.018;

    this.#resize();
    this.#writeUniforms();

    if (this.#depthTexture) {
      const encoder = device.createCommandEncoder({ label: 'TypeGPU frame' });
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.#context.getCurrentTexture().createView(),
            loadOp: 'clear',
            storeOp: 'store',
            clearValue: { r: 0.067, g: 0.078, b: 0.102, a: 1 }
          }
        ],
        depthStencilAttachment: {
          view: this.#depthTexture.createView(),
          depthClearValue: 1,
          depthLoadOp: 'clear',
          depthStoreOp: 'store'
        }
      });

      pass.setPipeline(this.#rawPipeline);
      pass.setBindGroup(0, this.#rawBindGroup);

      for (const batch of this.#drawBatches) {
        const buffers = this.#batchBuffers.get(batch.key);
        if (!buffers?.instanceBuffer || buffers.instanceCount === 0) continue;

        pass.setVertexBuffer(0, buffers.vertexBuffer.buffer);
        pass.setVertexBuffer(1, buffers.instanceBuffer.buffer);
        pass.draw(batch.geometry.vertexCount, buffers.instanceCount);
      }

      pass.end();
      device.queue.submit([encoder.finish()]);
    }

    this.#fpsMeter.record(timestamp);
    this.#frame = requestAnimationFrame((nextTimestamp) => this.#render(nextTimestamp));
  }

  #resize(): void {
    const dpr = Math.min(MAX_DEVICE_PIXEL_RATIO, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));

    if (this.#renderSize.width === width && this.#renderSize.height === height) return;

    this.canvas.width = width;
    this.canvas.height = height;
    this.#renderSize = { width, height };
    this.#depthTexture?.destroy();
    this.#depthTexture = this.root.device.createTexture({
      label: 'TypeGPU depth texture',
      size: { width, height },
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT
    });
    this.#projectionDirty = true;
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

function arrayBufferFor(data: Float32Array): ArrayBuffer {
  if (data.byteOffset === 0 && data.byteLength === data.buffer.byteLength) {
    return data.buffer as ArrayBuffer;
  }

  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
}
