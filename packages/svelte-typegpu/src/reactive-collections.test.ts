// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import { describe, expect, it, vi } from 'vitest';
import { compileViewportSource } from './viewport-test-utils';
import { createFragment, dispatchNodeEvent, walk, type TypeGpuNode } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import { settleComponentUpdates } from './component-test-utils';

type Item = { position: number[]; color: number[] };
const item = (x: number): Item => ({ position: [x, 0, 0], color: [0.2, 0.7, 0.5] });
function mountScene<Exports extends Record<string, unknown>>(source: string, props = {}) {
  const root = createFragment();
  const gpu = {
    setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(),
    renderFrame: vi.fn(), setFrameHandler: vi.fn(), getRenderSize: vi.fn(), dispose: vi.fn()
  } as TypeGpuRenderer;
  const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
  root.runtime = runtime;
  const instance = mount(compileViewportSource<Exports>(source), { renderer, target: root, props });
  return { instance, gpu,
    meshes() {
      const nodes: TypeGpuNode[] = [];
      walk(root, node => { if (node.name === 'mesh') nodes.push(node); });
      return nodes;
    },
    async dispose() { await unmount(instance); runtime.dispose(); }
  };
}

const mesh = `<mesh name={id} position={object.position} {@attach setup}
  onclick={() => selection.has(id) ? selection.delete(id) : selection.add(id)}>
  <boxGeometry /><standardMaterial color={selection.has(id) ? [1, 0.8, 0.2] : object.color} />
</mesh>`;

describe('reactive scene collections', () => {
  it('uses the browser reactive collections, not the plain server exports', () => {
    expect(SvelteMap).not.toBe(Map);
    expect(SvelteSet).not.toBe(Set);
  });

  it.each([false, true])('keeps per-key edits and selection local (component: %s)', async component => {
    const objects = new SvelteMap([[1, item(1)], [2, item(2)], [3, item(3)]]);
    const selection = new SvelteSet<number>();
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const Child = compileViewportSource(`<script>let { id, object, selection, setup } = $props();</script>${mesh}`);
    const view = mountScene<{ replace(objects: SvelteMap<number, Item>, selection: SvelteSet<number>): void }>(`<script>
      let { initialObjects, initialSelection, setup, Child } = $props();
      let objects = $state.raw(initialObjects), selection = $state.raw(initialSelection);
      export function replace(nextObjects, nextSelection) { objects = nextObjects; selection = nextSelection; }
    </script><scene>{#each objects.keys() as id (id)}
      {@const object = objects.get(id)}
      ${component ? '<Child {id} {object} {selection} {setup} />' : mesh}
    {/each}</scene>`, { initialObjects: objects, initialSelection: selection, setup, Child });
    const changed = vi.mocked(view.gpu.setScene);
    try {
      await settleComponentUpdates();
      const original = view.meshes();
      const storage = changed.mock.lastCall![0].drawBatches[0].instances;
      for (const update of [
        () => objects.set(2, item(8)),
        () => selection.add(2),
        () => dispatchNodeEvent(original[1], 'click')
      ]) {
        changed.mockClear();
        flushSync(update); await settleComponentUpdates();
        expect(changed).toHaveBeenCalledOnce();
        const scene = changed.mock.lastCall![0];
        expect(scene.drawBatchesChanged).toBe(false);
        expect(scene.drawBatches[0].instances).toBe(storage);
        expect(scene.instanceUpdates![0].dirtyRanges).toEqual([{ start: 1, count: 1 }]);
        expect(view.meshes()).toEqual(original);
        expect(setup).toHaveBeenCalledTimes(3);
        expect(cleanup).not.toHaveBeenCalled();
      }
      expect(original[1].attributes.position).toEqual([8, 0, 0]);
      expect(selection.has(2)).toBe(false);
      changed.mockClear();
      flushSync(() => { objects.set(2, objects.get(2)!); selection.delete(2); selection.clear(); });
      await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();

      const nextObjects = new SvelteMap([[1, item(4)], [2, item(5)], [3, item(6)]]);
      const nextSelection = new SvelteSet([1]);
      flushSync(() => view.instance.replace(nextObjects, nextSelection)); await settleComponentUpdates();
      expect(view.meshes()).toEqual(original);
      expect(original[0].attributes.position).toEqual([4, 0, 0]);
      changed.mockClear();
      flushSync(() => { objects.set(1, item(100)); selection.add(3); }); await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();
      flushSync(() => nextObjects.delete(2)); await settleComponentUpdates();
      expect(view.meshes()).toEqual([original[0], original[2]]);
      expect(cleanup).toHaveBeenCalledOnce();
      flushSync(() => nextObjects.set(2, item(9))); await settleComponentUpdates();
      const reinserted = view.meshes();
      expect(reinserted.slice(0, 2)).toEqual([original[0], original[2]]);
      expect(reinserted[2]).not.toBe(original[1]);
      expect(setup).toHaveBeenCalledTimes(4);
      flushSync(() => nextObjects.clear()); await settleComponentUpdates();
      expect(view.meshes()).toEqual([]);
      expect(changed.mock.lastCall![0].drawBatches).toEqual([]);
      expect(cleanup).toHaveBeenCalledTimes(4);
    } finally { await view.dispose(); }
    changed.mockClear();
    flushSync(() => { objects.set(4, item(4)); selection.add(4); }); await settleComponentUpdates();
    expect(changed).not.toHaveBeenCalled();
  });

  it('tracks explicit deep-state map values without pretending plain values are reactive', async () => {
    const view = mountScene<{ mutate(): void; replace(): void }>(`<script>
      let { MapType } = $props();
      const reactive = $state({ position: [0, 0, 0] });
      const plain = { position: [1, 0, 0] };
      const objects = new MapType([[1, reactive], [2, plain]]);
      export function mutate() { reactive.position[0] = 4; plain.position[0] = 5; }
      export function replace() { objects.set(2, { position: [...plain.position] }); }
    </script><scene>{#each objects.keys() as id (id)}
      <mesh name={id} position={objects.get(id).position}><boxGeometry /></mesh>
    {/each}</scene>`, { MapType: SvelteMap });
    const changed = vi.mocked(view.gpu.setScene);
    try {
      await settleComponentUpdates();
      changed.mockClear();
      flushSync(() => view.instance.mutate()); await settleComponentUpdates();
      expect(view.meshes().map(node => node.attributes.position)).toEqual([[4, 0, 0], [1, 0, 0]]);
      expect(changed.mock.lastCall![0].instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 1 }]);
      changed.mockClear();
      flushSync(() => view.instance.replace()); await settleComponentUpdates();
      expect(view.meshes().map(node => node.attributes.position)).toEqual([[4, 0, 0], [5, 0, 0]]);
      expect(changed.mock.lastCall![0].instanceUpdates![0].dirtyRanges).toEqual([{ start: 1, count: 1 }]);
    } finally { await view.dispose(); }
  });
});
