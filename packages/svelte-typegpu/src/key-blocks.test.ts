// @vitest-environment happy-dom
import { flushSync, mount, tick, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { compileTypeGpuSource } from './component-test-utils';
import { createFragment, dispatchNodeEvent, walk, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';

function meshes(root: TypeGpuNode) {
  const result: TypeGpuNode[] = [];
  walk(root, node => { if (node.name === 'mesh') result.push(node); });
  return result;
}

describe('keyed scene resets', () => {
  it('resets child state and attachments through a snippet, retaining the parent and siblings', async () => {
    const Child = compileTypeGpuSource(`<script>
      let { setup } = $props();
      let clicks = $state(0);
    </script><mesh name={clicks} {@attach setup} onclick={() => clicks += 1} />`);
    const Scene = compileTypeGpuSource<{ key(value: number): void; move(): void }>(`<script>
      let { Child, setup } = $props();
      let revision = $state(0), x = $state(0);
      export function key(value) { revision = value; }
      export function move() { x += 1; }
    </script>
    {#snippet content()}<Child {setup} />{/snippet}
    <scene><mesh name="sibling" />
      <group position={[x, 0, 0]}>{#key revision}{@render content()}{/key}</group>
    </scene>`);
    const cleanup = vi.fn();
    const setup = vi.fn((node: TypeGpuNode) => () => cleanup(node));
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { Child, setup } });
    try {
      flushSync();
      const [sibling, first] = meshes(root);
      const parent = first.parent!;
      flushSync(() => dispatchNodeEvent(first, 'click'));
      expect(first.attributes.name).toBe(1);
      flushSync(() => { instance.key(0); instance.move(); });
      expect(meshes(root)).toEqual([sibling, first]);
      expect(parent.attributes.position).toEqual([1, 0, 0]);
      expect(setup).toHaveBeenCalledOnce();
      expect(cleanup).not.toHaveBeenCalled();
      flushSync(() => instance.key(1));
      const second = meshes(root)[1];
      expect(second).not.toBe(first);
      expect(second.parent).toBe(parent);
      expect(second.attributes.name).toBe(0);
      expect(first.parent).toBeNull();
      expect(meshes(root)[0]).toBe(sibling);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(first);
      flushSync(() => instance.key(0));
      expect(meshes(root)[1]).not.toBe(first);
      expect(meshes(root)[1]).not.toBe(second);
      expect(setup).toHaveBeenCalledTimes(3);
      expect(cleanup).toHaveBeenCalledTimes(2);
    } finally { await unmount(instance); }
    expect(cleanup).toHaveBeenCalledTimes(3);
    expect(meshes(root)).toEqual([]);
  });

  it.each([false, true])('does not revive an obsolete await branch after a reset (reject: %s)', async reject => {
    let resolve!: (value: string) => void;
    let fail!: (reason: Error) => void;
    const oldRequest = new Promise<string>((yes, no) => { resolve = yes; fail = no; });
    const Scene = compileTypeGpuSource<{ reset(): void }>(`<script>
      let { oldRequest, setup } = $props();
      let revision = $state(0);
      export function reset() { revision += 1; }
    </script><scene>{#key revision}
      {#await revision === 0 ? oldRequest : Promise.resolve('current')}
        <mesh name="pending" />
      {:then value}<mesh name={value} {@attach setup} />
      {:catch error}<mesh name="obsolete-error" {@attach setup} />{/await}
    {/key}</scene>`);
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { oldRequest, setup } });
    try {
      await tick();
      expect(meshes(root)[0].attributes.name).toBe('pending');
      flushSync(() => instance.reset());
      await tick();
      const current = meshes(root)[0];
      expect(current.attributes.name).toBe('current');
      if (reject) fail(new Error('obsolete')); else resolve('obsolete');
      await tick();
      expect(meshes(root)).toEqual([current]);
      expect(setup).toHaveBeenCalledOnce();
      expect(cleanup).not.toHaveBeenCalled();
    } finally { await unmount(instance); }
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
