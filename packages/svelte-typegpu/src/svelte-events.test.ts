import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { compileTypeGpuSource } from './component-test-utils';
import { createFragment, dispatchNodeEvent } from './core';
import type { TypeGpuRenderer } from './gpu-renderer';
import { createSceneState } from './scene-state';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';

describe('Svelte event attributes', () => {
  it('updates only the hovered material through ordinary pointer event attributes', async () => {
    const Scene = compileTypeGpuSource(`
      <script>let hovered = $state(false);</script>
      <scene>
        {#each [1, 2, 3] as id (id)}<mesh><boxGeometry /><standardMaterial /></mesh>{/each}
        <group onpointerenter={() => hovered = true} onpointerleave={() => hovered = false}>
          <mesh><boxGeometry /><standardMaterial color={hovered ? [1, 0, 0, 1] : [0, 0, 1, 1]} /></mesh>
        </group>
      </scene>
    `);
    const root = createFragment();
    const gpu = {
      setOptions: vi.fn(),
      setScene: vi.fn(),
      setCamera: vi.fn(),
      invalidate: vi.fn(),
      renderFrame: vi.fn(),
      getRenderSize: vi.fn(),
      dispose: vi.fn()
    } as TypeGpuRenderer;
    const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
    root.runtime = runtime;
    const instance = mount(Scene, { renderer, target: root });
    try {
      flushSync();
      await Promise.resolve();
      const initial = vi.mocked(gpu.setScene).mock.lastCall![0];
      expect(initial.interaction.targets).toHaveLength(1);
      const group = initial.interaction.targets[0].node.parent!;
      const instances = initial.drawBatches[0].instances;
      for (const type of ['pointerenter', 'pointerleave']) {
        flushSync(() => dispatchNodeEvent(group, type));
        await Promise.resolve();
        const state = vi.mocked(gpu.setScene).mock.lastCall![0];
        expect(state.interaction).toBe(initial.interaction);
        expect(state.drawBatchesChanged).toBe(false);
        expect(state.drawBatches[0].instances).toBe(instances);
        expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 3, count: 1 }]);
        expect(instances[3 * 24 + 4]).toBe(type === 'pointerenter' ? 1 : 0);
      }
    } finally {
      await unmount(instance);
      runtime.dispose();
    }
    expect(createSceneState(root).interaction.targets).toEqual([]);
  });

  it('forwards event props through components, updates callbacks, and preserves keyed nodes', async () => {
    const Boxes = compileTypeGpuSource(`
      <script>let { items, ...events } = $props();</script>
      <group {...events}>{#each items as item (item)}<mesh position={[item, 0, 0]}><boxGeometry /></mesh>{/each}</group>
    `);
    const Scene = compileTypeGpuSource<{ replace(): void; reverse(): void; hide(): void }>(`
      <script>
        let { Boxes, first, second } = $props();
        let onclick = $state(first);
        let items = $state([1, 2]);
        let visible = $state(true);
        export function replace() { onclick = second; }
        export function reverse() { items.reverse(); }
        export function hide() { visible = false; }
      </script>
      <scene>{#if visible}<Boxes {items} {onclick} />{/if}</scene>
    `);
    const root = createFragment();
    const first = vi.fn();
    const second = vi.fn();
    const instance = mount(Scene, { renderer, target: root, props: { Boxes, first, second } });
    try {
      flushSync();
      const scene = root.children.find((node) => node.name === 'scene')!;
      const group = scene.children.find((node) => node.name === 'group')!;
      const meshes = group.children.filter((node) => node.name === 'mesh');
      dispatchNodeEvent(meshes[0], 'click');
      expect(first).toHaveBeenCalledOnce();
      flushSync(() => {
        instance.replace();
        instance.reverse();
      });
      expect(group.children.filter((node) => node.name === 'mesh')).toEqual([...meshes].reverse());
      dispatchNodeEvent(meshes[0], 'click');
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      expect(second.mock.calls[0][0].target).toBe(meshes[0]);
      expect(createSceneState(root).interaction.targets).toHaveLength(2);
      flushSync(() => instance.hide());
      // Like DOM nodes, detached nodes can retain listeners but cannot be picked.
      expect(group.parent).toBeNull();
      expect(createSceneState(root).interaction.targets).toEqual([]);
    } finally {
      await unmount(instance);
    }
  });
});
