// @vitest-environment happy-dom
import tgpu, { d } from 'typegpu';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, insert, remove, setAttribute } from './core';
import { Dirty } from './dirty';
import { createTypeGpuRenderer } from './gpu-renderer';
import {
  GeometryResourceCache,
  MaterialResourceCache,
  SamplerResourceCache,
  TextureResourceCache
} from './resource-caches';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import { createMaterialDescriptor } from './material-descriptors';
import { createMeshPipeline } from './typegpu-pipeline';
import { flushSync, mount, tick, unmount } from 'svelte';
import { Spring, Tween } from 'svelte/motion';
import * as svelteClient from 'svelte/internal/client';
import sceneRenderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { compileTypeGpuSource } from './component-test-utils';
import type { TypeGpuAttachment } from './attachments';
import { loadModel } from './model-loader';
import type { TypeGpuLoadedModel } from './types';
import SceneHost from './SceneHost.svelte';

const captured = vi.hoisted(() => ({ bindings: [] as unknown[][], counts: [] as number[] }));

vi.mock('typegpu', async (importOriginal) => {
  const actual = await importOriginal<typeof import('typegpu')>();
  return { ...actual, default: { ...actual.default, init: vi.fn() } };
});

vi.mock('@typegpu/noise', () => ({
  perlin3d: { staticCache: () => ({ inject: () => (root: unknown) => root, destroy() {} }) }
}));
vi.mock('./typegpu-pipeline', () => {
  function pipeline(bindings: unknown[] = []) {
    return {
      with: (...values: unknown[]) => pipeline([...bindings, ...values]),
      withIndexBuffer: (...values: unknown[]) => pipeline([...bindings, ...values]),
      draw: (_vertices: number, count = 1) => { captured.bindings.push(bindings); captured.counts.push(count); },
      drawIndexed: (_indices: number, count = 1) => { captured.bindings.push(bindings); captured.counts.push(count); }
    };
  }
  return {
    createMeshPipeline: vi.fn(() => pipeline()),
    createShadowPipeline: vi.fn(() => pipeline()),
    createShaderPassPipeline: vi.fn(() => pipeline())
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  captured.bindings.length = 0;
  captured.counts.length = 0;
});

describe('GPU resource and frame lifecycle', () => {
  it.each([60, 120, 144].flatMap(hz =>
    (['manual', 'demand'] as const).map(frameloop => ({ hz, frameloop }))
  ))('settles await assets with bounded $frameloop frames at $hz Hz', async ({ hz, frameloop }) => {
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    let now = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      pending.set(++id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => pending.delete(id)));
    const Scene = compileTypeGpuSource<{ tint(): void; hide(): void }>(`
      <script>
        let { request } = $props();
        let shown = $state(true);
        let color = $state([1, 0, 0, 1]);
        export function tint() { color = [0, 1, 0, 1]; }
        export function hide() { shown = false; }
      </script>
      <mesh><boxGeometry /><basicMaterial /></mesh>
      {#if shown}
        {#await request}<group />{:then asset}
          <model {asset}><basicMaterial /></model>
          <model {asset} position={[3, 0, 0]}><basicMaterial {color} /></model>
        {/await}
      {/if}
    `);
    let resolve!: (asset: TypeGpuLoadedModel) => void;
    const request = new Promise<TypeGpuLoadedModel>(yes => { resolve = yes; });
    const { renderer, root: gpuRoot, buffers, submissions } = await setupRenderer(frameloop);
    const root = createFragment();
    const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, renderer);
    root.runtime = runtime;
    const instance = mount(Scene, { renderer: sceneRenderer, target: root, props: { request } });
    function step() {
      now += 1000 / hz;
      for (const [id, callback] of [...pending]) {
        pending.delete(id);
        callback(now);
      }
    }
    try {
      await tick();
      step(); step();
      expect(pending.size).toBe(0);
      const staticInstances = buffers.find(buffer => buffer.label.endsWith('instances'))!;
      staticInstances.write.mockClear();
      submissions.length = 0;
      const asset = await loadModel(new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3').buffer);
      resolve(asset);
      await tick();
      expect(submissions).toHaveLength(0);
      expect(pending.size).toBe(frameloop === 'demand' ? 1 : 0);
      if (frameloop === 'manual') renderer.renderFrame(now);
      else step();
      expect(submissions).toHaveLength(1);
      step(); step();
      expect(pending.size).toBe(0);
      expect(submissions.length).toBeLessThanOrEqual(2);
      expect(staticInstances.write).not.toHaveBeenCalled();
      const vertices = buffers.filter(buffer => buffer.label.includes(asset.key) && buffer.label.endsWith('vertices'));
      expect(vertices).toHaveLength(1);
      const instances = buffers.find(buffer => buffer.label.includes(asset.key) && buffer.label.endsWith('instances'))!;
      expect(instances.data).toHaveLength(2 * 24);
      gpuRoot.createBuffer.mockClear();
      gpuRoot.createBindGroup.mockClear();
      vi.mocked(createMeshPipeline).mockClear();
      instances.write.mockClear();
      flushSync(() => instance.tint());
      await tick();
      expect(instances.write).toHaveBeenCalledOnce();
      expect(instances.write.mock.calls[0][1]).toEqual({ startOffset: 96, endOffset: 192 });
      expect(gpuRoot.createBuffer).not.toHaveBeenCalled();
      expect(gpuRoot.createBindGroup).not.toHaveBeenCalled();
      expect(createMeshPipeline).not.toHaveBeenCalled();
      flushSync(() => instance.hide());
      await tick();
      expect(vertices[0].destroy).toHaveBeenCalledOnce();
      expect(instances.destroy).toHaveBeenCalledOnce();
      expect(staticInstances.destroy).not.toHaveBeenCalled();
      step(); step();
      expect(pending.size).toBe(0);
      if (frameloop === 'manual') expect(requestAnimationFrame).not.toHaveBeenCalled();
    } finally {
      await unmount(instance);
      runtime.dispose();
      renderer.dispose();
    }
    expect(pending.size).toBe(0);
  });

  it.each(
    [60, 120, 144].flatMap((hz) =>
      [false, true].flatMap((rendererFirst) =>
        ['Tween', 'Spring'].map((kind) => ({ hz, rendererFirst, kind }))
      )
    )
  )(
    'delivers real $kind motion at $hz Hz (renderer first: $rendererFirst)',
    async ({ hz, rendererFirst, kind }) => {
      const pending = new Map<number, FrameRequestCallback>();
      let id = 0;
      let now = 0;
      const motionCallbacks = new WeakSet<FrameRequestCallback>();
      const frameOrder: string[] = [];
      vi.stubGlobal(
        'requestAnimationFrame',
        vi.fn((callback: FrameRequestCallback) => {
          pending.set(++id, callback);
          return id;
        })
      );
      vi.stubGlobal(
        'cancelAnimationFrame',
        vi.fn((id: number) => pending.delete(id))
      );
      const raf = (
        svelteClient as unknown as { raf: { now(): number; tick(callback: () => void): void } }
      ).raf;
      vi.spyOn(raf, 'now').mockImplementation(() => now);
      vi.spyOn(raf, 'tick').mockImplementation((callback) => {
        motionCallbacks.add(callback);
        requestAnimationFrame(callback);
      });
      const motion =
        kind === 'Tween'
          ? new Tween(0, { duration: 2000 })
          : new Spring(0, { stiffness: 0.01, damping: 0.5, precision: 1e-8 });
      const stopMotion = () =>
        motion instanceof Tween
          ? motion.set(motion.current, { duration: 0 })
          : motion.set(motion.current, { instant: true });
      const Scene = compileTypeGpuSource(`
      <script>let { motion, setup } = $props();</script>
      <scene>
        {#each Array.from({ length: 300 }, (_, i) => i) as i (i)}
          <mesh position={[i, 0, -5]}><boxGeometry /><standardMaterial /></mesh>
        {/each}
        <mesh position={[motion.current, 0, 0]} {@attach setup}>
          <boxGeometry /><standardMaterial color={[motion.current / 10, 0, 0, 1]} />
        </mesh>
      </scene>
    `);
      const { renderer, root: gpuRoot, buffers, submissions } = await setupRenderer('demand');
      const root = createFragment();
      const runtime = createTypeGpuRuntimeForTest(
        root,
        new EventTarget() as HTMLCanvasElement,
        renderer
      );
      root.runtime = runtime;
      const cleanup = vi.fn();
      const setup = vi.fn<TypeGpuAttachment>(() => cleanup);
      const instance = mount(SceneHost, {
        renderer: sceneRenderer,
        target: root,
        props: { scene: Scene, sceneProps: { motion, setup } }
      });
      async function step() {
        now += 1000 / hz;
        frameOrder.length = 0;
        for (const [id, callback] of [...pending]) {
          if (!pending.delete(id)) continue;
          frameOrder.push(motionCallbacks.has(callback) ? 'motion' : 'render');
          callback(now);
          // Browsers perform microtask checkpoints between RAF callbacks.
          flushSync();
          await Promise.resolve();
        }
      }
      try {
        flushSync();
        await Promise.resolve();
        for (let i = 0; i < 3; i++) await step();
        expect(pending.size).toBe(0);
        const buffer = buffers.find((buffer) => buffer.label.endsWith('instances'))!;
        gpuRoot.createBuffer.mockClear();
        gpuRoot.createBindGroup.mockClear();
        vi.mocked(createMeshPipeline).mockClear();
        buffer.write.mockClear();
        if (rendererFirst) {
          renderer.invalidate();
          renderer.invalidate();
        }
        void motion.set(10);
        if (!rendererFirst) {
          renderer.invalidate();
          renderer.invalidate();
        }
        for (let frame = 0; frame < hz; frame++) {
          const before = submissions.length;
          await step();
          expect(submissions.length - before).toBe(1);
          expect(frameOrder).toEqual(rendererFirst ? ['render', 'motion'] : ['motion', 'render']);
        }
        expect(motion.current).toBeGreaterThan(0);
        expect(setup).toHaveBeenCalledOnce();
        expect(cleanup).not.toHaveBeenCalled();
        expect(gpuRoot.createBuffer).not.toHaveBeenCalled();
        expect(gpuRoot.createBindGroup).not.toHaveBeenCalled();
        expect(createMeshPipeline).not.toHaveBeenCalled();
        expect(buffer.write.mock.calls.length).toBeGreaterThan(hz - 4);
        for (const [, range] of buffer.write.mock.calls) {
          expect(range).toEqual({ startOffset: 300 * 96, endOffset: 301 * 96 });
        }
        expect(buffer.data[300 * 24]).toBeCloseTo(motion.current);
        await stopMotion();
        for (let i = 0; i < 4; i++) await step();
        expect(pending.size).toBe(0);
      } finally {
        await stopMotion();
        await unmount(instance);
        runtime.dispose();
        renderer.dispose();
      }
      expect(cleanup).toHaveBeenCalledOnce();
      expect(pending.size).toBe(0);
    }
  );

  it.each([60, 120, 144])('keeps demand rendering in step with external motion at %i Hz', async (hz) => {
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      pending.set(++id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => pending.delete(id)));
    const { renderer, submissions } = await setupRenderer('demand');
    function step(timestamp: number) {
      for (const [id, callback] of [...pending]) {
        if (!pending.delete(id)) continue;
        callback(timestamp);
      }
    }
    try {
      // Drain the bounded follow-up from coalesced initialization requests.
      step(-1000 / hz);
      step(0);
      expect(pending.size).toBe(0);
      submissions.length = 0;
      let active = true;
      function motion() {
        if (!active) return;
        // Svelte queues its next motion callback before reactive effects invalidate the renderer.
        requestAnimationFrame(motion);
        renderer.invalidate();
      }
      requestAnimationFrame(motion);
      for (let frame = 1; frame <= hz; frame++) step(frame * 1000 / hz);
      // Waking an idle renderer takes one frame; subsequent motion frames must not be skipped.
      expect(submissions).toHaveLength(hz - 1);
      active = false;
      step((hz + 1) * 1000 / hz);
      expect(pending.size).toBe(0);
    } finally {
      renderer.dispose();
    }
  });

  it('runs one demand clock while tasks request frames, stops when inactive, and cancels on disposal', async () => {
    const pending = new Map<number, FrameRequestCallback>();
    let id = 0;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => pending.delete(id)));
    const { renderer } = await setupRenderer('demand');
    let active = true;
    const frames: { delta: number; elapsed: number }[] = [];
    renderer.setFrameHandler!(frame => { frames.push(frame); renderer.invalidate(); return active; });
    function step(timestamp: number) {
      const [id, callback] = pending.entries().next().value!;
      pending.delete(id);
      callback(timestamp);
    }
    expect(pending.size).toBe(1);
    step(0);
    expect(pending.size).toBe(1);
    step(20);
    step(200);
    active = false;
    step(100);
    expect(pending.size).toBe(0);
    expect(frames.map(frame => frame.delta)).toEqual([0, 0.02, 0.05, 0]);
    expect(frames.at(-1)?.elapsed).toBeCloseTo(0.07);
    renderer.invalidate();
    expect(pending.size).toBe(1);
    renderer.dispose();
    expect(pending.size).toBe(0);
  });

  it('never schedules RAF in manual mode and stops drawing when a task disposes its root', async () => {
    const raf = vi.fn();
    vi.stubGlobal('requestAnimationFrame', raf);
    const { renderer, submissions } = await setupRenderer();
    renderer.setFrameHandler!(() => { renderer.dispose(); return true; });
    renderer.renderFrame(10);
    expect(raf).not.toHaveBeenCalled();
    expect(submissions).toHaveLength(0);
  });
  it('retains instance capacity on shrink and append, draws only active slots, and frees removed batches', async () => {
    const { renderer, root, buffers } = await setupRenderer();
    const tree = createElement('scene');
    const meshes = Array.from({ length: 5 }, (_, i) => {
      const mesh = createElement('mesh');
      setAttribute(mesh, 'position', [i, 0, 0]);
      insert(mesh, createElement('boxGeometry'), null);
      return mesh;
    });
    const cache = createTypeGpuSceneCache();
    meshes.slice(0, 3).forEach(mesh => insert(tree, mesh, null));
    renderer.setScene(createSceneState(tree, cache));
    const buffer = buffers.find(buffer => buffer.label.endsWith('instances'))!;
    root.createBuffer.mockClear();
    buffer.write.mockClear();
    insert(tree, meshes[3], null);
    renderer.setScene(createSceneState(tree, cache));
    expect(root.createBuffer).not.toHaveBeenCalled();
    expect(buffer.write).toHaveBeenCalledOnce();
    expect(buffer.write.mock.calls[0][1]).toEqual({ startOffset: 3 * 96, endOffset: 4 * 96 });
    buffer.write.mockClear();
    remove(meshes[3]);
    remove(meshes[2]);
    renderer.setScene(createSceneState(tree, cache));
    renderer.renderFrame(10);
    expect(buffer.write).not.toHaveBeenCalled();
    expect(captured.counts.at(-1)).toBe(2);
    insert(tree, meshes[1], meshes[0]);
    renderer.setScene(createSceneState(tree, cache));
    expect(Array.from(buffer.data.filter((_, index) => index % 24 === 0).slice(0, 2))).toEqual([1, 0]);
    meshes.slice(2).forEach(mesh => insert(tree, mesh, null));
    renderer.setScene(createSceneState(tree, cache));
    expect(root.createBuffer).toHaveBeenCalledOnce();
    expect(buffer.destroy).toHaveBeenCalledOnce();
    const grown = buffers.at(-1)!;
    meshes.forEach(remove);
    renderer.setScene(createSceneState(tree, cache));
    expect(grown.destroy).toHaveBeenCalledOnce();
    renderer.dispose();
  });
  it('updates independent shader uniforms in place, including equal initial values and vertex alpha', async () => {
    const { renderer, buffers, root, submissions } = await setupRenderer();
    const tree = createElement('scene');
    const fragment = tgpu.fragmentFn({ in: {
      color: d.vec4f, normal: d.vec3f, material: d.vec4f, world_position: d.vec3f,
      uv: d.vec2f, vertex_color: d.vec4f, material_extra: d.vec4f
    }, out: d.vec4f })(() => d.vec4f(1));
    const materials = [0, 1].map(() => {
      const mesh = createElement('mesh');
      const geometry = createElement('bufferGeometry');
      setAttribute(geometry, 'vertices', new Float32Array(Array.from({ length: 3 }, () =>
        [0, 0, 0, 0, 1, 0, 0, 0, 1, 1, 1, 0.5]).flat()));
      setAttribute(geometry, 'bounds', { min: [-1, -1, -1], max: [1, 1, 1] });
      const material = createElement('shaderMaterial');
      setAttribute(material, 'fragment', fragment);
      setAttribute(material, 'uniforms', { value0: [1, 0, 0, 1] });
      insert(mesh, geometry, null);
      insert(mesh, material, null);
      insert(tree, mesh, null);
      return material;
    });
    const cache = createTypeGpuSceneCache();
    const first = createSceneState(tree, cache);
    expect(first.drawBatches).toHaveLength(2);
    expect(first.drawBatches.every(batch => batch.material.kind === 'shader' && batch.material.fragment === fragment)).toBe(true);
    renderer.setScene(first);
    const uniformBuffers = buffers.filter(buffer => buffer.label.startsWith('TypeGPU material uniforms'));
    expect(uniformBuffers).toHaveLength(2);
    root.createBuffer.mockClear();
    root.createBindGroup.mockClear();
    vi.mocked(createMeshPipeline).mockClear();
    uniformBuffers.forEach(buffer => buffer.write.mockClear());
    setAttribute(materials[0], 'uniforms', { value0: [0, 1, 0, 1] });
    const next = createSceneState(tree, cache, {
      dirty: Dirty.MaterialUniform, dirtyNodes: new Map([[materials[0], Dirty.MaterialUniform]])
    });
    expect(next.drawBatchesChanged).toBe(false);
    expect(next.instanceUpdates).toEqual([]);
    renderer.setScene(next);
    renderer.renderFrame(10);
    expect(submissions.at(-1)?.map(data => Array.from(data.slice(0, 4))).sort()).toEqual(
      [[0, 1, 0, 1], [1, 0, 0, 1]].sort());
    expect(uniformBuffers.reduce((count, buffer) => count + buffer.write.mock.calls.length, 0)).toBe(1);
    expect(root.createBuffer).not.toHaveBeenCalled();
    expect(root.createBindGroup).not.toHaveBeenCalled();
    expect(createMeshPipeline).not.toHaveBeenCalled();
    const cameraOnly = createSceneState(tree, cache, { dirty: Dirty.Camera });
    renderer.setScene(cameraOnly);
    renderer.renderFrame(20);
    expect(submissions.at(-1)?.map(data => Array.from(data.slice(0, 4))).sort()).toEqual(
      [[0, 1, 0, 1], [1, 0, 0, 1]].sort());
    renderer.dispose();
    expect(uniformBuffers.every(buffer => buffer.destroy.mock.calls.length === 1)).toBe(true);
  });
  it('uploads only changed instance bytes without resource lookups, allocation, or queue sorting', async () => {
    const { renderer, buffers, root } = await setupRenderer();
    const tree = createElement('scene');
    const meshes = Array.from({ length: 100 }, () => {
      const mesh = createElement('mesh');
      insert(mesh, createElement('boxGeometry'), null);
      insert(tree, mesh, null);
      return mesh;
    });
    const cache = createTypeGpuSceneCache();
    renderer.setScene(createSceneState(tree, cache));
    const instanceBuffer = buffers.find((buffer) => buffer.label.endsWith('instances'))!;
    instanceBuffer.write.mockClear();
    root.createBuffer.mockClear();
    const geometry = vi.spyOn(GeometryResourceCache.prototype, 'getOrCreate');
    const material = vi.spyOn(MaterialResourceCache.prototype, 'getOrCreate');
    const prune = vi.spyOn(GeometryResourceCache.prototype, 'prune');
    vi.mocked(createMeshPipeline).mockClear();
    setAttribute(meshes[20], 'position', [4, 0, 0]);
    const state = createSceneState(tree, cache, {
      dirty: Dirty.Transform,
      dirtyNodes: new Map([[meshes[20], Dirty.Transform]])
    });
    const sort = vi.spyOn(Array.prototype, 'sort');
    renderer.setScene(state);
    expect(instanceBuffer.write).toHaveBeenCalledOnce();
    expect(instanceBuffer.write.mock.calls[0][0].byteLength).toBe(96);
    expect(instanceBuffer.write.mock.calls[0][1]).toEqual({
      startOffset: 20 * 96,
      endOffset: 21 * 96
    });
    expect(root.createBuffer).not.toHaveBeenCalled();
    expect(geometry).not.toHaveBeenCalled();
    expect(material).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
    expect(createMeshPipeline).not.toHaveBeenCalled();
    expect(sort).not.toHaveBeenCalled();
    renderer.dispose();
  });
  it('retains hidden geometry/material/instance buffers and frees them on removal', async () => {
    const { renderer, buffers } = await setupRenderer();
    const tree = createFragment();
    const group = createElement('group');
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null);
    insert(group, mesh, null);
    insert(tree, group, null);
    const cache = createTypeGpuSceneCache();
    renderer.setScene(createSceneState(tree, cache));
    const owned = buffers.filter((buffer) =>
      /vertices|indices|instances|material/.test(buffer.label)
    );
    expect(owned.length).toBeGreaterThanOrEqual(3);
    const count = buffers.length;
    setAttribute(group, 'visible', false);
    renderer.setScene(createSceneState(tree, cache));
    expect(owned.every((buffer) => buffer.destroy.mock.calls.length === 0)).toBe(true);
    setAttribute(group, 'visible', true);
    renderer.setScene(createSceneState(tree, cache));
    expect(buffers.length).toBe(count);
    remove(group);
    renderer.setScene(createSceneState(tree, cache));
    expect(owned.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    renderer.dispose();
  });
  it('does not scan geometry resources on a camera-only scene update', async () => {
    const { renderer } = await setupRenderer();
    const tree = createFragment();
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null);
    insert(tree, mesh, null);
    const cache = createTypeGpuSceneCache();
    renderer.setScene(createSceneState(tree, cache));
    const lookup = vi.spyOn(GeometryResourceCache.prototype, 'getOrCreate');
    const prune = vi.spyOn(GeometryResourceCache.prototype, 'prune');

    renderer.setScene(createSceneState(tree, cache, { dirty: Dirty.Camera }));

    expect(lookup).not.toHaveBeenCalled();
    expect(prune).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('does not sort an unchanged render queue on every frame', async () => {
    const { renderer } = await setupRenderer();
    renderer.setScene(createSceneState(createFragment()));
    const sort = vi.spyOn(Array.prototype, 'sort');

    renderer.renderFrame(10);
    renderer.renderFrame(20);

    expect(sort).not.toHaveBeenCalled();
    renderer.dispose();
  });

  it('refreshes depth-dependent pipelines even when draw batches are reused', async () => {
    const { renderer } = await setupRenderer();
    const tree = createElement('scene');
    const mesh = createElement('mesh');
    insert(mesh, createElement('boxGeometry'), null);
    insert(tree, mesh, null);
    const cache = createTypeGpuSceneCache();
    renderer.setScene(createSceneState(tree, cache));
    setAttribute(tree, 'depth', false);

    renderer.setScene(createSceneState(tree, cache, { dirty: Dirty.RenderSettings }));
    renderer.renderFrame(10);

    expect(vi.mocked(createMeshPipeline).mock.lastCall?.[2]?.depth).toBe(false);
    renderer.dispose();
  });

  it('keeps each shader pass uniform values distinct at GPU submission and frees removed buffers', async () => {
    const { renderer, buffers, submissions } = await setupRenderer();
    const tree = createFragment();
    const fragment = tgpu.fragmentFn({ in: { uv: d.vec2f }, out: d.vec4f })(() => d.vec4f(1));
    for (const color of [
      [1, 0, 0, 1],
      [0, 0, 1, 1]
    ]) {
      const pass = createElement('shaderPass');
      setAttribute(pass, 'fragment', fragment);
      setAttribute(pass, 'uniforms', { value0: color });
      insert(tree, pass, null);
    }
    renderer.setScene(createSceneState(tree));
    renderer.renderFrame(10);

    expect(submissions.at(-1)?.map((data) => Array.from(data.slice(4, 8)))).toEqual([
      [1, 0, 0, 1],
      [0, 0, 1, 1]
    ]);
    setAttribute(tree.firstChild!, 'uniforms', { value0: [0, 1, 0, 1] });
    setAttribute(tree.firstChild!, 'renderOrder', 1);
    renderer.setScene(createSceneState(tree));
    renderer.renderFrame(20);
    expect(submissions.at(-1)?.map((data) => Array.from(data.slice(4, 8)))).toEqual([
      [0, 0, 1, 1],
      [0, 1, 0, 1]
    ]);
    const passBuffers = buffers.filter((buffer) => buffer.label.includes('shader pass'));
    expect(passBuffers).toHaveLength(2);
    renderer.setScene(createSceneState(createFragment()));
    expect(passBuffers.every((buffer) => buffer.destroy.mock.calls.length === 1)).toBe(true);
    renderer.dispose();
  });

  it('destroys owned material uniform buffers when pruned or disposed', () => {
    const { root, buffers } = fakeRoot();
    const textures = new TextureResourceCache(root as never, () => {});
    const samplers = new SamplerResourceCache(root as never);
    const materials = new MaterialResourceCache(root as never, textures, samplers);
    materials.getOrCreate(createMaterialDescriptor('standard', {}));
    const first = buffers.at(-1)!;
    materials.prune(new Set());
    expect(first.destroy).toHaveBeenCalledOnce();
    materials.getOrCreate(createMaterialDescriptor('standard', {}));
    const second = buffers.at(-1)!;
    materials.dispose();
    expect(second.destroy).toHaveBeenCalledOnce();
    textures.dispose();
  });
});

async function setupRenderer(frameloop: 'manual' | 'demand' | 'always' = 'manual') {
  const fake = fakeRoot();
  vi.mocked(tgpu.init).mockResolvedValue(fake.root as never);
  vi.stubGlobal('navigator', { gpu: { getPreferredCanvasFormat: () => 'bgra8unorm' } });
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const renderer = await createTypeGpuRenderer({
    canvas: { clientWidth: 100, clientHeight: 100, width: 100, height: 100 } as HTMLCanvasElement,
    frameloop
  });
  return { ...fake, renderer };
}

function fakeBuffer() {
  return {
    label: '',
    buffer: {},
    data: new Float32Array(),
    $usage() {
      return this;
    },
    $name(label: string) {
      this.label = label;
      return this;
    },
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
      }
      else this.data = new Float32Array(data.slice(0));
    }),
    destroy: vi.fn()
  };
}

function fakeRoot() {
  const buffers: ReturnType<typeof fakeBuffer>[] = [];
  const submissions: Float32Array[][] = [];
  const root = {
    createBuffer: vi.fn(() => {
      const buffer = fakeBuffer();
      buffers.push(buffer);
      return buffer;
    }),
    createTexture: vi.fn(() => ({
      $usage() {
        return this;
      },
      $name() {
        return this;
      },
      write: vi.fn(),
      destroy: vi.fn(),
      createView: () => ({})
    })),
    createBindGroup: vi.fn((_layout: unknown, entries: unknown) => ({ entries })),
    createSampler: vi.fn(() => ({})),
    createComparisonSampler: vi.fn(() => ({})),
    configureContext: vi.fn(() => ({ getCurrentTexture: () => ({ createView: () => ({}) }) })),
    unwrap: (resource: unknown) => resource,
    pipe() {
      return this;
    },
    destroy: vi.fn(),
    device: {
      createCommandEncoder: () => ({ beginRenderPass: () => ({ end() {} }), finish: () => ({}) }),
      queue: {
        submit: () => {
          // Uniform writes take effect before submission, not separately for each draw call.
          submissions.push(
            captured.bindings.splice(0).map((bindings) => {
              const group = bindings.find((value: any) => value?.entries?.uniforms) as {
                entries: { uniforms: ReturnType<typeof fakeBuffer> };
              };
              return group?.entries.uniforms.data.slice() ?? new Float32Array();
            })
          );
        }
      }
    }
  };
  return { root, buffers, submissions };
}
