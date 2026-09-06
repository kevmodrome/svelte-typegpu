import { vi } from 'vitest';

export interface GpuDrawCapture {
  bindings: unknown[][];
  counts: number[];
}

export function createFakePipeline(captured: GpuDrawCapture, bindings: unknown[] = []) {
  return {
    with: (...values: unknown[]) => createFakePipeline(captured, [...bindings, ...values]),
    withIndexBuffer: (...values: unknown[]) => createFakePipeline(captured, [...bindings, ...values]),
    draw: (_vertices: number, count = 1) => { captured.bindings.push(bindings); captured.counts.push(count); },
    drawIndexed: (_indices: number, count = 1) => { captured.bindings.push(bindings); captured.counts.push(count); }
  };
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
