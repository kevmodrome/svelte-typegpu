// @vitest-environment happy-dom
import tgpu from 'typegpu';
import { compile } from 'svelte/compiler';
import { flushSync, mount, unmount, type Component } from 'svelte';
import { Spring, Tween } from 'svelte/motion';
import * as client from 'svelte/internal/client';
import { afterEach, expect, it, vi, type MockInstance } from 'vitest';
import { compileAsyncTypeGpuSource, settleComponentUpdates } from '../../src/component-test-utils';
import { compileAsyncViewportSource } from '../../src/viewport-test-utils';
import { createFragment } from '../../src/core';
import { createFakeGpuRoot } from '../../src/gpu-test-utils';
import { createTypeGpuRenderer, type TypeGpuRenderer } from '../../src/gpu-renderer';
import renderer, { createTypeGpuRuntimeForTest, type TypeGpuRoot } from '../../src/svelte-renderer';
import { createMeshPipeline } from '../../src/typegpu-pipeline';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[] }));
vi.mock('typegpu', async (importOriginal) => {
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  captured.bindings.length = 0;
  captured.counts.length = 0;
  document.body.replaceChildren();
});

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

type Controls = { hide(): void; show(value: Promise<string>): void; rename?(value: Promise<string>): void };
function viewportParent(): Component<any, Controls> {
  const compiled = compile(`<script>
    let { Viewport, motion, initial, setup, frameloop, onready } = $props();
    let viewport;
    let label = $state.raw(Promise.resolve('initial'));
    export function hide() { viewport.hide(); }
    export function show(value) { viewport.show(value); }
    export function rename(value) { label = value; }
  </script>
  {#snippet pending()}<p>Loading canvas</p>{/snippet}
  <svelte:boundary {pending}>
    <Viewport {motion} {initial} {setup} {frameloop} {onready} {label} bind:this={viewport} />
  </svelte:boundary>`, {
    filename: 'AsyncMotionParent.svelte', runes: true, experimental: { async: true }
  });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  return new Function('$', `${code}\nreturn ${name};`)(client);
}

it.each(['scene', 'viewport'].flatMap(host => [60, 120, 144].flatMap(hz => ['Tween', 'Spring'].flatMap(kind => [
  { frameloop: 'demand' as const, rendererFirst: false },
  { frameloop: 'demand' as const, rendererFirst: true },
  { frameloop: 'manual' as const, rendererFirst: false }
].flatMap(clock => ['resolve', 'reject'].map(outcome => ({ host, hz, kind, ...clock, outcome })))))))(
  'keeps pending ancestors out of $host $kind frames at $hz Hz ($frameloop, renderer first: $rendererFirst, late: $outcome)',
  async ({ host, hz, kind, frameloop, rendererFirst, outcome }) => {
    const pending = new Map<number, FrameRequestCallback>();
    const producers = new WeakSet<FrameRequestCallback>();
    let now = 0, id = 0;
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
    const raf = (client as unknown as {
      raf: { now(): number; tick(callback: FrameRequestCallback): void }
    }).raf;
    vi.spyOn(raf, 'now').mockImplementation(() => now);
    vi.spyOn(raf, 'tick').mockImplementation(callback => { producers.add(callback); requestAnimationFrame(callback); });
    const motion = kind === 'Tween' ? new Tween(0, { duration: 2000 }) :
      new Spring(0, { stiffness: 0.01, damping: 0.5, precision: 1e-8 });
    const stop = () => motion instanceof Tween ? motion.set(motion.current, { duration: 0 }) :
      motion.set(motion.current, { instant: true });
    const source = `<script>
      let { motion, initial, setup, label, frameloop, onready } = $props();
      let request = $state.raw(initial);
      let visible = $state(true);
      export function hide() { visible = false; }
      export function show(value) { request = value; visible = true; }
    </script>
    {#snippet pending()}<group name="pending" />{/snippet}
    {#snippet failed(error)}<group name={error.message} />{/snippet}
    ${host === 'viewport' ? '<canvas aria-label={await label} {frameloop} {onready}>' : ''}
    <scene>
      {#each Array.from({ length: 64 }, (_, i) => i) as i (i)}
        <mesh position={[i + 10, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
      {/each}
      <mesh position={[motion.current, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
      {#if visible}
        <svelte:boundary {pending} {failed}>
          ${'<svelte:boundary>'.repeat(4)}
            <mesh name={await request} position={[0, 2, 0]} {@attach setup}>
              <boxGeometry /><standardMaterial />
            </mesh>
          ${'</svelte:boundary>'.repeat(4)}
        </svelte:boundary>
      {/if}
    </scene>
    ${host === 'viewport' ? '</canvas><style>canvas { height: 420px; }</style>' : ''}`;
    const Scene = host === 'viewport' ? await compileAsyncViewportSource<Controls>(source) :
      await compileAsyncTypeGpuSource<Controls>(source);
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
    vi.mocked(tgpu.init).mockClear().mockResolvedValue(gpu as never);
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const first = deferred();
    const late = deferred();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    let draw!: TypeGpuRenderer;
    let setScene!: MockInstance<TypeGpuRenderer['setScene']>;
    let disposeRenderer = () => {};
    let instance: Controls;
    let canvas: HTMLCanvasElement;
    if (host === 'viewport') {
      instance = mount(viewportParent(), { target: document.body, props: {
        Viewport: Scene, motion, initial: first.promise, setup, frameloop,
        onready(root: TypeGpuRoot) { draw = root.gpu; setScene = vi.spyOn(draw, 'setScene'); }
      } });
      await settleComponentUpdates(); await settleComponentUpdates();
      canvas = document.querySelector('canvas')!;
      expect(canvas?.getAttribute('aria-label')).toBe('initial');
      expect(document.querySelector('scene, mesh')).toBeNull();
    } else {
      canvas = Object.assign(new EventTarget(), {
        clientWidth: 100, clientHeight: 100, width: 100, height: 100
      }) as HTMLCanvasElement;
      draw = await createTypeGpuRenderer({ canvas, frameloop });
      setScene = vi.spyOn(draw, 'setScene');
      const root = createFragment();
      const runtime = createTypeGpuRuntimeForTest(root, canvas, draw);
      root.runtime = runtime;
      disposeRenderer = () => { runtime.dispose(); draw.dispose(); };
      instance = mount(Scene, { renderer, target: root, props: { motion, initial: first.promise, setup } });
    }
    const order: string[] = [];
    async function step() {
      now += 1000 / hz;
      order.length = 0;
      for (const [key, callback] of [...pending]) {
        if (!pending.delete(key)) continue;
        order.push(producers.has(callback) ? 'motion' : 'render');
        callback(now);
        flushSync();
        await Promise.resolve();
      }
    }
    let disposed = false;
    try {
      await settleComponentUpdates();
      for (let i = 0; i < 3; i++) await step();
      if (frameloop === 'manual') draw.renderFrame(now);
      expect(setup.mock.calls.length).toBe(0);
      expect(pending.size).toBe(0);
      expect(captured.counts.every(count => count === 65)).toBe(true);
      const instances = buffers.find(buffer => buffer.label.endsWith('instances'))!;
      const instanceStorage = setScene.mock.lastCall![0].drawBatches[0].instances.buffer;
      const retained = [...buffers];
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear();
      vi.mocked(createMeshPipeline).mockClear(); request.mockClear();
      if (frameloop === 'demand' && rendererFirst) { draw.invalidate(); draw.invalidate(); }
      void motion.set(10);
      if (frameloop === 'demand' && !rendererFirst) { draw.invalidate(); draw.invalidate(); }
      const revealFrame = Math.floor(hz / 3), hideFrame = Math.floor(2 * hz / 3);
      const label = deferred();
      for (let frame = 0; frame < hz; frame++) {
        instances.write.mockClear();
        if (host === 'viewport' && frame === 5) {
          flushSync(() => instance.rename!(label.promise)); await settleComponentUpdates();
          expect(canvas.getAttribute('aria-label')).toBe('initial');
        }
        if (host === 'viewport' && frame === 10) {
          label.resolve('updated'); await settleComponentUpdates();
          expect(canvas.getAttribute('aria-label')).toBe('updated');
          expect(document.querySelector('canvas')).toBe(canvas);
        }
        if (frame === revealFrame) {
          first.resolve('ready'); await settleComponentUpdates();
          expect(setup).toHaveBeenCalledOnce();
        }
        if (frame === hideFrame) {
          flushSync(() => instance.hide()); await settleComponentUpdates();
          expect(cleanup).toHaveBeenCalledOnce();
        }
        const before = submissions.length;
        const previous = motion.current;
        await step();
        if (frameloop === 'manual') draw.renderFrame(now);
        expect(submissions.length - before).toBe(1);
        expect(order).toEqual(frameloop === 'manual' ? ['motion'] :
          rendererFirst ? ['render', 'motion'] : ['motion', 'render']);
        expect(instances.data[64 * 24]).toBeCloseTo(motion.current);
        expect(setScene.mock.lastCall![0].drawBatches[0].instances.buffer).toBe(instanceStorage);
        expect(captured.counts.at(-1)).toBe(frame >= revealFrame && frame < hideFrame ? 66 : 65);
        if (frame !== revealFrame && frame !== hideFrame && motion.current !== previous) {
          expect(instances.write).toHaveBeenCalledOnce();
          expect(instances.write.mock.lastCall![1]).toEqual({ startOffset: 64 * 96, endOffset: 65 * 96 });
        } else {
          const bytes = instances.write.mock.calls.reduce((sum, [data]) => sum + data.byteLength, 0);
          expect(bytes).toBeLessThanOrEqual(67 * 96);
        }
      }
      expect(gpu.createBuffer).not.toHaveBeenCalled();
      expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      if (host === 'viewport') expect(tgpu.init).toHaveBeenCalledOnce();
      expect(buffers).toEqual(retained);
      expect(buffers.every(buffer => buffer.destroy.mock.calls.length === 0)).toBe(true);
      await stop();
      for (let i = 0; i < 4; i++) await step();
      expect(pending.size).toBe(0);
      flushSync(() => instance.show(late.promise)); await settleComponentUpdates();
      if (host === 'viewport') {
        flushSync(() => instance.rename!(late.promise)); await settleComponentUpdates();
      }
      for (let i = 0; i < 3; i++) await step();
      expect(pending.size).toBe(0);
      expect(setup).toHaveBeenCalledOnce();
      if (frameloop === 'manual') expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
      void motion.set(20);
      await step();
      await unmount(instance); disposeRenderer(); disposed = true;
      const before = submissions.length;
      instances.write.mockClear();
      if (outcome === 'resolve') late.resolve('obsolete');
      else late.reject(new Error('obsolete'));
      await settleComponentUpdates();
      expect([...pending.values()].every(callback => producers.has(callback))).toBe(true);
      await stop();
      for (let i = 0; i < 4; i++) await step();
      expect(pending.size).toBe(0);
      expect(submissions).toHaveLength(before);
      expect(instances.write).not.toHaveBeenCalled();
      expect(setup).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(gpu.destroy).toHaveBeenCalledOnce();
      if (host === 'viewport') expect(document.querySelector('canvas')).toBeNull();
    } finally {
      await stop();
      if (!disposed) { await unmount(instance); disposeRenderer(); }
    }
  }
);
