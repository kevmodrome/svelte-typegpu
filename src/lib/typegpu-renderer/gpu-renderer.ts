import tgpu, { type TgpuRoot } from 'typegpu';
import { createFpsMeter } from '../fps-meter';
import {
  BOX_INSTANCE_FLOATS,
  BOX_SPIN_OFFSET_OFFSET,
  BOX_SPIN_SPEED_OFFSET,
  BOX_VERTEX_COUNT,
  BOX_VERTEX_FLOATS,
  createBoxVertexData
} from './box-data';
import { createViewProjectionMatrix } from './camera-math';
import { createContinuityTracker } from './continuity';
import type {
  TypeGpuCameraSettings,
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
  #frame = 0;
  #instanceBuffer: GPUBuffer | null = null;
  #instanceBufferByteLength = 0;
  #instanceCount = 0;
  #lastTimestamp = 0;
  #bindGroup: GPUBindGroup;
  #fpsMeter;
  #pipeline: GPURenderPipeline;
  #projectionDirty = true;
  #renderSize = { width: 0, height: 0 };
  #time = 0;
  #uniformData = new Float32Array(SCENE_UNIFORM_FLOATS);
  #uniformBuffer: GPUBuffer;
  #vertexBuffer: GPUBuffer;

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
    this.#vertexBuffer = createAndUploadBuffer(
      device,
      'TypeGPU box vertices',
      createBoxVertexData(),
      GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
    );
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
      instances: new Float32Array(0),
      instanceIds: [],
      instanceCount: 0,
      instancesChanged: true,
      instanceDirtyRanges: []
    });
  }

  setScene(scene: TypeGpuSceneState): void {
    if (this.#disposed) return;

    this.#camera = scene.camera;
    this.#projectionDirty = true;

    if (scene.instancesChanged || !this.#instanceBuffer) {
      const dirtyRanges = scene.instanceDirtyRanges.length
        ? scene.instanceDirtyRanges
        : scene.instanceCount > 0
          ? [{ start: 0, count: scene.instanceCount }]
          : [];

      this.#uploadInstances(this.#applyContinuity(scene, dirtyRanges), scene.instanceCount, dirtyRanges);
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
    this.#instanceBuffer?.destroy();
    this.#uniformBuffer.destroy();
    this.#vertexBuffer.destroy();
    this.root.destroy();
  }

  #uploadInstances(
    instanceData: Float32Array,
    instanceCount: number,
    dirtyRanges: TypeGpuInstanceDirtyRange[]
  ): void {
    const device = this.root.device;
    const byteLength = Math.max(4, instanceData.byteLength);

    if (!this.#instanceBuffer || this.#instanceBufferByteLength !== byteLength) {
      this.#instanceBuffer?.destroy();
      this.#instanceBuffer = createAndUploadBuffer(
        device,
        'TypeGPU box instances',
        instanceData,
        GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST
      );
      this.#instanceBufferByteLength = byteLength;
    } else {
      for (const range of dirtyRanges) {
        writeFloat32BufferRange(
          device,
          this.#instanceBuffer,
          instanceData,
          range.start * BOX_INSTANCE_FLOATS,
          range.count * BOX_INSTANCE_FLOATS
        );
      }
    }

    this.#instanceCount = instanceCount;
  }

  #applyContinuity(
    scene: TypeGpuSceneState,
    dirtyRanges: TypeGpuInstanceDirtyRange[]
  ): Float32Array {
    this.#continuity.prune(scene.instanceIds);

    for (const range of dirtyRanges) {
      const end = Math.min(scene.instanceIds.length, range.start + range.count);

      for (let index = range.start; index < end; index += 1) {
        const offset = index * BOX_INSTANCE_FLOATS;

        scene.instances[offset + BOX_SPIN_OFFSET_OFFSET] = this.#continuity.offsetFor({
          key: scene.instanceIds[index],
          rate: scene.instances[offset + BOX_SPIN_SPEED_OFFSET],
          time: this.#time
        });
      }
    }

    return scene.instances;
  }

  #render(timestamp: number): void {
    if (this.#disposed) return;

    const device = this.root.device;
    const delta = this.#lastTimestamp ? Math.min(48, timestamp - this.#lastTimestamp) : 0;
    this.#lastTimestamp = timestamp;

    this.#time += (delta / 16.67) * 0.018;

    this.#resize();
    this.#writeUniforms();

    if (this.#instanceBuffer && this.#depthTexture) {
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
      pass.setVertexBuffer(0, this.#vertexBuffer);
      pass.setVertexBuffer(1, this.#instanceBuffer);
      pass.draw(BOX_VERTEX_COUNT, this.#instanceCount);
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
    this.#uniformData[17] = 0;
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
        _padding: vec3<f32>,
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
        let spin = scene.time * input.shape.w + input.spin_offset;
        let pulse = 0.9 + sin(spin + input.phase) * 0.05;
        let spin_y = spin + input.phase;
        let spin_x = spin * 0.65 + input.phase * 0.35;
        let local_position = input.position * input.shape.xyz * pulse;
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
          arrayStride: BOX_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          attributes: [
            { shaderLocation: 0, offset: 0, format: 'float32x3' },
            { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x3' }
          ]
        },
        {
          arrayStride: BOX_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
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
