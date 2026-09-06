// @vitest-environment happy-dom
import tgpu from 'typegpu';
import { flushSync, mount, onDestroy, unmount } from 'svelte';
import { Spring, Tween } from 'svelte/motion';
import * as client from 'svelte/internal/client';
import { afterEach, expect, it, vi, type MockInstance } from 'vitest';
import { settleComponentUpdates } from '../../src/component-test-utils';
import { compileViewportSource } from '../../src/viewport-test-utils';
import { createFragment } from '../../src/core';
import { createFakeGpuRoot } from '../../src/gpu-test-utils';
import { createTypeGpuRenderer, type TypeGpuRenderer } from '../../src/gpu-renderer';
import renderer, { createTypeGpuRuntimeForTest, type TypeGpuRoot } from '../../src/svelte-renderer';
import { createMeshPipeline } from '../../src/typegpu-pipeline';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[] }));
vi.mock('typegpu', async importOriginal => {
  const actual = await importOriginal<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});
vi.mock('@typegpu/noise', () => ({
  perlin3d: { staticCache: () => ({ inject: () => (root: unknown) => root, destroy() {} }) }
}));
vi.mock('../../src/typegpu-pipeline', async () => {
  const { createFakePipeline } = await import('../../src/gpu-test-utils');
  return {
    createMeshPipeline: vi.fn(() => createFakePipeline(captured)),
    createShadowPipeline: vi.fn(() => createFakePipeline(captured)),
    createShaderPassPipeline: vi.fn(() => createFakePipeline(captured))
  };
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  captured.bindings.length = 0; captured.counts.length = 0;
  document.body.replaceChildren();
});

type Controls = { start(value: number): void; read(): number; fail(): void; recover(): void };
const cases = ['scene', 'viewport'].flatMap(host => [60, 120, 144].flatMap(hz => ['Tween', 'Spring'].flatMap(kind => [
  { frameloop: 'demand' as const, rendererFirst: false },
  { frameloop: 'demand' as const, rendererFirst: true },
  { frameloop: 'manual' as const, rendererFirst: false }
].map(clock => ({ host, hz, kind, ...clock })))));

it.each(cases)('keeps $host $kind frames through inline boundary failure/reset at $hz Hz ($frameloop, renderer first $rendererFirst)',
  async ({ host, hz, kind, frameloop, rendererFirst }) => {
    const pending = new Map<number, FrameRequestCallback>();
    const producers = new WeakSet<FrameRequestCallback>();
    let now = 0, id = 0;
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
    const raf = (client as unknown as { raf: { now(): number; tick(callback: FrameRequestCallback): void } }).raf;
    vi.spyOn(raf, 'now').mockImplementation(() => now);
    vi.spyOn(raf, 'tick').mockImplementation(callback => { producers.add(callback); requestAnimationFrame(callback); });
    const Scene = compileViewportSource<Controls>(`<script>
      import { onDestroy } from 'svelte';
      import { Tween, Spring } from 'svelte/motion';
      let { kind, setup, frameloop, onready } = $props();
      const motion = kind === 'Tween' ? new Tween(0, { duration: 1800 }) :
        new Spring(0, { stiffness: 0.05, damping: 0.7, precision: 1e-5 });
      let broken = $state(false), reset;
      function readName() { if (broken) throw new Error('failed'); return 'ready'; }
      export function start(value) { void motion.set(value); }
      export function read() { return motion.current; }
      export function fail() { broken = true; }
      export function recover() { broken = false; reset(); }
      onDestroy(() => {
        if (motion instanceof Tween) void motion.set(motion.current, { duration: 0 });
        else void motion.set(motion.current, { instant: true });
      });
    </script>
    ${host === 'viewport' ? '<canvas {frameloop} {onready}>' : ''}
    <scene>
      {#each Array.from({ length: 100 }, (_, i) => i) as i (i)}
        <mesh position={[i + 10, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
      {/each}
      <mesh position={[motion.current, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
      <svelte:boundary onerror={(error, retry) => reset = retry}>
        {@const label = 'fallback'}
        <mesh name={readName()} position={[0, 1, 0]} {@attach setup('ready')}>
          <boxGeometry /><standardMaterial />
        </mesh>
        {#snippet failed(error)}
          {@render fallback(label + ':' + error.message)}
        {/snippet}
        {#snippet fallback(name)}
          <mesh {name} position={[0, 2, 0]} {@attach setup('failed')}><boxGeometry /><standardMaterial /></mesh>
        {/snippet}
      </svelte:boundary>
    </scene>
    ${host === 'viewport' ? '</canvas>' : ''}`, { Tween, Spring, onDestroy });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
    vi.mocked(tgpu.init).mockClear().mockResolvedValue(gpu as never);
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const log: string[] = [];
    const setup = (phase: string) => () => { log.push(`attach:${phase}`); return () => { log.push(`detach:${phase}`); }; };
    let draw!: TypeGpuRenderer;
    let setScene!: MockInstance<TypeGpuRenderer['setScene']>;
    let disposeRenderer = () => {};
    let instance: Controls;
    if (host === 'viewport') {
      instance = mount(Scene, { target: document.body, props: {
        kind, setup, frameloop,
        onready(root: TypeGpuRoot) { draw = root.gpu; setScene = vi.spyOn(draw, 'setScene'); }
      } });
      await settleComponentUpdates(); await settleComponentUpdates();
    } else {
      const canvas = Object.assign(new EventTarget(), { clientWidth: 100, clientHeight: 100, width: 100, height: 100 }) as HTMLCanvasElement;
      draw = await createTypeGpuRenderer({ canvas, frameloop });
      setScene = vi.spyOn(draw, 'setScene');
      const root = createFragment();
      const runtime = createTypeGpuRuntimeForTest(root, canvas, draw);
      root.runtime = runtime;
      disposeRenderer = () => runtime.dispose();
      instance = mount(Scene, { renderer, target: root, props: { kind, setup } });
    }
    const canvas = document.querySelector('canvas');
    const order: string[] = [];
    async function step() {
      now += 1000 / hz;
      order.length = 0;
      for (const [key, callback] of [...pending]) {
        if (!pending.delete(key)) continue;
        order.push(producers.has(callback) ? 'motion' : 'render');
        callback(now); flushSync(); await Promise.resolve();
      }
    }
    let disposed = false;
    try {
      await settleComponentUpdates();
      for (let i = 0; i < 3; i++) await step();
      if (frameloop === 'manual') draw.renderFrame(now);
      expect(pending.size).toBe(0);
      expect(log).toEqual(['attach:ready']);
      const instances = buffers.find(buffer => buffer.label.endsWith('instances'))!;
      const storage = setScene.mock.lastCall![0].drawBatches[0].instances.buffer;
      const retained = [...buffers];
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear();
      vi.mocked(createMeshPipeline).mockClear(); request.mockClear();
      if (frameloop === 'demand' && rendererFirst) { draw.invalidate(); draw.invalidate(); }
      instance.start(10);
      if (frameloop === 'demand' && !rendererFirst) { draw.invalidate(); draw.invalidate(); }
      const failAt = Math.floor(hz / 3), resetAt = Math.floor(2 * hz / 3);
      for (let frame = 0; frame < hz; frame++) {
        instances.write.mockClear();
        if (frame === failAt) { flushSync(() => instance.fail()); await settleComponentUpdates(); }
        if (frame === resetAt) { flushSync(() => instance.recover()); await settleComponentUpdates(); }
        const before = submissions.length, previous = instance.read();
        await step();
        if (frameloop === 'manual') draw.renderFrame(now);
        expect(submissions.length - before).toBe(1);
        expect(order).toEqual(frameloop === 'manual' ? ['motion'] : rendererFirst ? ['render', 'motion'] : ['motion', 'render']);
        expect(instances.data[100 * 24]).toBeCloseTo(instance.read());
        expect(setScene.mock.lastCall![0].drawBatches[0].instances.buffer).toBe(storage);
        expect(captured.counts.at(-1)).toBe(102);
        if (frame !== failAt && frame !== resetAt && previous !== instance.read()) {
          expect(instances.write).toHaveBeenCalledOnce();
          expect(instances.write.mock.lastCall![1]).toEqual({ startOffset: 100 * 96, endOffset: 101 * 96 });
        } else if (frame === failAt || frame === resetAt) {
          // Structural reconciliation retains the previous moving dirty slot;
          // the subsequent producer callback updates that slot once more.
          expect(instances.write.mock.calls.map(([, range]) => range)).toEqual([
            { startOffset: 100 * 96, endOffset: 102 * 96 },
            { startOffset: 100 * 96, endOffset: 101 * 96 }
          ]);
        }
        if (host === 'viewport') expect(document.querySelector('canvas')).toBe(canvas);
      }
      expect(log).toEqual(['attach:ready', 'detach:ready', 'attach:failed', 'detach:failed', 'attach:ready']);
      for (let frame = 0; frame < hz * 20 && pending.size; frame++) {
        const before = submissions.length, previous = instance.read();
        await step();
        if (frameloop === 'manual') draw.renderFrame(now);
        expect(submissions.length - before).toBeLessThanOrEqual(1);
        if (previous !== instance.read()) expect(submissions.length - before).toBe(1);
        expect(instances.data[100 * 24]).toBeCloseTo(instance.read());
        if (frameloop === 'manual') expect(order.every(type => type === 'motion')).toBe(true);
      }
      expect(instance.read()).toBe(10);
      expect(pending.size).toBe(0);
      expect(gpu.createBuffer).not.toHaveBeenCalled();
      expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      expect(buffers).toEqual(retained);
      const idle = submissions.length;
      for (let i = 0; i < 5; i++) await step();
      expect(submissions.length).toBe(idle);
      instance.start(20); await settleComponentUpdates();
      expect(pending.size).toBeGreaterThan(0);
      await unmount(instance); disposeRenderer(); disposed = true;
      const final = submissions.length;
      for (let i = 0; i < 4; i++) await step();
      expect(submissions.length).toBe(final);
      expect(pending.size).toBe(0);
      expect(log.at(-1)).toBe('detach:ready');
      if (host === 'viewport') expect(document.querySelector('canvas')).toBeNull();
    } finally {
      if (!disposed) { await unmount(instance); disposeRenderer(); }
    }
  });
