import { vi } from 'vitest';

export interface GpuDrawCapture {
  bindings: unknown[][];
  counts: number[];
  draws?: { indexed: boolean; count: number; firstInstance: number }[];
  indirect?: { indexed: boolean; buffer: unknown; offset: number }[];
}

export function createFakePipeline(captured: GpuDrawCapture, bindings: unknown[] = []) {
  return {
    with: (...values: unknown[]) => createFakePipeline(captured, [...bindings, ...values]),
    withIndexBuffer: (...values: unknown[]) => createFakePipeline(captured, [...bindings, ...values]),
    draw: (_vertices: number, count = 1, _firstVertex = 0, firstInstance = 0) => {
      captured.bindings.push(bindings); captured.counts.push(count);
      captured.draws?.push({ indexed: false, count, firstInstance });
    },
    drawIndexed: (_indices: number, count = 1, _firstIndex = 0, _baseVertex = 0, firstInstance = 0) => {
      captured.bindings.push(bindings); captured.counts.push(count);
      captured.draws?.push({ indexed: true, count, firstInstance });
    },
    drawIndirect: (buffer: unknown, offset = 0) => {
      captured.bindings.push(bindings); captured.indirect?.push({ indexed: false, buffer, offset });
    },
    drawIndexedIndirect: (buffer: unknown, offset = 0) => {
      captured.bindings.push(bindings); captured.indirect?.push({ indexed: true, buffer, offset });
    }
  };
}

/** Command/resource assertions only; real visibility is tested on WebGPU. */
export function enableFakeOcclusion(root: ReturnType<typeof createFakeGpuRoot>['root']) {
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_SRC: 4, COPY_DST: 8, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256 });
  vi.stubGlobal('GPUTextureUsage', { TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 });
  const buffers: { label: string; size: number; data: ArrayBuffer; destroy: ReturnType<typeof vi.fn> }[] = [];
  const textures: { destroy: ReturnType<typeof vi.fn> }[] = [];
  const dispatches = vi.fn();
  const device = Object.assign(root.device, {
    features: new Set(['indirect-first-instance']),
    limits: { maxTextureDimension2D: 8192, maxStorageBuffersPerShaderStage: 8,
      maxComputeWorkgroupSizeX: 256, maxComputeInvocationsPerWorkgroup: 256,
      maxStorageBufferBindingSize: 128 * 1024 * 1024, maxBufferSize: 256 * 1024 * 1024,
      maxComputeWorkgroupsPerDimension: 65535 },
    createBuffer: vi.fn(({ label, size }: { label: string; size: number }) => {
      const buffer = { label, size, data: new ArrayBuffer(size), destroy: vi.fn() }; buffers.push(buffer); return buffer;
    }),
    createTexture: vi.fn(() => { const texture = { destroy: vi.fn(), createView: () => ({}) }; textures.push(texture); return texture; })
  });
  const encode = root.device.createCommandEncoder;
  device.createCommandEncoder = () => Object.assign(encode(), { beginComputePass: () => ({ end() {} }) });
  const writeBuffer = vi.fn((buffer: typeof buffers[number], offset: number, source: ArrayBuffer | ArrayBufferView, sourceOffset = 0, size?: number) => {
    const bytes = ArrayBuffer.isView(source) ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength) : new Uint8Array(source);
    new Uint8Array(buffer.data).set(bytes.subarray(sourceOffset, size === undefined ? undefined : sourceOffset + size), offset);
  });
  Object.assign(device.queue, { writeBuffer });
  const createComputePipeline = vi.fn(() => ({ with() { return this; }, dispatchWorkgroups: dispatches }));
  Object.assign(root, { createComputePipeline });
  return { device, buffers, textures, writeBuffer, createComputePipeline, dispatches };
}

export function enableFakeGpuTiming(fake: ReturnType<typeof enableFakeOcclusion>) {
  Object.assign(GPUBufferUsage, { QUERY_RESOLVE: 512 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  fake.device.features.add('timestamp-query');
  const createBuffer = fake.device.createBuffer.getMockImplementation()!;
  fake.device.createBuffer.mockImplementation(descriptor => {
    const buffer = createBuffer(descriptor);
    return Object.assign(buffer, { mapAsync: vi.fn(async () => {}), getMappedRange: () => buffer.data, unmap: vi.fn() });
  });
  Object.assign(fake.device, { createQuerySet: vi.fn(() => ({ destroy: vi.fn() })) });
  const encode = fake.device.createCommandEncoder, resolveQuerySet = vi.fn();
  fake.device.createCommandEncoder = () => Object.assign(encode(), { resolveQuerySet, copyBufferToBuffer: vi.fn() });
  return { resolveQuerySet };
}

function fakeBuffer() {
  return {
    label: '',
    buffer: {},
    data: new Float32Array(),
    $usage() { return this; },
    $name(label: string) { this.label = label; return this; },
    write: vi.fn(function (
      this: { data: Float32Array },
      data: ArrayBuffer,
      options?: { startOffset: number; endOffset: number }
    ) {
      if (options) {
        if (this.data.byteLength < options.endOffset) {
          const expanded = new Float32Array(options.endOffset / 4);
          expanded.set(this.data);
          this.data = expanded;
        }
        this.data.set(new Float32Array(data), options.startOffset / 4);
      } else this.data = new Float32Array(data.slice(0));
    }),
    destroy: vi.fn()
  };
}

export function createFakeGpuRoot(captured: GpuDrawCapture) {
  const buffers: ReturnType<typeof fakeBuffer>[] = [];
  const submissions: Float32Array[][] = [];
  const root = {
    createBuffer: vi.fn(() => {
      const buffer = fakeBuffer();
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => ({
      $usage() { return this; },
      $name() { return this; },
      write: vi.fn(),
      destroy: vi.fn(),
      createView: () => ({})
    })),
    createBindGroup: vi.fn((_layout: unknown, entries: unknown) => ({ entries })),
    createSampler: vi.fn(() => ({})),
    createComparisonSampler: vi.fn(() => ({})),
    configureContext: vi.fn(() => ({ getCurrentTexture: () => ({ createView: () => ({}) }) })),
    unwrap: (resource: unknown) => resource,
    pipe() { return this; },
    destroy: vi.fn(),
    device: {
      createCommandEncoder: () => ({ beginRenderPass: () => ({ end() {} }), finish: () => ({}) }),
      queue: {
        submit: () => {
          // Uniform writes take effect before submission, not separately for each draw call.
          submissions.push(captured.bindings.splice(0).map((bindings) => {
            const group = bindings.find((value: any) => value?.entries?.uniforms) as {
              entries: { uniforms: ReturnType<typeof fakeBuffer> };
            };
            return group?.entries.uniforms.data.slice() ?? new Float32Array();
          }));
        }
      }
    }
  };
  return { root, buffers, submissions };
}
