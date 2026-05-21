import tgpu, { type TgpuRoot } from 'typegpu';
import { createFpsMeter } from '../fps-meter';
import {
  PRIMITIVE_INSTANCE_FLOATS,
  PRIMITIVE_SPIN_OFFSET_OFFSET,
  PRIMITIVE_SPIN_SPEED_OFFSET,
  PRIMITIVE_VERTEX_FLOATS
} from './instance-data';
import { createViewProjectionMatrix } from './camera-math';
import { createContinuityTracker } from './continuity';
import type {
  TypeGpuCameraSettings,
  TypeGpuDrawBatch,
  TypeGpuInstanceDirtyRange,
  TypeGpuSceneState
} from './types';

// WGSL aligns the trailing vec3 padding to its own 16-byte slot, so the struct is 96 bytes.
export const SCENE_UNIFORM_FLOATS = 24;
const MAX_DEVICE_PIXEL_RATIO = 1.5;
const DEPTH_FORMAT: GPUTextureFormat = 'depth24plus';
const DEFAULT_TYPEGPU_CAMERA: TypeGpuCameraSettings = {
  position: [9, 7, 13],
  lookAt: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

interface TypeGpuBatchBuffers {
  geometryKey: string;
  instanceBuffer: GPUBuffer | null;
  instanceBufferByteLength: number;
  instanceCount: number;
  vertexBuffer: GPUBuffer;
}

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
  #bindGroup: GPUBindGroup;
  #fpsMeter;
  #pipeline: GPURenderPipeline;
  #projectionDirty = true;
  #renderSize = { width: 0, height: 0 };
  #scale = 1;
  #animationSpeed = 1;
  #animationOffset = 0;
  #time = 0;
  #uniformData = new Float32Array(SCENE_UNIFORM_FLOATS);
  #uniformBuffer: GPUBuffer;

  constructor(
    private readonly root: TgpuRoot,
    private readonly canvas: HTMLCanvasElement,
    private readonly onFps: (fps: number) => void
  ) {
    const format = navigator.gpu.getPreferredCanvasFormat();
    const device = root.device;

    this.#fpsMeter = createFpsMeter((fps) => onFps(fps));
    this.#context = root.configureContext({
      canvas,
      format,
      alphaMode: 'premultiplied'
    });
    this.#uniformBuffer = device.createBuffer({
      label: 'TypeGPU scene uniforms',
      size: SCENE_UNIFORM_FLOATS * Float32Array.BYTES_PER_ELEMENT,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    const pipelineResources = createPipeline(device, format, this.#uniformBuffer);
    this.#bindGroup = pipelineResources.bindGroup;
    this.#pipeline = pipelineResources.pipeline;
    this.setScene({
      camera: DEFAULT_TYPEGPU_CAMERA,
      scale: 1,
      animationSpeed: 1,
      drawBatches: []
    });
  }

  setScene(scene: TypeGpuSceneState): void {
    if (this.#disposed) return;

    this.#camera = scene.camera;
    this.#projectionDirty = true;
    this.#scale = scene.scale;
    this.#setAnimationSpeed(scene.animationSpeed);
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
        this.root.device,
        `TypeGPU ${batch.geometry.key} vertices`,
        batch.geometry.vertexData,
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
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
    const device = this.root.device;
    const byteLength = Math.max(4, instanceData.byteLength);

    if (!buffers.instanceBuffer || buffers.instanceBufferByteLength !== byteLength) {
      buffers.instanceBuffer?.destroy();
      buffers.instanceBuffer = createAndUploadBuffer(
        device,
        `TypeGPU ${batch.key} instances`,
        instanceData,
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      );
      buffers.instanceBufferByteLength = byteLength;
    } else {
      for (const range of dirtyRanges) {
        writeFloat32BufferRange(
          device,
          buffers.instanceBuffer,
          instanceData,
          range.start * PRIMITIVE_INSTANCE_FLOATS,
          range.count * PRIMITIVE_INSTANCE_FLOATS
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
        const offset = index * PRIMITIVE_INSTANCE_FLOATS;

        const animationTime = this.#time * this.#animationSpeed + this.#animationOffset;

        batch.instances[offset + PRIMITIVE_SPIN_OFFSET_OFFSET] = this.#continuity.offsetFor({
          key: batch.instanceIds[index],
          rate: batch.instances[offset + PRIMITIVE_SPIN_SPEED_OFFSET],
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

      pass.setPipeline(this.#pipeline);
      pass.setBindGroup(0, this.#bindGroup);

      for (const batch of this.#drawBatches) {
        const buffers = this.#batchBuffers.get(batch.key);
        if (!buffers?.instanceBuffer || buffers.instanceCount === 0) continue;

        pass.setVertexBuffer(0, buffers.vertexBuffer);
        pass.setVertexBuffer(1, buffers.instanceBuffer);
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
    writeFloat32Buffer(this.root.device, this.#uniformBuffer, this.#uniformData);
  }
}

function createAndUploadBuffer(
  device: GPUDevice,
  label: string,
  data: Float32Array,
  usage: GPUBufferUsageFlags
): GPUBuffer {
  const buffer = device.createBuffer({
    label,
    size: Math.max(4, data.byteLength),
    usage
  });

  writeFloat32Buffer(device, buffer, data);

  return buffer;
}

function writeFloat32Buffer(device: GPUDevice, buffer: GPUBuffer, data: Float32Array): void {
  device.queue.writeBuffer(buffer, 0, data.buffer as ArrayBuffer, data.byteOffset, data.byteLength);
}

function writeFloat32BufferRange(
  device: GPUDevice,
  buffer: GPUBuffer,
  data: Float32Array,
  startFloat: number,
  floatCount: number
): void {
  if (floatCount === 0) return;

  const startByte = startFloat * Float32Array.BYTES_PER_ELEMENT;

  device.queue.writeBuffer(
    buffer,
    startByte,
    data.buffer as ArrayBuffer,
    data.byteOffset + startByte,
    floatCount * Float32Array.BYTES_PER_ELEMENT
  );
}

interface PipelineResources {
  bindGroup: GPUBindGroup;
  pipeline: GPURenderPipeline;
}

function createPipeline(
  device: GPUDevice,
  format: GPUTextureFormat,
  uniformBuffer: GPUBuffer
): PipelineResources {
  const shader = device.createShaderModule({
    label: 'TypeGPU box shader',
    code: `
      struct SceneUniforms {
        view_projection: mat4x4<f32>,
        time: f32,
        scale: f32,
        animation_speed: f32,
        animation_offset: f32,
      };

      @group(0) @binding(0) var<uniform> scene: SceneUniforms;

      struct VertexInput {
        @location(0) position: vec3<f32>,
        @location(1) normal: vec3<f32>,
        @location(2) instance_position: vec3<f32>,
        @location(3) phase: f32,
        @location(4) color: vec4<f32>,
        @location(5) shape: vec4<f32>,
        @location(6) spin_offset: f32,
      };

      struct VertexOutput {
        @builtin(position) position: vec4<f32>,
        @location(0) color: vec4<f32>,
        @location(1) normal: vec3<f32>,
      };

      fn rotate_x(position: vec3<f32>, angle: f32) -> vec3<f32> {
        let c = cos(angle);
        let s = sin(angle);
        return vec3(position.x, position.y * c - position.z * s, position.y * s + position.z * c);
      }

      fn rotate_y(position: vec3<f32>, angle: f32) -> vec3<f32> {
        let c = cos(angle);
        let s = sin(angle);
        return vec3(position.x * c + position.z * s, position.y, -position.x * s + position.z * c);
      }

      @vertex
      fn vertex_main(input: VertexInput) -> VertexOutput {
        let spin = (scene.time * scene.animation_speed + scene.animation_offset) * input.shape.w + input.spin_offset;
        let pulse = 0.9 + sin(spin + input.phase) * 0.05;
        let spin_y = spin + input.phase;
        let spin_x = spin * 0.65 + input.phase * 0.35;
        let local_position = input.position * input.shape.xyz * scene.scale * pulse;
        let rotated_position = rotate_x(rotate_y(local_position, spin_y), spin_x);
        let rotated_normal = normalize(rotate_x(rotate_y(input.normal, spin_y), spin_x));
        let world_position = rotated_position + input.instance_position;
        var output: VertexOutput;

        output.position = scene.view_projection * vec4(world_position, 1.0);
        output.color = input.color;
        output.normal = rotated_normal;

        return output;
      }

      @fragment
      fn fragment_main(input: VertexOutput) -> @location(0) vec4<f32> {
        let light = normalize(vec3(0.45, 0.78, 0.6));
        let diffuse = max(dot(normalize(input.normal), light), 0.0);
        let shade = 0.28 + diffuse * 0.72;

        return vec4(input.color.rgb * shade, input.color.a);
      }
    `
  });
  const bindGroupLayout = device.createBindGroupLayout({
    label: 'TypeGPU uniforms layout',
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
        buffer: { type: 'uniform' }
      }
    ]
  });
  const bindGroup = device.createBindGroup({
    label: 'TypeGPU uniforms',
    layout: bindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }]
  });

  const pipeline = device.createRenderPipeline({
    label: 'TypeGPU box pipeline',
    layout: device.createPipelineLayout({
      label: 'TypeGPU box pipeline layout',
      bindGroupLayouts: [bindGroupLayout]
    }),
    vertex: {
      module: shader,
      entryPoint: 'vertex_main',
      buffers: [
        {
          arrayStride: PRIMITIVE_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x3' }
          ]
        },
        {
          arrayStride: PRIMITIVE_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x3' },
            { shaderLocation: 3, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
            { shaderLocation: 4, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
            { shaderLocation: 5, offset: 8 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
            { shaderLocation: 6, offset: 12 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' }
          ]
        }
      ]
    },
    fragment: {
      module: shader,
      entryPoint: 'fragment_main',
      targets: [{ format }]
    },
    primitive: {
      topology: 'triangle-list',
      cullMode: 'back'
    },
    depthStencil: {
      format: DEPTH_FORMAT,
      depthWriteEnabled: true,
      depthCompare: 'less'
    }
  });

  return { bindGroup, pipeline };
}
