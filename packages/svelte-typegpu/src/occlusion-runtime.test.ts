// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, onDestroy, unmount } from 'svelte';
import { Spring, Tween } from 'svelte/motion';
import * as client from 'svelte/internal/client';
import tgpu from 'typegpu';
import { createFragment } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createFakeGpuRoot, enableFakeOcclusion } from './gpu-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[],
  indirect: [] as { indexed: boolean; buffer: unknown; offset: number }[] }));
vi.mock('typegpu', async original => {
  const actual = await original<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});
vi.mock('./typegpu-pipeline', async () => {
  const { createFakePipeline } = await import('./gpu-test-utils');
  return { createMeshPipeline: vi.fn(() => createFakePipeline(captured)),
    createShadowPipeline: vi.fn(() => createFakePipeline(captured)),
    createShaderPassPipeline: vi.fn(() => createFakePipeline(captured)) };
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); captured.bindings.length = captured.counts.length = captured.indirect.length = 0; });

describe('compiled motion with current-frame GPU occlusion', () => {
  it.each([60,120,144].flatMap(hz => ['Tween','Spring'].flatMap(kind => [
    { hz, kind, mode: 'demand' as const, first: false }, { hz, kind, mode: 'demand' as const, first: true },
    { hz, kind, mode: 'manual' as const, first: false }
  ])))('delivers $kind at $hz Hz ($mode, renderer first: $first)', async ({ hz, kind, mode, first }) => {
    let now = 0, id = 0;
    const pending = new Map<number, FrameRequestCallback>(), producers = new WeakSet<FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request); vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));
    const raf = (client as unknown as { raf: { now(): number; tick(callback: FrameRequestCallback): void } }).raf;
    vi.spyOn(raf, 'now').mockImplementation(() => now);
    vi.spyOn(raf, 'tick').mockImplementation(callback => { producers.add(callback); requestAnimationFrame(callback); });
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured), fake = enableFakeOcclusion(gpu);
    vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
    const canvas = Object.assign(new EventTarget(), { width: 400, height: 400, clientWidth: 400, clientHeight: 400 }) as HTMLCanvasElement;
    const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop: mode });
    const changed = vi.spyOn(gpuRenderer, 'setScene');
    const root = createFragment(), runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer); root.runtime = runtime;
    const Scene = compileViewportSource<{ animate(): void; stop(): void; toggle(value: boolean): void }>(`<script>
      import { ${kind} } from 'svelte/motion'; import { onDestroy } from 'svelte';
      let enabled = $state(true);
      const motion = new ${kind}(0, ${kind === 'Tween' ? '{ duration: 1800 }' : '{ stiffness: 0.02, damping: 0.7, precision: 1e-5 }'});
      export function animate() { void motion.set(0.5); }
      export function stop() { void motion.set(motion.current, ${kind === 'Tween' ? '{ duration: 0 }' : '{ instant: true }'}); }
      export function toggle(value) { enabled = value; }
      onDestroy(stop);
    </script><scene occlusion={enabled ? 'hi-z' : 'none'}>
      <perspectiveCamera position={[0,0,10]} target={[0,0,0]} fov={60} far={100} />
      <directionalLight castShadow position={[0,10,10]} />
      <mesh position={[0,0,3]} scale={[8,8,1]}><boxGeometry /><basicMaterial color={[1,0,0]} /></mesh>
      {#each Array(256) as _, i}
        <mesh position={[(i%16-8)*0.2+(i===0?motion.current:0),0,-Math.floor(i/16)]} castShadow>
          <sphereGeometry radius={0.1} /><basicMaterial />
        </mesh>
      {/each}
    </scene>`, { Tween, Spring, onDestroy });
    const instance = mount(Scene, { renderer, target: root });
    const order: string[] = [];
    async function step() {
      now += 1000 / hz; order.length = 0;
      for (const [key, callback] of [...pending]) {
        if (!pending.delete(key)) continue;
        order.push(producers.has(callback) ? 'motion' : 'render'); callback(now); flushSync(); await Promise.resolve();
      }
    }
    try {
      await settleComponentUpdates(); for (let i = 0; i < 4; i++) await step();
      if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(pending.size).toBe(0);
      expect(gpuRenderer.getRenderStats!()).toMatchObject({ occlusion: 'active', colorCountsExact: false, occlusionCandidates: 256 });
      const storage = changed.mock.lastCall![0].drawBatches.map(b => b.instances);
      const instanceBuffers = buffers.filter(b => b.label.endsWith('instances'));
      const shadows = gpuRenderer.getRenderStats!().shadowTriangles;
      const rendered = vi.spyOn(gpuRenderer, 'renderFrame');
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear(); fake.device.createBuffer.mockClear(); fake.createComputePipeline.mockClear();
      request.mockClear();
      if (first) gpuRenderer.invalidate();
      instance.animate(); await settleComponentUpdates();
      if (!first) gpuRenderer.invalidate();
      for (let frame = 0; frame < hz / 2; frame++) {
        const before = rendered.mock.calls.length, passes = submissions.length;
        fake.writeBuffer.mockClear(); captured.indirect.length = 0;
        for (const buffer of instanceBuffers) buffer.write.mockClear();
        await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
        expect(rendered.mock.calls.length - before).toBe(1);
        expect(submissions.length - passes).toBe(3);
        expect(captured.indirect).toHaveLength(1);
        if (frame === 0) expect(order).toEqual(mode === 'manual' ? ['motion'] : first ? ['render','motion'] : ['motion','render']);
        // A demand renderer can naturally swap order once the external producer
        // becomes its only invalidation source; both orders still deliver once.
        expect([...order].sort()).toEqual(mode === 'manual' ? ['motion'] : ['motion','render']);
        expect(gpuRenderer.getRenderStats!().shadowTriangles).toBe(shadows);
        expect(changed.mock.lastCall![0].drawBatches.every((b, i) => b.instances === storage[i])).toBe(true);
        if (frame > 1) {
          const bytes = instanceBuffers.flatMap(b => b.write.mock.calls).reduce((sum, [, r]) => sum + r!.endOffset - r!.startOffset, 0);
          expect(bytes).toBe(96);
          const bounds = fake.writeBuffer.mock.calls.filter(([buffer]) => buffer.label.startsWith('Occlusion bounds'));
          expect(bounds.map(([, , , , bytes]) => bytes)).toEqual([32]);
        }
      }
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(fake.device.createBuffer).not.toHaveBeenCalled(); expect(fake.createComputePipeline).not.toHaveBeenCalled();
      if (mode === 'manual') expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
      flushSync(() => instance.stop()); await settleComponentUpdates(); for (let i = 0; i < 5; i++) await step();
      expect(pending.size).toBe(0);
      const settled = submissions.length; for (let i = 0; i < 4; i++) await step(); expect(submissions.length).toBe(settled);
      flushSync(() => instance.toggle(false)); await settleComponentUpdates();
      await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(gpuRenderer.getRenderStats!()).toMatchObject({ occlusion: 'disabled', colorCountsExact: true });
      expect(fake.buffers.every(b => b.destroy.mock.calls.length === 1)).toBe(true);
      gpuRenderer.invalidate();
    } finally {
      await unmount(instance); runtime.dispose(); gpuRenderer.dispose();
      await settleComponentUpdates(); for (let i = 0; i < 4; i++) await step();
      expect(pending.size).toBe(0);
    }
  });
});
