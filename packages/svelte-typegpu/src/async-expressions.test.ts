// @vitest-environment happy-dom
import { flushSync, mount, settled, tick, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { compileAsyncTypeGpuSource } from './component-test-utils';
import { createFragment, walk, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';

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
  const nodes: TypeGpuNode[] = [];
  walk(root, (node) => {
    if (node.kind === 'element') nodes.push(node);
  });
  return nodes;
}

describe('async scene expressions', () => {
  it('keeps unresolved content offscreen until the boundary resolves', async () => {
    const Scene = await compileAsyncTypeGpuSource(`
      <script>let { request, setup } = $props();</script>
      {#snippet pending()}<mesh name="pending" />{/snippet}
      <svelte:boundary {pending}>
        <mesh name={await request} {@attach setup} />
      </svelte:boundary>
    `);
    const root = createFragment();
    const request = deferred<string>();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const instance = mount(Scene, {
      renderer,
      target: root,
      props: { request: request.promise, setup }
    });
    try {
      await tick();
      expect(elements(root).map((node) => node.attributes.name)).toEqual(['pending']);
      expect(setup).not.toHaveBeenCalled();
      request.resolve('ready');
      await tick();
      await settled();
      expect(elements(root).map((node) => node.attributes.name)).toEqual(['ready']);
      expect(setup).toHaveBeenCalledOnce();
    } finally {
      await unmount(instance);
    }
    expect(cleanup).toHaveBeenCalledOnce();
    expect(elements(root)).toEqual([]);
  });

  it('retains committed attributes while an async derived value updates', async () => {
    const Child = await compileAsyncTypeGpuSource<{ replace(value: Promise<string>): void }>(`
      <script>
        let { initial } = $props();
        let request = $state.raw(initial);
        const name = $derived(await request);
        export function replace(value) { request = value; }
      </script>
      <mesh {name} />
      <mesh name="status" pending={$effect.pending()} />
    `);
    const Scene = await compileAsyncTypeGpuSource<{ replace(value: Promise<string>): void }>(`
      <script>
        let { Child, initial } = $props();
        let child;
        export function replace(value) { child.replace(value); }
      </script>
      {#snippet pending()}<mesh name="pending" />{/snippet}
      <svelte:boundary {pending}><Child {initial} bind:this={child} /></svelte:boundary>
    `);
    const root = createFragment();
    const first = deferred<string>();
    const second = deferred<string>();
    const instance = mount(Scene, {
      renderer,
      target: root,
      props: { Child, initial: first.promise }
    });
    try {
      await tick();
      first.resolve('first');
      await tick();
      await settled();
      const mesh = elements(root)[0];
      flushSync(() => instance.replace(second.promise));
      await tick();
      expect(elements(root)[0]).toBe(mesh);
      expect(mesh.attributes.name).toBe('first');
      expect(elements(root)[1].attributes.pending).toBe(1);
      second.resolve('second');
      await tick();
      await settled();
      expect(elements(root)[0]).toBe(mesh);
      expect(mesh.attributes.name).toBe('second');
      expect(elements(root)[1].attributes.pending).toBe(0);
    } finally {
      await unmount(instance);
    }
  });
});
