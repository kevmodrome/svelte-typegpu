// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, onDestroy, unmount } from 'svelte';
import { Spring, Tween } from 'svelte/motion';
import * as client from 'svelte/internal/client';
import tgpu from 'typegpu';
import { createFragment, findFirst } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { createTypeGpuRenderer } from './gpu-renderer';
import { createMeshPipeline } from './typegpu-pipeline';
import { createFakeGpuRoot } from './gpu-test-utils';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';
import * as controller from '../../../apps/docs/src/examples/asset-world/player-controller';
import * as input from '../../../apps/docs/src/examples/asset-world/player-input';
import * as transforms from './transform';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[] }));
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
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); captured.bindings.length = 0; captured.counts.length = 0; });
const source = readFileSync(resolve(process.cwd(), '../../apps/docs/src/examples/asset-world/Player.typegpu.svelte'), 'utf8');

describe('compiled camper frame delivery', () => {
  it.each([60, 120, 144].flatMap(hz => ['Tween', 'Spring'].flatMap(kind => [
    { hz, kind, mode: 'demand' as const, first: false },
    { hz, kind, mode: 'demand' as const, first: true },
    { hz, kind, mode: 'manual' as const, first: false }
  ])))('moves only the camper and $kind at $hz Hz ($mode, renderer first: $first)', async ({ hz, kind, mode, first }) => {
    let now = 0, id = 0;
    const pending = new Map<number, FrameRequestCallback>(), producers = new WeakSet<FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
    const raf = (client as unknown as { raf: { now(): number; tick(callback: FrameRequestCallback): void } }).raf;
    vi.spyOn(raf, 'now').mockImplementation(() => now);
    vi.spyOn(raf, 'tick').mockImplementation(callback => { producers.add(callback); requestAnimationFrame(callback); });
    const { root: gpu, buffers, submissions } = createFakeGpuRoot(captured);
    vi.mocked(tgpu.init).mockResolvedValue(gpu as never);
    vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
    const canvas = Object.assign(new EventTarget(), { width: 800, height: 500, clientWidth: 800, clientHeight: 500 }) as HTMLCanvasElement;
    const gpuRenderer = await createTypeGpuRenderer({ canvas, frameloop: mode });
    const changed = vi.spyOn(gpuRenderer, 'setScene');
    const root = createFragment(), runtime = createTypeGpuRuntimeForTest(root, canvas, gpuRenderer); root.runtime = runtime;
    const Player = compileViewportSource(source, { ...controller, ...input });
    const Host = compileViewportSource<{ animate(): void; walk(value: boolean): void; stop(): void }>(`<script>
      import { ${kind} } from 'svelte/motion'; import { onDestroy } from 'svelte';
      let { Player } = $props(); let walking = $state(false);
      const motion = new ${kind}(0, ${kind === 'Tween' ? '{ duration: 1800 }' : '{ stiffness: 0.02, damping: 0.7, precision: 1e-5 }'});
      export function animate() { void motion.set(10); }
      export function walk(value) { walking = value; }
      export function stop() { walking = false; void motion.set(motion.current, ${kind === 'Tween' ? '{ duration: 0 }' : '{ instant: true }'}); }
      onDestroy(stop);
    </script><scene><perspectiveCamera position={[18, 17, 23]} />
      {#each Array.from({ length: 1000 }, (_, i) => i) as id (id)}
        <mesh position={[id, -2, 0]}><boxGeometry /><basicMaterial /></mesh>
      {/each}
      <Player movement={{ x: 0, z: walking ? -1 : 0, run: false }} camera={{ x: 0, z: 1 }} />
      <mesh position={[motion.current, 5, 0]}><boxGeometry /><basicMaterial /></mesh>
    </scene>`, { Tween, Spring, onDestroy });
    const instance = mount(Host, { renderer, target: root, props: { Player } });
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
      await settleComponentUpdates(); for (let i = 0; i < 4; i++) await step();
      if (mode === 'manual') gpuRenderer.renderFrame(now);
      expect(pending.size).toBe(0);
      const storage = changed.mock.lastCall![0].drawBatches.map(batch => batch.instances);
      const instanceBuffers = buffers.filter(buffer => buffer.label.endsWith('instances'));
      const beforeData = instanceBuffers.map(buffer => buffer.data.slice());
      const reads = vi.spyOn(transforms, 'readLocalTransform');
      gpu.createBuffer.mockClear(); gpu.createBindGroup.mockClear(); vi.mocked(createMeshPipeline).mockClear(); request.mockClear();
      if (first) { flushSync(() => instance.walk(true)); await settleComponentUpdates(); }
      instance.animate(); await settleComponentUpdates();
      if (!first) { flushSync(() => instance.walk(true)); await settleComponentUpdates(); }
      for (let frame = 0; frame < hz / 2; frame++) {
        for (const buffer of instanceBuffers) buffer.write.mockClear(); reads.mockClear();
        const before = submissions.length;
        await step(); if (mode === 'manual') gpuRenderer.renderFrame(now);
        expect(submissions.length - before).toBe(1);
        expect(order).toEqual(mode === 'manual' ? ['motion'] : first ? ['render', 'motion'] : ['motion', 'render']);
        const writes = instanceBuffers.flatMap(buffer => buffer.write.mock.calls);
        if (frame > 0) {
          // Twelve camper parts plus one external mesh; the 1,000 static objects never upload.
          expect(writes.reduce((bytes, [, range]) => bytes + range!.endOffset - range!.startOffset, 0)).toBe(13 * 96);
          // The moving parent visits its 17-node spatial subtree, plus the external mesh.
          expect(reads.mock.calls.length).toBe(18);
        }
        expect(changed.mock.lastCall![0].drawBatches.every((batch, index) => batch.instances === storage[index])).toBe(true);
      }
      const camper = findFirst(root, node => node.attributes.name === 'camper')!;
      expect((camper.attributes.position as number[])[2]).toBeLessThan(controller.createPlayerState().z - 1);
      for (let i = 0; i < instanceBuffers.length; i++) {
        if (!instanceBuffers[i].write.mock.calls.length) expect(instanceBuffers[i].data).toEqual(beforeData[i]);
      }
      expect(gpu.createBuffer).not.toHaveBeenCalled(); expect(gpu.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      if (mode === 'manual') expect(request.mock.calls.every(([callback]) => producers.has(callback))).toBe(true);
      flushSync(() => instance.stop()); await settleComponentUpdates();
      for (let i = 0; i < 5; i++) await step();
      expect(pending.size).toBe(0);
      const settled = submissions.length; for (let i = 0; i < 4; i++) await step(); expect(submissions.length).toBe(settled);
      flushSync(() => instance.walk(true)); await settleComponentUpdates();
      await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); disposed = true;
      await settleComponentUpdates(); for (let i = 0; i < 4; i++) await step();
      expect(pending.size).toBe(0); expect(submissions.length).toBe(settled); expect(gpu.destroy).toHaveBeenCalledOnce();
    } finally {
      if (!disposed) { await unmount(instance); runtime.dispose(); gpuRenderer.dispose(); }
      await settleComponentUpdates(); for (let i = 0; i < 4; i++) await step();
    }
  });
});
