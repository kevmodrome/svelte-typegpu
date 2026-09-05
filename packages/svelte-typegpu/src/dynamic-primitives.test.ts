import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { compileTypeGpuSource } from './component-test-utils';
import { createFragment, dispatchNodeEvent, type TypeGpuNode } from './core';
import { createSceneState } from './scene-state';
import renderer from './svelte-renderer';

describe('dynamic scene primitives', () => {
  it('replaces geometry without remounting its mesh or material, preserving attribute casing', async () => {
    const Scene = compileTypeGpuSource<{ shape(name: string | null): void; resize(): void }>(`
      <script>
        let { setup } = $props();
        let geometry = $state('boxGeometry');
        let width = $state(2);
        export function shape(name) { geometry = name; }
        export function resize() { width = 3; }
      </script>
      <scene><mesh>
        <svelte:element this={geometry} {width} radius={2} widthSegments={12} {@attach setup} />
        <standardMaterial color={[1, 0, 0, 1]} />
      </mesh></scene>
    `);
    const nodes: TypeGpuNode[] = [];
    const cleanup = vi.fn();
    const setup = vi.fn((node: TypeGpuNode) => {
      nodes.push(node);
      return () => cleanup(node);
    });
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { setup } });
    try {
      flushSync();
      const mesh = nodes[0].parent!;
      const material = mesh.children.find((node) => node.name === 'standardMaterial');
      expect(createSceneState(root).drawBatches[0].geometry.key).toBe('box:2:1:1');
      flushSync(() => instance.resize());
      expect(setup).toHaveBeenCalledOnce();
      expect(nodes[0].attributes.width).toBe(3);
      expect(createSceneState(root).drawBatches[0].geometry.key).toBe('box:3:1:1');
      flushSync(() => instance.shape('sphereGeometry'));
      expect(nodes[1].parent).toBe(mesh);
      expect(nodes[0].parent).toBeNull();
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(nodes[0]);
      expect(mesh.children.find((node) => node.name === 'standardMaterial')).toBe(material);
      expect(nodes[1].attributes.widthSegments).toBe(12);
      expect(createSceneState(root).drawBatches[0].geometry.key).toBe('sphere:2:12:8');
      flushSync(() => instance.shape(null));
      expect(createSceneState(root).drawBatches).toEqual([]);
      expect(cleanup).toHaveBeenCalledTimes(2);
      flushSync(() => instance.shape('boxGeometry'));
      expect(nodes[2].parent).toBe(mesh);
      expect(createSceneState(root).drawBatches[0].geometry.key).toBe('box:3:1:1');
    } finally {
      await unmount(instance);
    }
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it('forwards dynamic material props and keeps keyed component nodes on reorder', async () => {
    const Material = compileTypeGpuSource(`
      <script>let { kind, ...props } = $props();</script>
      <svelte:element this={kind} {...props} />
    `);
    const Scene = compileTypeGpuSource<{ reverse(): void; unlit(): void }>(`
      <script>
        let { Material } = $props();
        let items = $state([1, 2]);
        let kind = $state('standardMaterial');
        export function reverse() { items.reverse(); }
        export function unlit() { kind = 'basicMaterial'; }
      </script>
      <scene>{#each items as item (item)}
        <mesh position={[item, 0, 0]}>
          <boxGeometry /><Material {kind} color={[1, 0, 0, 1]} cullMode="none" />
        </mesh>
      {/each}</scene>
    `);
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { Material } });
    try {
      flushSync();
      const scene = root.children.find((node) => node.name === 'scene')!;
      const meshes = scene.children.filter((node) => node.name === 'mesh');
      const materials = meshes.map(
        (mesh) => mesh.children.find((node) => node.name === 'standardMaterial')!
      );
      flushSync(() => instance.reverse());
      expect(scene.children.filter((node) => node.name === 'mesh')).toEqual([...meshes].reverse());
      expect(
        meshes.map((mesh) => mesh.children.find((node) => node.name === 'standardMaterial'))
      ).toEqual(materials);
      flushSync(() => instance.unlit());
      for (const [index, mesh] of meshes.entries()) {
        expect(materials[index].parent).toBeNull();
        expect(
          mesh.children.find((node) => node.name === 'basicMaterial')!.attributes.cullMode
        ).toBe('none');
      }
      expect(createSceneState(root).drawBatches[0].material.kind).toBe('basic');
    } finally {
      await unmount(instance);
    }
  });

  it('updates event props on a dynamic node and removes the subtree when its tag is null', async () => {
    const Scene = compileTypeGpuSource<{ replace(): void; hide(): void }>(`
      <script>
        let { first, second } = $props();
        let tag = $state('mesh');
        let onclick = $state(first);
        export function replace() { onclick = second; }
        export function hide() { tag = null; }
      </script>
      <scene><svelte:element this={tag} {onclick}><boxGeometry /></svelte:element></scene>
    `);
    const root = createFragment();
    const first = vi.fn();
    const second = vi.fn();
    const instance = mount(Scene, { renderer, target: root, props: { first, second } });
    try {
      flushSync();
      const mesh = createSceneState(root).interaction.targets[0].node;
      dispatchNodeEvent(mesh, 'click');
      flushSync(() => instance.replace());
      expect(createSceneState(root).interaction.targets[0].node).toBe(mesh);
      dispatchNodeEvent(mesh, 'click');
      expect(first).toHaveBeenCalledOnce();
      expect(second).toHaveBeenCalledOnce();
      flushSync(() => instance.hide());
      expect(createSceneState(root).interaction.targets).toEqual([]);
      expect(mesh.parent).toBeNull();
    } finally {
      await unmount(instance);
    }
  });
});
