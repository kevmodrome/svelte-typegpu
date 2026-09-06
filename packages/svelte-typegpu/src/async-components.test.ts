// @vitest-environment happy-dom
import { flushSync, getAbortSignal, getContext, mount, setContext, tick, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, walk, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';
import { compileTypeGpuSource } from './component-test-utils';
import { loadModel } from './model-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function elements(root: TypeGpuNode) {
  const result: TypeGpuNode[] = [];
  walk(root, (node) => {
    if (node.kind === 'element') result.push(node);
  });
  return result;
}

describe('async Svelte scene composition', () => {
  it('switches await branches, ignores stale resolutions and cleans each branch once', async () => {
    const Scene = compileTypeGpuSource<{ replace(value: Promise<unknown>): void }>(`
      <script>
        let { initial, setup } = $props();
        let request = $state.raw(initial);
        export function replace(value) { request = value; }
      </script>
      {#await request}
        <mesh name="pending" {@attach setup} />
      {:then asset}
        <model {asset} {@attach setup} />
      {:catch error}
        <mesh name={error.message} {@attach setup} />
      {/await}
    `);
    const root = createFragment();
    const cleanups: ReturnType<typeof vi.fn>[] = [];
    const setup = vi.fn(() => {
      const cleanup = vi.fn();
      cleanups.push(cleanup);
      return cleanup;
    });
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const instance = mount(Scene, {
      renderer,
      target: root,
      props: { initial: first.promise, setup }
    });
    try {
      await tick();
      expect(elements(root).map((node) => node.attributes.name)).toEqual(['pending']);
      flushSync(() => instance.replace(second.promise));
      first.resolve({ key: 'stale', meshes: [] });
      await tick();
      expect(elements(root).map((node) => node.attributes.name)).toEqual(['pending']);

      const asset = { key: 'current', meshes: [] };
      second.resolve(asset);
      await tick();
      expect(elements(root).map((node) => node.name)).toEqual(['model']);
      expect(elements(root)[0].attributes.asset).toBe(asset);
      const failed = deferred<unknown>();
      flushSync(() => instance.replace(failed.promise));
      await tick();
      failed.reject(new Error('failed'));
      await tick();
      expect(elements(root).map((node) => node.attributes.name)).toEqual(['failed']);
    } finally {
      await unmount(instance);
    }
    expect(elements(root)).toEqual([]);
    expect(cleanups.length).toBeGreaterThanOrEqual(3);
    for (const cleanup of cleanups) expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('ignores promise %s after unmount', async (settle) => {
    const Scene = compileTypeGpuSource(`
      <script>let { request, setup } = $props();</script>
      {#await request}<mesh />{:then}<model {@attach setup} />{:catch}<mesh {@attach setup} />{/await}
    `);
    const request = deferred<unknown>();
    const setup = vi.fn();
    const root = createFragment();
    const scheduleSync = vi.fn();
    root.runtime = { scheduleSync };
    const instance = mount(Scene, {
      renderer,
      target: root,
      props: { request: request.promise, setup }
    });
    await tick();
    await unmount(instance);
    scheduleSync.mockClear();
    request[settle](new Error('late'));
    await tick();
    expect(elements(root)).toEqual([]);
    expect(scheduleSync).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it('cancels component-owned model requests through getAbortSignal on change and unmount', async () => {
    const Scene = compileTypeGpuSource<{ change(src: string): void }>(`
      <script>
        let { load, abortSignal } = $props();
        let src = $state('/first.obj');
        const request = $derived(load(src, { signal: abortSignal() }));
        export function change(value) { src = value; }
      </script>
      {#await request}<mesh name="pending" />{:then asset}<model {asset} />{:catch}<mesh name="failed" />{/await}
    `);
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn(
      (_src, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signals.push(signal as AbortSignal);
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const root = createFragment();
    const instance = mount(Scene, {
      renderer,
      target: root,
      props: { load: loadModel, abortSignal: getAbortSignal }
    });
    try {
      await tick();
      expect(signals).toHaveLength(1);
      flushSync(() => instance.change('/second.obj'));
      await tick();
      expect(signals[0].aborted).toBe(true);
      expect(signals[1].aborted).toBe(false);
      expect(elements(root)[0].attributes.name).toBe('pending');
    } finally {
      await unmount(instance);
      await tick();
      vi.unstubAllGlobals();
    }
    expect(signals[1].aborted).toBe(true);
  });

  it('preserves reactive component context through an asynchronously mounted child', async () => {
    const Child = compileTypeGpuSource(`
      <script>
        let { get, key } = $props();
        const settings = get(key);
      </script>
      <mesh color={settings.color} />
    `);
    const Parent = compileTypeGpuSource<{ change(color: number[]): void }>(`
      <script>
        let { Child, get, set, key, request } = $props();
        const settings = $state({ color: [1, 0, 0, 1] });
        set(key, settings);
        export function change(color) { settings.color = color; }
      </script>
      {#await request then}<Child {get} {key} />{/await}
    `);
    const request = deferred<void>();
    const root = createFragment();
    const instance = mount(Parent, {
      renderer,
      target: root,
      props: { Child, get: getContext, set: setContext, key: Symbol(), request: request.promise }
    });
    try {
      await tick();
      expect(elements(root)).toEqual([]);
      request.resolve();
      await tick();
      expect(elements(root)[0].attributes.color).toEqual([1, 0, 0, 1]);
      flushSync(() => instance.change([0, 1, 0, 1]));
      expect(elements(root)[0].attributes.color).toEqual([0, 1, 0, 1]);
    } finally {
      await unmount(instance);
    }
  });

  it('keeps model requests stable during material edits and reloads on an explicit source replacement', async () => {
    const Scene = compileTypeGpuSource<{ tint(): void; reload(): void }>(`
      <script>
        let { load } = $props();
        const controls = $state({ model: { src: '/teapot.obj' }, color: [1, 0, 0, 1] });
        const request = $derived(load(controls.model.src));
        export function tint() { controls.color = [0, 1, 0, 1]; }
        export function reload() { controls.model = { src: '/teapot.obj' }; }
      </script>
      {#await request then asset}<model {asset} color={controls.color} />{/await}
    `);
    const load = vi.fn(async () => ({ key: 'asset', meshes: [] }));
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { load } });
    try {
      await tick();
      expect(load).toHaveBeenCalledOnce();
      const model = elements(root)[0];
      flushSync(() => instance.tint());
      await tick();
      expect(load).toHaveBeenCalledOnce();
      expect(elements(root)[0]).toBe(model);
      expect(model.attributes.color).toEqual([0, 1, 0, 1]);
      flushSync(() => instance.reload());
      await tick();
      expect(load).toHaveBeenCalledTimes(2);
    } finally {
      await unmount(instance);
    }
  });

  it('cleans a failed boundary and resets it without affecting its siblings', async () => {
    const Scene = compileTypeGpuSource<{ fail(): void; recover(): void }>(`
      <script>
        let { setup, report } = $props();
        let broken = $state(false);
        let reset;
        function read() { if (broken) throw new Error('broken scene'); return 'ready'; }
        function onerror(error, retry) { report(error); reset = retry; }
        export function fail() { broken = true; }
        export function recover() { broken = false; reset(); }
      </script>
      <mesh name="sibling" />
      {#snippet failed(error, reset)}<mesh name={error.message} />{/snippet}
      <svelte:boundary {onerror} {failed}>
        <mesh name={read()} {@attach setup} />
      </svelte:boundary>
    `);
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const report = vi.fn();
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { setup, report } });
    try {
      flushSync();
      const sibling = elements(root)[0];
      flushSync(() => instance.fail());
      await tick();
      expect(report).toHaveBeenCalledWith(new Error('broken scene'));
      expect(elements(root).map((node) => node.attributes.name)).toEqual([
        'sibling',
        'broken scene'
      ]);
      expect(cleanup).toHaveBeenCalledOnce();
      flushSync(() => instance.recover());
      await tick();
      expect(elements(root).map((node) => node.attributes.name)).toEqual(['sibling', 'ready']);
      expect(elements(root)[0]).toBe(sibling);
      expect(setup).toHaveBeenCalledTimes(2);
    } finally {
      await unmount(instance);
    }
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('records the pinned compiler limitation for an inline boundary failed snippet', () => {
    expect(() =>
      compileTypeGpuSource(`
      <svelte:boundary>
        <mesh />
        {#snippet failed(error)}<mesh name={error.message} />{/snippet}
      </svelte:boundary>
    `)
    ).toThrow(TypeError);
  });
});
