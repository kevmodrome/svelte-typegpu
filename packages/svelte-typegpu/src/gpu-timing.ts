import type { OcclusionState } from './occlusion';

export type GpuTimingPass = 'shadow' | 'depth' | 'pyramid' | 'selection' | 'color';
export type GpuTimingState = 'disabled' | 'unsupported' | 'pending' | 'ready' | 'error';
export interface TypeGpuTimingSample {
  frame: number;
  timestamp: number;
  occlusion: OcclusionState;
  /** Sum of measured pass durations, excluding queue wait and presentation. */
  totalMs: number;
  shadowMs: number;
  depthMs: number;
  pyramidMs: number;
  selectionMs: number;
  colorMs: number;
}

const MAX_PASSES = 256;
const SLOT_COUNT = 3;
const categories = ['shadowMs', 'depthMs', 'pyramidMs', 'selectionMs', 'colorMs'] as const;
const passIndex: Record<GpuTimingPass, number> = { shadow: 0, depth: 1, pyramid: 2, selection: 3, color: 4 };
interface Slot {
  query: GPUQuerySet;
  resolve: GPUBuffer;
  read: GPUBuffer;
  categories: Uint8Array;
  count: number;
  busy: boolean;
  overflow: boolean;
  frame: number;
  timestamp: number;
}

/** Optional diagnostics. Never waits for a slot, invalidates, or owns a clock. */
export class GpuTiming {
  readonly #slots: Slot[] = [];
  #active: Slot | undefined;
  #disposed = false;
  #failed = false;
  #frame = 0;
  #nextSample = -Infinity;
  #configuration = '';
  #latest: TypeGpuTimingSample | undefined;
  readonly supported: boolean;

  constructor(readonly device: GPUDevice, readonly intervalMs = 250) {
    this.supported = device.features?.has('timestamp-query') === true;
    if (!this.supported) return;
    for (let i = 0; i < SLOT_COUNT; i++) {
      this.#slots.push({
        query: device.createQuerySet({ label: `Frame timing ${i}`, type: 'timestamp', count: MAX_PASSES * 2 }),
        resolve: device.createBuffer({ label: `Frame timing resolve ${i}`, size: MAX_PASSES * 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC }),
        read: device.createBuffer({ label: `Frame timing read ${i}`, size: MAX_PASSES * 16,
          usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST }),
        categories: new Uint8Array(MAX_PASSES), count: 0, busy: false, overflow: false, frame: 0, timestamp: 0
      });
    }
  }

  get state(): GpuTimingState {
    return this.#disposed ? 'disabled' : !this.supported ? 'unsupported' : this.#failed ? 'error' : this.#latest ? 'ready' : 'pending';
  }

  get sample(): TypeGpuTimingSample | undefined { return this.#latest ? { ...this.#latest } : undefined; }

  beginFrame(timestamp: number, configuration: string): void {
    this.cancelFrame();
    this.#frame++;
    if (this.#disposed || this.#failed || !this.supported ||
      (timestamp < this.#nextSample && configuration === this.#configuration)) return;
    const slot = this.#slots.find(slot => !slot.busy);
    if (!slot) return;
    this.#configuration = configuration; this.#nextSample = timestamp + this.intervalMs;
    slot.busy = true; slot.count = 0; slot.overflow = false;
    slot.frame = this.#frame; slot.timestamp = timestamp; this.#active = slot;
  }

  writes(pass: GpuTimingPass): GPURenderPassTimestampWrites | undefined {
    const slot = this.#active;
    if (!slot) return;
    if (slot.count === MAX_PASSES) { slot.overflow = true; return; }
    const index = slot.count++;
    slot.categories[index] = passIndex[pass];
    return { querySet: slot.query, beginningOfPassWriteIndex: index * 2, endOfPassWriteIndex: index * 2 + 1 };
  }

  endFrame(occlusion: OcclusionState): void {
    const slot = this.#active;
    if (!slot) return;
    this.#active = undefined;
    if (!slot.count || slot.overflow) { slot.busy = false; return; }
    const encoder = this.device.createCommandEncoder({ label: 'Frame timing resolve' });
    encoder.resolveQuerySet(slot.query, 0, slot.count * 2, slot.resolve, 0);
    encoder.copyBufferToBuffer(slot.resolve, 0, slot.read, 0, slot.count * 16);
    this.device.queue.submit([encoder.finish()]);
    // Bounded readback is diagnostic only. Out-of-order completion must not
    // replace a newer frame, and teardown must not touch destroyed mappings.
    void slot.read.mapAsync(GPUMapMode.READ).then(() => {
      if (this.#disposed) return;
      if (this.#failed) { slot.read.unmap(); return; }
      const values = new BigUint64Array(slot.read.getMappedRange());
      const sample: TypeGpuTimingSample = { frame: slot.frame, timestamp: slot.timestamp, occlusion,
        totalMs: 0, shadowMs: 0, depthMs: 0, pyramidMs: 0, selectionMs: 0, colorMs: 0 };
      let valid = true;
      for (let i = 0; i < slot.count; i++) {
        const start = values[i * 2], end = values[i * 2 + 1];
        if (end < start) { valid = false; break; }
        const ms = Number(end - start) / 1e6;
        sample[categories[slot.categories[i]]] += ms; sample.totalMs += ms;
      }
      slot.read.unmap();
      if (valid && (!this.#latest || sample.frame > this.#latest.frame)) this.#latest = sample;
    }).catch(() => {
      if (!this.#disposed) { this.#failed = true; this.#latest = undefined; }
    }).finally(() => { slot.busy = false; });
  }

  cancelFrame(): void {
    if (this.#active) { this.#active.busy = false; this.#active = undefined; }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true; this.#latest = undefined; this.cancelFrame();
    for (const slot of this.#slots) { slot.query.destroy(); slot.resolve.destroy(); slot.read.destroy(); }
  }
}
