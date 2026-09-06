// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import * as svelteClient from 'svelte/internal/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragment, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';
import { createTypeGpuRuntimeForTest } from './svelte-renderer';
import { Tween } from 'svelte/motion';
import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuFrameContext } from './frame-tasks';
import { compileTypeGpuSource } from './component-test-utils';

const instances: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  await Promise.all(instances.splice(0).map((instance) => unmount(instance)));
});

describe('TypeGPU target primitive component rendering', () => {
  it('flushes frame-task state into the same frame, supports pause and keyed removal, and disposes hooks', async () => {
    const Scene = compileTypeGpuSource<{ pause(): void; resume(): void; removeTask(): void }>(`
      <script>
        let x = $state(0);
        let active = $state(true);
        let attached = $state(true);
        function update({ delta }) { x += delta; }
        export function pause() { active = false; }
        export function resume() { active = true; }
        export function removeTask() { attached = false; }
      </script>
      <scene>
        {#if attached}<frameTask {update} {active} />{/if}
        <mesh position={[x, 0, 0]}><boxGeometry /></mesh>
      </scene>
    `);
    const root = createFragment();
    let frameHandler: ((frame: TypeGpuFrameContext) => boolean) | null = null;
    const gpu = { setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(), renderFrame: vi.fn(),
      setFrameHandler: vi.fn(handler => { frameHandler = handler; }), getRenderSize: vi.fn(), dispose: vi.fn()
    } as TypeGpuRenderer;
    const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
    root.runtime = runtime;
    const instance = mount(Scene, { renderer, target: root });
    const step = () => frameHandler!({ timestamp: 20, delta: 0.02, elapsed: 0.02 });
    try {
      expect(step()).toBe(true);
      expect(vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances[0]).toBeCloseTo(0.02);
      instance.pause();
      expect(step()).toBe(false);
      expect(vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances[0]).toBeCloseTo(0.02);
      instance.resume();
      expect(step()).toBe(true);
      expect(vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances[0]).toBeCloseTo(0.04);
      instance.removeTask();
      expect(step()).toBe(false);
      vi.mocked(gpu.setScene).mockClear();
      await Promise.resolve();
      expect(gpu.setScene).not.toHaveBeenCalled();
    } finally {
      await unmount(instance);
      runtime.dispose();
    }
    expect(frameHandler).toBeNull();
  });
  it('translates real Svelte Tween frames into targeted group instance updates', async () => {
    const raf = (svelteClient as unknown as { raf: { now(): number; tick(callback: () => void): void } }).raf;
    let now = 0;
    const frames: (() => void)[] = [];
    const nowSpy = vi.spyOn(raf, 'now').mockImplementation(() => now);
    const tickSpy = vi.spyOn(raf, 'tick').mockImplementation((callback) => { frames.push(callback); });
    const motion = new Tween([0, 0, 0], { duration: 100 });
    const Scene = compileTypeGpuSource(`
      <script>let { motion } = $props();</script>
      <scene>
        {#each Array.from({length: 300}, (_, i) => i) as i (i)}
          <mesh position={[i, 0, -5]}><boxGeometry /></mesh>
        {/each}
        <group position={motion.current}>
          <mesh><boxGeometry /></mesh>
          <mesh position={[1, 0, 0]}>
            <boxGeometry />
            <standardMaterial color={[motion.current[0] / 4, 0, 0, 1]} />
          </mesh>
        </group>
      </scene>
    `);
    const root = createFragment();
    const gpu = { setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(), renderFrame: vi.fn(), getRenderSize: vi.fn(), dispose: vi.fn() } as TypeGpuRenderer;
    const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
    root.runtime = runtime;
    const instance = mount(Scene, { renderer, target: root, props: { motion } });
    try {
      flushSync();
      await Promise.resolve();
      const initial = vi.mocked(gpu.setScene).mock.lastCall![0];
      const instances = initial.drawBatches[0].instances;
      vi.mocked(gpu.setScene).mockClear();
      void motion.set([4, 0, 0]);
      for (const time of [25, 50, 101]) {
        now = time;
        frames.splice(0).forEach((callback) => callback());
        flushSync();
        await Promise.resolve();
        const state = vi.mocked(gpu.setScene).mock.lastCall![0];
        expect(state.drawBatchesChanged).toBe(false);
        expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 300, count: 2 }]);
        expect(state.drawBatches[0].instances).toBe(instances);
        expect(instances[300 * 24]).toBeCloseTo(Math.min(time / 100, 1) * 4);
        expect(instances[301 * 24 + 4]).toBeCloseTo(Math.min(time / 100, 1));
      }
      expect(gpu.setScene).toHaveBeenCalledTimes(3);
    } finally {
      await motion.set(motion.current, { duration: 0 });
      await unmount(instance);
      runtime.dispose();
      nowSpy.mockRestore();
      tickSpy.mockRestore();
    }
  });
  it('preserves keyed snippet nodes across reactive updates and removes them on unmount', async () => {
    const Scene = compileTypeGpuSource<{ update(): void }>(`
      <script>
        let items = $state([1, 2]);
        let x = $state(0);
        export function update() { items.reverse(); x = 3; }
      </script>
      {#snippet box(id)}
        <mesh position={[x, id, 0]}><boxGeometry /></mesh>
      {/snippet}
      <scene>{#each items as id (id)}{@render box(id)}{/each}</scene>
    `);
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root });
    const scene = onlyElement(root);
    const meshes = scene.children.filter((node) => node.name === 'mesh');

    flushSync(() => instance.update());

    expect(scene.children.filter((node) => node.name === 'mesh')).toEqual([meshes[1], meshes[0]]);
    expect(meshes[0].attributes.position).toEqual([3, 1, 0]);
    await unmount(instance);
    expect(root.children).toEqual([]);
  });

  it('renders guide-level scene primitives into normalized host nodes', () => {
    const onClick = vi.fn();
    const Scene = compileTypeGpuSource(`
      <script>
        let { onClick } = $props();
      </script>

      <scene clearColor={[0, 0, 0, 1]}>
        <perspectiveCamera id="main" active={true} position={[0, 0, 10]} target={[0, 0, 0]} />
        <orbitControls camera="main" target={[0, 0, 0]} minDistance={2} maxDistance={40} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[1, 2, 3]} />
        <mesh position={[1, 2, 3]} onclick={onClick}>
          <boxGeometry width={1} height={2} depth={3} />
          <phongMaterial
            map="/textures/checker.svg"
            sampler={{ addressModeU: 'repeat', addressModeV: 'repeat' }}
            color={[1, 0.8, 0.4, 1]}
          />
        </mesh>
      </scene>
    `);
    const root = createFragment();

    instances.push(mount(Scene, { renderer, target: root, props: { onClick } }));

    const scene = onlyElement(root);
    const camera = onlyNamed(scene, 'perspectiveCamera');
    const orbitControls = onlyNamed(scene, 'orbitControls');
    const mesh = onlyNamed(scene, 'mesh');
    const boxGeometry = onlyNamed(mesh, 'boxGeometry');
    const material = onlyNamed(mesh, 'phongMaterial');

    expect(scene.attributes.clearColor).toEqual([0, 0, 0, 1]);
    expect(camera.attributes).toMatchObject({
      id: 'main',
      active: true,
      position: [0, 0, 10],
      target: [0, 0, 0]
    });
    expect(orbitControls.attributes).toMatchObject({
      camera: 'main',
      minDistance: 2,
      maxDistance: 40
    });
    expect(boxGeometry.attributes).toMatchObject({
      width: 1,
      height: 2,
      depth: 3
    });
    expect(material.attributes).toMatchObject({
      map: '/textures/checker.svg',
      sampler: { addressModeU: 'repeat', addressModeV: 'repeat' },
      color: [1, 0.8, 0.4, 1]
    });
    expect(mesh.attributes).toMatchObject({
      position: [1, 2, 3]
    });
    expect(mesh.listeners.get('click')?.size).toBe(1);
  });

  it('renders each-loop component meshes as ordinary batchable mesh nodes', () => {
    const Scene = compileTypeGpuSource(`
      <script>
        const cubes = [
          { id: 'a', position: [0, 0, 0], color: [1, 0, 0, 1] },
          { id: 'b', position: [1, 0, 0], color: [0, 1, 0, 1] },
          { id: 'c', position: [2, 0, 0], color: [0, 0, 1, 1] }
        ];
      </script>

      {#snippet Cube(cube)}
        <mesh position={cube.position}>
          <boxGeometry width={1} height={1} depth={1}></boxGeometry>
          <standardMaterial color={cube.color}></standardMaterial>
        </mesh>
      {/snippet}

      <scene>
        {#each cubes as cube (cube.id)}
          {@render Cube(cube)}
        {/each}
      </scene>
    `);
    const root = createFragment();

    instances.push(mount(Scene, { renderer, target: root }));

    const scene = onlyElement(root);
    const meshes = scene.children.filter((node) => node.name === 'mesh');

    expect(meshes).toHaveLength(3);
    for (const mesh of meshes) {
      expect(mesh.children.map((child) => child.name)).toEqual(['boxGeometry', 'standardMaterial']);
    }
  });

  it('renders public model nodes with url, data, and material children', () => {
    const ModelScene = compileTypeGpuSource(`
      <script>
        const data = new ArrayBuffer(8);
      </script>

      <scene>
        <model src="/models/chair.glb" position={[1, 2, 3]} rotation={[0.1, 0.2, 0.3]} scale={2}>
          <standardMaterial color={[1, 0.2, 0.1, 1]} roughness={0.8}></standardMaterial>
        </model>
        <model data={data} position={[4, 5, 6]}></model>
      </scene>
    `);
    const root = createFragment();

    instances.push(mount(ModelScene, { renderer, target: root }));

    const scene = onlyElement(root);
    const models = scene.children.filter((node) => node.kind === 'element');
    const [srcModel, dataModel] = models;

    expect(scene.name).toBe('scene');
    expect(models).toHaveLength(2);
    expect(srcModel.name).toBe('model');
    expect(srcModel.attributes).toMatchObject({
      src: '/models/chair.glb',
      position: [1, 2, 3],
      rotation: [0.1, 0.2, 0.3],
      scale: 2
    });
    expect(srcModel.children[0]).toMatchObject({
      name: 'standardMaterial',
      attributes: {
        color: [1, 0.2, 0.1, 1],
        roughness: 0.8
      }
    });
    expect(dataModel.name).toBe('model');
    expect(dataModel.attributes).toMatchObject({
      position: [4, 5, 6]
    });
    expect(dataModel.attributes.data).toBeInstanceOf(ArrayBuffer);
  });
});

function onlyElement(root: TypeGpuNode): TypeGpuNode {
  const elements = root.children.filter((node) => node.kind === 'element');

  expect(elements).toHaveLength(1);

  return elements[0];
}

function onlyNamed(root: TypeGpuNode, name: string): TypeGpuNode {
  const match = findChild(root, name);

  expect(match).toBeTruthy();

  return match!;
}

function findChild(root: TypeGpuNode, name: string): TypeGpuNode | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const match = findChild(child, name);
    if (match) return match;
  }
  return null;
}
