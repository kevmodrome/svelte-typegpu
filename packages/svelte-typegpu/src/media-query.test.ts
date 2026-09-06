// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { MediaQuery } from 'svelte/reactivity';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragment, walk, type TypeGpuNode } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';

function query(initial: boolean) {
  let matches = initial;
  const target = Object.assign(new EventTarget(), { media: '(min-width: 800px)' });
  Object.defineProperty(target, 'matches', { get: () => matches });
  return {
    target: target as MediaQueryList,
    add: vi.spyOn(target, 'addEventListener'),
    remove: vi.spyOn(target, 'removeEventListener'),
    change(value: boolean) { matches = value; target.dispatchEvent(new Event('change')); }
  };
}

afterEach(() => vi.restoreAllMocks());

describe('scene media-query consumers', () => {
  it.each([false, true])('shares native subscriptions across snippets and keyed consumers (component: %s)', async component => {
    const first = query(false), second = query(true);
    vi.spyOn(window, 'matchMedia').mockReturnValueOnce(first.target).mockReturnValueOnce(second.target);
    const initial = new MediaQuery('(min-width: 800px)');
    const next = new MediaQuery('(min-width: 800px)');
    expect(initial.current).toBe(false);
    expect(first.add).not.toHaveBeenCalled();
    const mesh = `<mesh name={id} position={[id * 2, 0, 0]} scale={query.current ? 2 : 1} {@attach setup}>
      <boxGeometry /><standardMaterial />
    </mesh>`;
    const Child = compileViewportSource(`<script>let { id, query, setup } = $props();</script>${mesh}`);
    const Scene = compileViewportSource<{ replace(query: MediaQuery): void; show(index: number, visible: boolean): void }>(`<script>
      let { initial, Child, setup } = $props();
      let query = $state.raw(initial), visible = $state([true, true]);
      export function replace(next) { query = next; }
      export function show(index, value) { visible[index] = value; }
    </script>
    {#snippet object(id)}${component ? '<Child {id} {query} {setup} />' : mesh}{/snippet}
    <scene>
      {#each [0, 1] as id (id)}{#if visible[id]}{@render object(id)}{/if}{/each}
      <mesh name="static" position={[10, 0, 0]}><boxGeometry /><standardMaterial /></mesh>
    </scene>`);
    const root = createFragment();
    const gpu = {
      setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(),
      renderFrame: vi.fn(), setFrameHandler: vi.fn(), getRenderSize: vi.fn(), dispose: vi.fn()
    } as TypeGpuRenderer;
    const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
    root.runtime = runtime;
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const instance = mount(Scene, { renderer, target: root, props: { initial, Child, setup } });
    const changed = vi.mocked(gpu.setScene);
    const meshes = () => {
      const nodes: TypeGpuNode[] = [];
      walk(root, node => { if (node.name === 'mesh') nodes.push(node); });
      return nodes;
    };
    try {
      await settleComponentUpdates();
      expect(first.add).toHaveBeenCalledOnce();
      const original = meshes();
      const storage = changed.mock.lastCall![0].drawBatches[0].instances;
      changed.mockClear();
      first.change(false); await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();
      first.change(true); await settleComponentUpdates();
      expect(changed).toHaveBeenCalledOnce();
      const state = changed.mock.lastCall![0];
      expect(state.drawBatchesChanged).toBe(false);
      expect(state.drawBatches[0].instances).toBe(storage);
      expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 2 }]);
      expect(meshes()).toEqual(original);
      expect(original.slice(0, 2).map(node => node.attributes.scale)).toEqual([2, 2]);
      expect(setup).toHaveBeenCalledTimes(2);
      expect(cleanup).not.toHaveBeenCalled();
      expect(first.add).toHaveBeenCalledOnce();
      expect(first.remove).not.toHaveBeenCalled();

      flushSync(() => instance.replace(next)); await settleComponentUpdates();
      expect(first.remove).toHaveBeenCalledOnce();
      expect(second.add).toHaveBeenCalledOnce();
      changed.mockClear();
      first.change(false); await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();
      flushSync(() => instance.show(0, false)); await settleComponentUpdates();
      expect(second.remove).not.toHaveBeenCalled();
      expect(cleanup).toHaveBeenCalledOnce();
      flushSync(() => instance.show(1, false)); await settleComponentUpdates();
      expect(second.remove).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledTimes(2);
      changed.mockClear();
      second.change(false); await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();
      flushSync(() => { instance.show(0, true); instance.show(1, true); });
      await settleComponentUpdates();
      expect(second.add).toHaveBeenCalledTimes(2);
      expect(meshes().slice(0, 2).map(node => node.attributes.scale)).toEqual([1, 1]);
      expect(meshes()[2]).toBe(original[2]);
    } finally { await unmount(instance); runtime.dispose(); }
    await settleComponentUpdates();
    expect(second.remove).toHaveBeenCalledTimes(2);
    expect(cleanup).toHaveBeenCalledTimes(4);
    changed.mockClear();
    second.change(true); await settleComponentUpdates();
    expect(changed).not.toHaveBeenCalled();
  });
});
