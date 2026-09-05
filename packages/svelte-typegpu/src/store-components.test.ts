// @vitest-environment happy-dom
import { flushSync, mount, unmount } from 'svelte';
import { writable, derived, type Writable } from 'svelte/store';
import { describe, expect, it, vi } from 'vitest';
import { compileViewportSource } from './viewport-test-utils';
import { createFragment, dispatchNodeEvent, type TypeGpuNode } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';

function tracked<T>(initial: T) {
  const source = writable(initial);
  const detach = vi.fn();
  const subscribe = vi.fn<Writable<T>['subscribe']>((...args) => {
    const stop = source.subscribe(...args);
    return () => { detach(); stop(); };
  });
  return { store: { ...source, subscribe }, subscribe, detach };
}

function mountScene<Exports extends Record<string, unknown>>(source: string, props = {}) {
  const root = createFragment();
  const gpu = {
    setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(),
    renderFrame: vi.fn(), setFrameHandler: vi.fn(), getRenderSize: vi.fn(), dispose: vi.fn()
  } as TypeGpuRenderer;
  const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
  root.runtime = runtime;
  const instance = mount(compileViewportSource<Exports>(source), { renderer, target: root, props });
  return { instance, gpu, async dispose() { await unmount(instance); runtime.dispose(); } };
}

describe('store-backed scene components', () => {
  it.each([false, true])('tracks same-object updates without subscription or attachment churn (spread: %s)', async spread => {
    const position = tracked([0, 0, 0]);
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const { gpu, dispose } = mountScene(`<script>let { position, setup } = $props();</script>
      <scene><mesh><boxGeometry /></mesh>
        <mesh ${spread ? '{...{ position: $position }}' : 'position={$position}'} {@attach setup}>
          <boxGeometry />
        </mesh>
      </scene>`, { position: position.store, setup });
    try {
      flushSync(); await Promise.resolve();
      const first = vi.mocked(gpu.setScene).mock.lastCall![0];
      const instances = first.drawBatches[0].instances;
      for (let x = 1; x <= 4; x++) {
        vi.mocked(gpu.setScene).mockClear();
        flushSync(() => position.store.update(value => { value[0] = x; return value; }));
        await Promise.resolve();
        expect(gpu.setScene).toHaveBeenCalledOnce();
        const next = vi.mocked(gpu.setScene).mock.lastCall![0];
        expect(next.drawBatchesChanged).toBe(false);
        expect(next.drawBatches[0].instances).toBe(instances);
        expect(next.instanceUpdates![0].dirtyRanges).toEqual([{ start: 1, count: 1 }]);
        expect(instances[24]).toBe(x);
      }
      vi.mocked(gpu.setScene).mockClear();
      flushSync(() => position.store.update(value => value));
      await Promise.resolve();
      expect(gpu.setScene).not.toHaveBeenCalled();
      expect(position.subscribe).toHaveBeenCalledOnce();
      expect(position.detach).not.toHaveBeenCalled();
      expect(setup).toHaveBeenCalledOnce();
      expect(cleanup).not.toHaveBeenCalled();
    } finally { await dispose(); }
    expect(position.detach).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledOnce();
    vi.mocked(gpu.setScene).mockClear();
    position.store.set([8, 0, 0]);
    flushSync(); await Promise.resolve();
    expect(gpu.setScene).not.toHaveBeenCalled();
  });

  it('switches subscriptions when the store prop changes and writes back from scene events', async () => {
    const first = tracked([0, 0, 0]), second = tracked([5, 0, 0]);
    const setup = vi.fn((node: TypeGpuNode) => {});
    const { instance, gpu, dispose } = mountScene<{ replace(store: Writable<number[]>): void }>(`<script>
      let { initial, setup } = $props();
      let position = $state.raw(initial);
      export function replace(store) { position = store; }
    </script><scene><mesh position={$position} {@attach setup} onclick={() => $position[0] += 1}>
      <boxGeometry />
    </mesh></scene>`, { initial: first.store, setup });
    try {
      flushSync(); await Promise.resolve();
      const mesh = setup.mock.calls[0][0];
      flushSync(() => instance.replace(second.store)); await Promise.resolve();
      expect(first.detach).toHaveBeenCalledOnce();
      expect(second.subscribe).toHaveBeenCalledOnce();
      expect(mesh.attributes.position).toEqual([5, 0, 0]);
      vi.mocked(gpu.setScene).mockClear();
      first.store.set([100, 0, 0]);
      flushSync(); await Promise.resolve();
      expect(gpu.setScene).not.toHaveBeenCalled();
      const received: number[] = [];
      const stop = second.store.subscribe(value => received.push(value[0]));
      flushSync(() => dispatchNodeEvent(mesh, 'click')); await Promise.resolve();
      expect(received).toEqual([5, 6]);
      expect(mesh.attributes.position).toEqual([6, 0, 0]);
      expect(setup).toHaveBeenCalledOnce();
      stop();
    } finally { await dispose(); }
    expect(first.detach).toHaveBeenCalledOnce();
    expect(second.detach).toHaveBeenCalledTimes(2);
  });

  it('shares a derived producer across child components and releases the last subscription', async () => {
    const source = tracked(0);
    const position = derived(source.store, value => [value, 0, 0]);
    const Child = compileViewportSource(`<script>let { position } = $props();</script>
      <mesh position={$position}><boxGeometry /></mesh>`);
    const { instance, gpu, dispose } = mountScene<{ hide(): void }>(`<script>
      let { Child, position } = $props();
      let visible = $state(true);
      export function hide() { visible = false; }
    </script><scene><Child {position} />{#if visible}<Child {position} />{/if}</scene>`, { Child, position });
    try {
      flushSync(); await Promise.resolve();
      expect(source.subscribe).toHaveBeenCalledOnce();
      source.store.set(2);
      flushSync(); await Promise.resolve();
      const instances = vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances;
      expect([instances[0], instances[24]]).toEqual([2, 2]);
      flushSync(() => instance.hide()); await Promise.resolve();
      expect(source.detach).not.toHaveBeenCalled();
      source.store.set(3);
      flushSync(); await Promise.resolve();
      expect(vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances[0]).toBe(3);
    } finally { await dispose(); }
    expect(source.detach).toHaveBeenCalledOnce();
  });
});
