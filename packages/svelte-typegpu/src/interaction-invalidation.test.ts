// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import tgpu from 'typegpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragment } from './core';
import { onNodeEvent } from './attachments';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { compileTypeGpuSource, settleComponentUpdates } from './component-test-utils';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';

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

async function setup(hz: number, frameloop: 'demand' | 'manual' | 'always', controls = false) {
  let now = 0, id = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
  const cancel = vi.fn((id: number) => pending.delete(id));
  vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', cancel);
  const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
  vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
  vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 100;
  Object.defineProperties(canvas, { clientWidth: { value: 100 }, clientHeight: { value: 100 } });
  canvas.setPointerCapture = vi.fn(); canvas.releasePointerCapture = vi.fn();
  const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop });
  const changed = vi.spyOn(gpuRenderer, 'setScene'), camera = vi.spyOn(gpuRenderer, 'setCamera');
  const root = createFragment(), runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer, window);
  root.runtime = runtime;
  const calls = vi.fn();
  const Scene = compileTypeGpuSource<{
    abort(): void; renew(): void; configure(options: { pointerEvents?: string; x?: number }): void
  }>(`<script>
    let { onNodeEvent, calls, controls } = $props();
    let generation = $state(0), pointerEvents = $state('auto'), x = $state(0), active;
    function listen(key) { return node => {
      const controller = new AbortController(); active = controller;
      for (const type of ['click', 'wheel', 'pointercancel', 'dragstart', 'dragend']) {
        onNodeEvent(node, type, event => { event.preventDefault(); calls(type); }, {
          once: type === 'click', passive: type === 'wheel', signal: controller.signal
        });
      }
      return () => controller.abort();
    }; }
    export function abort() { active.abort(); }
    export function renew() { generation++; }
    export function configure(options) {
      if (options.pointerEvents !== undefined) pointerEvents = options.pointerEvents;
      if (options.x !== undefined) x = options.x;
    }
  </script><scene>
    <perspectiveCamera position={[0, 0, 10]} target={[0, 0, 0]}>
      {#if controls}<controls><pointerControls wheel="zoom" /></controls>{/if}
    </perspectiveCamera>
    {#each Array.from({ length: 100 }, (_, i) => i) as i (i)}
      <mesh position={[i + 10, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
    {/each}
    <mesh position={[x, 0, 0]} {pointerEvents} {@attach listen(generation)}>
      <boxGeometry /><standardMaterial />
    </mesh>
  </scene>`);
  const instance = mount(Scene, { renderer, target: root, props: { onNodeEvent, calls, controls } });
  async function step() {
    now += 1000 / hz;
    for (const [key, callback] of [...pending]) {
      if (!pending.delete(key)) continue;
      callback(now); flushSync(); await Promise.resolve();
    }
  }
  await settleComponentUpdates();
  for (let i = 0; i < 3; i++) await step();
  if (frameloop === 'manual') gpuRenderer.renderFrame(now);
  return {
    pending, request, cancel, gpu, gpuRenderer, buffers, submissions, canvas, changed, camera,
    calls, instance, step, now: () => now,
    async dispose() { await unmount(instance); runtime.dispose(); await settleComponentUpdates(); }
  };
}

function input(target: EventTarget, type: string) {
  const options = { clientX: 50, clientY: 50, bubbles: true, cancelable: true, pointerId: 7, button: 0 };
  const event = type === 'wheel' ? new WheelEvent(type, { ...options, deltaY: -2 }) :
    type.startsWith('pointer') ? new PointerEvent(type, options) : new MouseEvent(type, options);
  Object.defineProperties(event, { offsetX: { value: 50 }, offsetY: { value: 50 } });
  target.dispatchEvent(event);
  return event;
}

describe('interaction-only invalidation', () => {
  it.each([60, 120, 144].flatMap(hz => ['demand', 'manual', 'always'].map(frameloop => ({
    hz, frameloop: frameloop as 'demand' | 'manual' | 'always'
  }))))('updates compiled attachments without extra frames at $hz Hz ($frameloop)', async ({ hz, frameloop }) => {
    const f = await setup(hz, frameloop);
    try {
      const initial = f.changed.mock.lastCall![0], storage = initial.drawBatches[0].instances;
      const buffer = f.buffers.find(buffer => buffer.label.endsWith('instances'))!;
      const staticData = buffer.data.slice(0, 100 * 24);
      f.gpu.createBuffer.mockClear(); f.gpu.createBindGroup.mockClear(); vi.mocked(createMeshPipeline).mockClear();
      async function nonvisual(change: () => void) {
        f.request.mockClear(); f.buffers.forEach(buffer => buffer.write.mockClear());
        const before = f.submissions.length;
        flushSync(change); await settleComponentUpdates();
        expect(f.request).not.toHaveBeenCalled();
        expect(f.pending.size).toBe(frameloop === 'always' ? 1 : 0);
        await f.step();
        expect(f.submissions.length - before).toBe(frameloop === 'always' ? 1 : 0);
        if (frameloop !== 'always') for (const buffer of f.buffers) expect(buffer.write).not.toHaveBeenCalled();
        expect(buffer.write).not.toHaveBeenCalled();
        expect(f.changed.mock.lastCall![0].drawBatches[0].instances).toBe(storage);
      }
      await nonvisual(() => input(f.canvas, 'click'));
      await nonvisual(() => input(f.canvas, 'click'));
      expect(f.calls.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
      await nonvisual(() => f.instance.renew());
      await nonvisual(() => f.instance.configure({ pointerEvents: 'none' }));
      input(f.canvas, 'click');
      expect(f.calls.mock.calls.filter(([type]) => type === 'click')).toHaveLength(1);
      await nonvisual(() => f.instance.configure({ pointerEvents: 'auto' }));
      await nonvisual(() => input(f.canvas, 'click'));
      expect(f.calls.mock.calls.filter(([type]) => type === 'click')).toHaveLength(2);
      expect(input(f.canvas, 'wheel').defaultPrevented).toBe(false);
      expect(f.calls.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(1);
      input(f.canvas, 'pointerdown');
      expect(f.canvas.setPointerCapture).toHaveBeenCalledWith(7);
      const removeCanvas = vi.spyOn(f.canvas, 'removeEventListener'), removeWindow = vi.spyOn(window, 'removeEventListener');
      await nonvisual(() => f.instance.abort());
      expect(f.canvas.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(7);
      expect(removeCanvas.mock.calls.some(([type]) => type === 'wheel')).toBe(true);
      expect(removeWindow.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(['pointercancel', 'pointerup']));
      input(window, 'pointercancel'); input(window, 'pointerup'); input(f.canvas, 'wheel');
      expect(f.calls.mock.calls.filter(([type]) => type === 'wheel')).toHaveLength(1);
      expect(f.calls.mock.calls.some(([type]) => type === 'pointercancel' || type === 'dragend')).toBe(false);
      await nonvisual(() => f.instance.renew());
      const beforeVisual = f.submissions.length;
      flushSync(() => { f.instance.renew(); f.instance.configure({ x: 1 }); });
      await settleComponentUpdates(); await f.step();
      expect(f.submissions.length - beforeVisual).toBe(frameloop === 'manual' ? 0 : 1);
      expect(buffer.write).toHaveBeenCalledOnce();
      expect(buffer.write.mock.lastCall![1]).toEqual({ startOffset: 9600, endOffset: 9696 });
      expect(buffer.data[100 * 24]).toBe(1);
      if (frameloop === 'manual') f.gpuRenderer.renderFrame(f.now());
      for (let i = 0; i < 3; i++) await f.step();
      // An interaction delta must not replay the preceding visual upload.
      await nonvisual(() => f.instance.renew());
      if (frameloop === 'demand') {
        f.gpuRenderer.invalidate();
        const beforeQueued = f.submissions.length;
        flushSync(() => f.instance.renew()); await settleComponentUpdates();
        await f.step();
        expect(f.submissions.length - beforeQueued).toBe(1);
        expect(f.pending.size).toBe(0);
      }
      if (frameloop === 'manual') expect(f.request).not.toHaveBeenCalled();
      expect(buffer.data.slice(0, 100 * 24)).toEqual(staticData);
      expect(f.gpu.createBuffer).not.toHaveBeenCalled(); expect(f.gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
    } finally { await f.dispose(); }
    expect(f.pending.size).toBe(0);
    const disposed = f.submissions.length; await f.step(); expect(f.submissions).toHaveLength(disposed);
  });

  it.each([60, 120, 144])('preserves committed and pending orbit input through listener changes at %s Hz', async hz => {
    const f = await setup(hz, 'demand', true);
    try {
      input(f.canvas, 'wheel');
      expect(f.pending.size).toBe(1);
      const scheduled = [...f.pending.keys()]; f.request.mockClear(); f.cancel.mockClear();
      flushSync(() => f.instance.renew()); await settleComponentUpdates();
      expect([...f.pending.keys()]).toEqual(scheduled);
      expect(f.request).not.toHaveBeenCalled(); expect(f.cancel).not.toHaveBeenCalled();
      for (let i = 0; i < 4; i++) await f.step();
      expect(f.camera).toHaveBeenCalledOnce(); expect(f.pending.size).toBe(0);
      const camera = f.camera.mock.lastCall![0], before = f.submissions.length;
      expect(camera.position[2]).toBeLessThan(10);
      flushSync(() => f.instance.abort()); await settleComponentUpdates();
      expect(f.changed.mock.lastCall![0].camera).toBe(camera);
      expect(f.pending.size).toBe(0);
      await f.step(); expect(f.submissions).toHaveLength(before);
      input(f.canvas, 'wheel');
      for (let i = 0; i < 4; i++) await f.step();
      expect(f.camera).toHaveBeenCalledTimes(2);
      expect(f.camera.mock.lastCall![0].position[2]).toBeLessThan(camera.position[2]);
      expect(f.pending.size).toBe(0);
    } finally { await f.dispose(); }
    expect(f.pending.size).toBe(0);
  });
});
