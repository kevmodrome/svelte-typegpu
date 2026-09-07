import { afterEach, describe, expect, it, vi } from 'vitest';
import { GpuTiming } from './gpu-timing';

afterEach(() => vi.unstubAllGlobals());
function fixture(supported = true) {
  vi.stubGlobal('GPUBufferUsage', { MAP_READ: 1, COPY_DST: 8, COPY_SRC: 4, QUERY_RESOLVE: 512 });
  vi.stubGlobal('GPUMapMode', { READ: 1 });
  const requests: { resolve(): void; reject(error: Error): void; buffer: Buffer }[] = [];
  type Buffer = { data: BigUint64Array; destroy: ReturnType<typeof vi.fn>; unmap: ReturnType<typeof vi.fn>;
    getMappedRange(): ArrayBuffer; mapAsync(): Promise<void> };
  const buffers: Buffer[] = [];
  const encoder = { resolveQuerySet: vi.fn(), copyBufferToBuffer: vi.fn(), finish: () => ({}) };
  const device = {
    features: new Set(supported ? ['timestamp-query'] : []),
    createQuerySet: vi.fn(() => ({ destroy: vi.fn() })),
    createBuffer: vi.fn(() => {
      const buffer: Buffer = { data: new BigUint64Array(512), destroy: vi.fn(), unmap: vi.fn(),
        getMappedRange: () => buffer.data.buffer as ArrayBuffer,
        mapAsync: () => new Promise<void>((resolve, reject) => requests.push({ resolve, reject, buffer })) };
      buffers.push(buffer); return buffer;
    }),
    createCommandEncoder: () => encoder, queue: { submit: vi.fn() }
  };
  const timing = new GpuTiming(device as unknown as GPUDevice, 0);
  const finish = async (index: number, duration = 1_000_000n) => {
    const request = requests[index];
    for (let i = 0; i < 256; i++) request.buffer.data.set([10n, 10n + duration], i * 2);
    request.resolve(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  };
  return { timing, device, requests, buffers, encoder, finish };
}

describe('bounded asynchronous GPU timing', () => {
  it('reports unsupported without creating resources or commands', () => {
    const { timing, device } = fixture(false);
    timing.beginFrame(0, 'none'); expect(timing.writes('color')).toBeUndefined(); timing.endFrame('disabled');
    expect(timing.state).toBe('unsupported'); expect(timing.sample).toBeUndefined();
    expect(device.createBuffer).not.toHaveBeenCalled(); expect(device.queue.submit).not.toHaveBeenCalled();
    timing.dispose();
  });

  it('sums all pass categories and keeps the measured frame configuration', async () => {
    const { timing, finish, encoder } = fixture();
    timing.beginFrame(5, 'hi-z');
    for (const pass of ['shadow','depth','pyramid','pyramid','selection','color'] as const) timing.writes(pass);
    timing.endFrame('active');
    expect(timing.state).toBe('pending');
    expect(encoder.resolveQuerySet.mock.calls[0].slice(1,3)).toEqual([0,12]);
    await finish(0);
    expect(timing.sample).toEqual({ frame: 1, timestamp: 5, occlusion: 'active', totalMs: 6,
      shadowMs: 1, depthMs: 1, pyramidMs: 2, selectionMs: 1, colorMs: 1 });
    timing.sample!.totalMs = 999; expect(timing.sample!.totalMs).toBe(6);
    timing.dispose();
  });

  it('skips saturated slots and ignores out-of-order results without allocating', async () => {
    const { timing, device, requests, finish } = fixture();
    for (let frame = 0; frame < 10; frame++) {
      timing.beginFrame(frame, 'none'); timing.writes('color'); timing.endFrame('disabled');
    }
    expect(requests).toHaveLength(3); expect(device.createBuffer).toHaveBeenCalledTimes(6);
    await finish(2, 3_000_000n); await finish(0); await finish(1);
    expect(timing.sample).toMatchObject({ frame: 3, totalMs: 3 });
    timing.beginFrame(11, 'none'); timing.writes('color'); timing.endFrame('disabled'); await finish(3);
    expect(device.createBuffer).toHaveBeenCalledTimes(6);
    timing.dispose();
  });

  it('drops overflowing or cancelled samples rather than reporting partial totals', () => {
    const { timing, requests } = fixture(); timing.beginFrame(0, 'none');
    for (let i = 0; i < 257; i++) timing.writes('color');
    timing.endFrame('disabled'); expect(requests).toHaveLength(0);
    timing.beginFrame(1, 'none'); timing.writes('color'); timing.cancelFrame(); timing.endFrame('disabled');
    expect(requests).toHaveLength(0); timing.dispose();
  });

  it.each(['resolve','reject'] as const)('disposes every resource and ignores a late %s', async outcome => {
    const { timing, requests, buffers, device } = fixture();
    timing.beginFrame(0, 'none'); timing.writes('color'); timing.endFrame('disabled'); timing.dispose(); timing.dispose();
    if (outcome === 'resolve') requests[0].resolve(); else requests[0].reject(new Error('device lost'));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(timing.state).toBe('disabled'); expect(timing.sample).toBeUndefined();
    expect(buffers.every(b => b.destroy.mock.calls.length === 1 && !b.unmap.mock.calls.length)).toBe(true);
    expect(device.createQuerySet.mock.results.every(r => r.value.destroy.mock.calls.length === 1)).toBe(true);
  });

  it('stops failed readback until instrumentation is recreated', async () => {
    const { timing, requests } = fixture();
    timing.beginFrame(0, 'none'); timing.writes('color'); timing.endFrame('disabled');
    requests[0].reject(new Error('device lost')); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(timing.state).toBe('error'); timing.beginFrame(2, 'none'); expect(timing.writes('color')).toBeUndefined();
    timing.dispose();
  });
});
