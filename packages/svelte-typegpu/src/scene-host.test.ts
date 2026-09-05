// @vitest-environment happy-dom
import { flushSync, getContext, mount, tick, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import SceneHost from './SceneHost.typegpu.svelte';
import renderer from './svelte-renderer';
import { createFragment, walk, type TypeGpuNode } from './core';
import { compileTypeGpuSource } from './component-test-utils';

describe('Svelte scene host', () => {
  it('forwards live props and context without replacing the scene instance', async () => {
    const Scene = compileTypeGpuSource(`
      <script>
        let { value = 5, setup, contextKey, get } = $props();
        const theme = get(contextKey);
      </script>
      <mesh position={[value, 0, 0]} color={theme.color} {@attach setup} />
    `);
    const Parent = compileTypeGpuSource<{ update(): void; clear(): void }>(`
      <script>
        let { Host, Scene, setup, contextKey, get } = $props();
        let props = $state.raw({ value: 1, setup, contextKey, get });
        export function update() { props = { value: 2, setup, contextKey, get }; }
        export function clear() { props = { setup, contextKey, get }; }
      </script>
      <Host scene={Scene} sceneProps={props} />
    `);
    const root = createFragment();
    const contextKey = Symbol();
    const cleanup = vi.fn();
    const nodes: TypeGpuNode[] = [];
    const setup = vi.fn((node: TypeGpuNode) => {
      nodes.push(node);
      return cleanup;
    });
    const instance = mount(Parent, {
      renderer,
      target: root,
      context: new Map([[contextKey, { color: [0, 1, 0, 1] }]]),
      props: { Host: SceneHost, Scene, setup, contextKey, get: getContext }
    });
    try {
      await tick();
      expect(nodes[0].attributes.color).toEqual([0, 1, 0, 1]);
      expect(nodes[0].attributes.position).toEqual([1, 0, 0]);
      flushSync(() => instance.update());
      expect(nodes[0].attributes.position).toEqual([2, 0, 0]);
      flushSync(() => instance.clear());
      expect(nodes[0].attributes.position).toEqual([5, 0, 0]);
      expect(setup).toHaveBeenCalledOnce();
      expect(cleanup).not.toHaveBeenCalled();
    } finally {
      await unmount(instance);
    }
    expect(cleanup).toHaveBeenCalledOnce();
    const remaining: TypeGpuNode[] = [];
    walk(root, (node) => {
      if (node.kind === 'element') remaining.push(node);
    });
    expect(remaining).toEqual([]);
  });
});
