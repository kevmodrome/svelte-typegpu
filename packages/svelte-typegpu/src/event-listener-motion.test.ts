// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, onDestroy, unmount } from 'svelte';
import { Spring, Tween } from 'svelte/motion';
import * as svelteClient from 'svelte/internal/client';
import tgpu from 'typegpu';
import { createFragment, dispatchNodeEvent, type TypeGpuNode } from './core';
import { onNodeEvent } from './attachments';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';
import * as transforms from './transform';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[] }));
vi.mock('typegpu', async importOriginal => {
  const actual = await importOriginal<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});
vi.mock('./typegpu-pipeline', async () => {
  const { createFakePipeline } = await import('./gpu-test-utils');
  return {
    createMeshPipeline: vi.fn(() => createFakePipeline(captured)),
    createShadowPipeline: vi.fn(() => createFakePipeline(captured)),
    createShaderPassPipeline: vi.fn(() => createFakePipeline(captured))
  };
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  captured.bindings.length = 0; captured.counts.length = 0;
});

describe('attachment listener lifecycle during real Svelte motion', () => {
  it.each([60, 120, 144].flatMap(hz => ['Tween', 'Spring'].flatMap(kind => [
    { hz, kind, frameloop: 'demand' as const, rendererFirst: false },
    { hz, kind, frameloop: 'demand' as const, rendererFirst: true },
    { hz, kind, frameloop: 'manual' as const, rendererFirst: false }
  ])).flatMap(test => [false, true].map(lens => ({ ...test, lens }))))(
    'delivers $kind at $hz Hz ($frameloop, renderer first: $rendererFirst, lens: $lens)',
    async ({ hz, kind, frameloop, rendererFirst, lens }) => {
    let now = 0, id = 0;
    const pending = new Map<number, FrameRequestCallback>(), producers = new WeakSet<FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
    const raf = (svelteClient as unknown as { raf: { now(): number; tick(callback: FrameRequestCallback): void } }).raf;
    vi.spyOn(raf, 'now').mockImplementation(() => now);
    vi.spyOn(raf, 'tick').mockImplementation(callback => { producers.add(callback); requestAnimationFrame(callback); });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
    vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const canvas = Object.assign(new EventTarget(), { width: 800, height: 500, clientWidth: 800, clientHeight: 500 }) as HTMLCanvasElement;
    const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop });
    const changed = vi.spyOn(gpuRenderer, 'setScene');
    const root = createFragment(), runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer);
    root.runtime = runtime;
    const Scene = compileViewportSource<{
      go(value: number): void; current(): number; abort(): void; renew(): void; read(): { moves: number; presses: number }
    }>(`<script>
      import { ${kind} } from 'svelte/motion';
      import { onDestroy } from 'svelte';
      let { onNodeEvent, setup, cleanup } = $props();
      const motion = new ${kind}(0, ${kind === 'Tween' ? '{ duration: 1800 }' : '{ stiffness: 0.03, damping: 0.7, precision: 1e-5 }'});
      let generation = $state(0), presses = $state(0), moves = $state(0), active;
      function track(key) { return node => {
        const controller = new AbortController(); active = controller; setup(node);
        onNodeEvent(node, 'pointermove', event => { event.preventDefault(); moves++; }, { passive: true, signal: controller.signal });
        onNodeEvent(node, 'click', () => presses++, { capture: true, once: true, signal: controller.signal });
        return () => { controller.abort(); cleanup(node); };
      }; }
      export function go(value) { void motion.set(value); }
      export function current() { return motion.current; }
      export function abort() { active.abort(); }
      export function renew() { generation++; }
      export function read() { return { moves, presses }; }
      onDestroy(() => { void motion.set(motion.current, ${kind === 'Tween' ? '{ duration: 0 }' : '{ instant: true }'}); });
    </script><scene>
      <perspectiveCamera position={[0, 0, 10]} target={[0, 0, 0]} ${lens ? 'fov={45 + motion.current}' : ''}>
        <controls><pointerControls wheel="zoom" /></controls>
      </perspectiveCamera>
      {#each Array.from({ length: 100 }, (_, i) => i) as id (id)}
        <mesh position={[id + 10, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
      {/each}
      {#snippet marker(position)}
        <mesh position={[position, 0, 0]} {@attach track(generation)}>
          <boxGeometry /><standardMaterial color={presses > 0 ? [1, 0.5, 0.2] : [0.2, 0.7, 0.5]} />
        </mesh>
      {/snippet}
      {@render marker(motion.current)}
    </scene>`, { Tween, Spring, onDestroy });
    const setup = vi.fn<(node: TypeGpuNode) => void>(), cleanup = vi.fn();
    const instance = mount(Scene, { renderer, target: root, props: { onNodeEvent, setup, cleanup } });
    const order: string[] = [];
    async function step() {
      now += 1000 / hz; order.length = 0;
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
      canvas.dispatchEvent(new WheelEvent('wheel', { deltaY: -2, cancelable: true }));
      for (let i = 0; i < 4; i++) await step();
      if (frameloop === 'manual') gpuRenderer.renderFrame(now);
      expect(pending.size).toBe(0);
      const view = changed.mock.lastCall![0].camera;
      expect(view.position[2]).toBeLessThan(10);
      const node = setup.mock.calls[0][0];
      const buffer = buffers.find(buffer => buffer.label.endsWith('instances'))!;
      const storage = changed.mock.lastCall![0].drawBatches[0].instances;
      const staticData = buffer.data.slice(0, 100 * 24);
      let registration = [...node.listeners.get('pointermove')!.values()][0];
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear(); vi.mocked(createMeshPipeline).mockClear();
      request.mockClear();
      const transformReads = vi.spyOn(transforms, 'readLocalTransform');
      if (frameloop === 'demand' && rendererFirst) { gpuRenderer.invalidate(); gpuRenderer.invalidate(); }
      instance.go(10); await settleComponentUpdates();
      if (frameloop === 'demand' && !rendererFirst) { gpuRenderer.invalidate(); gpuRenderer.invalidate(); }
      for (let frame = 0; frame < hz; frame++) {
        buffer.write.mockClear(); changed.mockClear(); transformReads.mockClear();
        if (frame === 4) instance.abort();
        if (frame === 6) flushSync(() => instance.renew());
        if ([2, 3, 5, 7].includes(frame)) flushSync(() => dispatchNodeEvent(node, 'click'));
        const original = new Event('pointermove', { cancelable: true });
        flushSync(() => dispatchNodeEvent(node, 'pointermove', { originalEvent: original }));
        await Promise.resolve();
        expect(original.defaultPrevented).toBe(false);
        const before = submissions.length;
        await step();
        if (frameloop === 'manual') gpuRenderer.renderFrame(now);
        expect(submissions.length - before).toBe(1);
        expect(order).toEqual(frameloop === 'manual' ? ['motion'] :
          rendererFirst ? ['render', 'motion'] : ['motion', 'render']);
        expect(buffer.write).toHaveBeenCalledTimes(frame === 2 ? 2 : 1);
        expect(transformReads.mock.calls.length).toBe(1);
        for (const [, range] of buffer.write.mock.calls) expect(range).toEqual({ startOffset: 100 * 96, endOffset: 101 * 96 });
        for (const [state] of changed.mock.calls) {
          expect(state.drawBatches[0].instances).toBe(storage);
          if (!lens) expect(state.camera).toBe(view);
          expect(state.camera.position === view.position).toBe(true);
          expect(state.camera.target === view.target).toBe(true);
        }
        if (lens) expect(changed.mock.lastCall![0].camera.fov).toBeCloseTo(45 + instance.current());
        expect(buffer.data[100 * 24]).toBeCloseTo(instance.current());
        if (frame === 6) registration = [...node.listeners.get('pointermove')!.values()][0];
        if (frame === 4 || frame === 5) expect(node.listeners.size).toBe(0);
        else expect([...node.listeners.get('pointermove')!.values()][0]).toBe(registration);
      }
      expect(instance.read()).toEqual({ presses: 2, moves: hz - 2 });
      expect(setup).toHaveBeenCalledTimes(2); expect(cleanup).toHaveBeenCalledOnce();
      for (let i = 0; pending.size && i < hz * 20; i++) await step();
      expect(instance.current()).toBe(10); expect(pending.size).toBe(0);
      expect(buffer.data.slice(0, 100 * 24)).toEqual(staticData);
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      expect(captured.counts.every(count => count === 101)).toBe(true);
      if (frameloop === 'manual') expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
      const settled = submissions.length;
      for (let i = 0; i < 4; i++) await step();
      expect(submissions).toHaveLength(settled);
      instance.go(20); await settleComponentUpdates(); await step();
      await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); disposed = true;
      const beforeDispose = submissions.length;
      expect(node.listeners.size).toBe(0); expect(node.captureListeners).toBeUndefined();
      await settleComponentUpdates();
      for (let i = 0; i < 4; i++) await step();
      expect(pending.size).toBe(0); expect(submissions).toHaveLength(beforeDispose);
      expect(cleanup).toHaveBeenCalledTimes(2); expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      if (!disposed) { await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); }
      await settleComponentUpdates();
      for (let i = 0; i < 4; i++) await step();
    }
  });
});
