import { flushSync, mount, unmount } from 'svelte';
import { describe, expect, it, vi } from 'vitest';
import { onNodeEvent, type TypeGpuAttachment } from './attachments';
import { createElement, createFragment, dispatchNodeEvent, insert, type TypeGpuNode } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import { compileTypeGpuSource } from './component-test-utils';

describe('scene attachments', () => {
  it('retains actual node identity in state, event selection and attachment cleanup', async () => {
    const Scene = compileTypeGpuSource<{ read(): any; show(value: boolean): void }>(`
      <script>
        let ref = $state(null), selected = $state(null), visible = $state(true);
        let record = $state({ node: null }), list = $state([]);
        function capture(node) {
          ref = node; record.node = node; list = [node];
          return () => {
            if (ref === node) ref = null;
            if (record.node === node) record.node = null;
            if (list[0] === node) list = [];
          };
        }
        export function read() { return { ref, selected, nested: record.node, item: list[0] }; }
        export function show(value) { visible = value; }
      </script>
      <scene>{#if visible}
        <mesh {@attach capture} onclick={event => selected = event.currentTarget}>
          <boxGeometry /><standardMaterial color={selected && selected === ref ? [1, 0, 0, 1] : [0, 0, 1, 1]} />
        </mesh>
      {/if}</scene>
    `);
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root });
    let node: TypeGpuNode;
    try {
      flushSync();
      const scene = root.children.find((node) => node.name === 'scene')!;
      node = scene.children.find((node) => node.name === 'mesh')!;
      for (const key of ['ref', 'nested', 'item']) expect(instance.read()[key] === node, key).toBe(true);
      expect(instance.read().ref.parent).toBe(scene);
      flushSync(() => dispatchNodeEvent(node, 'click'));
      expect(instance.read().selected).toBe(node);
      const material = node.children.find((node) => node.name === 'standardMaterial')!;
      expect(material.attributes.color).toEqual([1, 0, 0, 1]);
      flushSync(() => instance.show(false));
      expect(instance.read()).toMatchObject({ ref: null, nested: null, item: undefined, selected: node });
      expect(instance.read().selected.parent).toBeNull();
    } finally {
      await unmount(instance);
    }
    expect(instance.read().ref).toBeNull();
  });

  it('keeps keyed references inside reactive records identical across moves and removals', async () => {
    const Scene = compileTypeGpuSource<{ read(): Record<number, TypeGpuNode>; reverse(): void; remove(): void }>(`
      <script>
        let { setup, cleanup } = $props();
        let items = $state([1, 2, 3]), refs = $state({});
        function capture(id) {
          return node => {
            setup(node); refs[id] = node;
            return () => { cleanup(node); if (refs[id] === node) delete refs[id]; };
          };
        }
        export function read() { return refs; }
        export function reverse() { items.reverse(); }
        export function remove() { items = items.slice(1); }
      </script>
      <scene>{#each items as id (id)}<mesh {@attach capture(id)} />{/each}</scene>
    `);
    const setup = vi.fn(), cleanup = vi.fn();
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { setup, cleanup } });
    try {
      flushSync();
      const nodes = setup.mock.calls.map(([node]) => node);
      nodes.forEach((node, i) => expect(instance.read()[i + 1] === node).toBe(true));
      flushSync(() => instance.reverse());
      nodes.forEach((node, i) => expect(instance.read()[i + 1]).toBe(node));
      expect(setup).toHaveBeenCalledTimes(3);
      expect(cleanup).not.toHaveBeenCalled();
      flushSync(() => instance.remove());
      expect(Object.keys(instance.read())).toEqual(['1', '2']);
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(nodes[2]);
    } finally {
      await unmount(instance);
    }
    expect(Object.keys(instance.read())).toEqual([]);
    expect(cleanup).toHaveBeenCalledTimes(3);
  });

  it('routes attachment events through Svelte state into targeted material updates', async () => {
    const Scene = compileTypeGpuSource(`
      <script>
        let { setup } = $props();
        let hovered = $state(false);
        const hover = setup(value => hovered = value);
      </script>
      <scene>
        {#each [1, 2, 3] as id (id)}<mesh><boxGeometry /><standardMaterial /></mesh>{/each}
        <mesh {@attach hover}>
          <boxGeometry /><standardMaterial color={hovered ? [1, 0, 0, 1] : [0, 0, 1, 1]} />
        </mesh>
      </scene>
    `);
    let target: TypeGpuNode;
    const setup =
      (onChange: (value: boolean) => void): TypeGpuAttachment =>
      (node) => {
        target = node;
        const enter = onNodeEvent(node, 'pointerenter', () => onChange(true));
        const leave = onNodeEvent(node, 'pointerleave', () => onChange(false));
        return () => {
          enter();
          leave();
        };
      };
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
    const instance = mount(Scene, { renderer, target: root, props: { setup } });
    try {
      flushSync();
      await Promise.resolve();
      const initial = vi.mocked(gpu.setScene).mock.lastCall![0].drawBatches[0].instances;
      for (const event of ['pointerenter', 'pointerleave']) {
        flushSync(() => dispatchNodeEvent(target, event));
        await Promise.resolve();
        const state = vi.mocked(gpu.setScene).mock.lastCall![0];
        expect(state.drawBatchesChanged).toBe(false);
        expect(state.drawBatches[0].instances).toBe(initial);
        expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 3, count: 1 }]);
        expect(initial[3 * 24 + 4]).toBe(event === 'pointerenter' ? 1 : 0);
      }
    } finally {
      await unmount(instance);
      runtime.dispose();
    }
    expect(target!.listeners.size).toBe(0);
  });

  it('owns independent subscriptions and idempotent cleanup', () => {
    const root = createFragment();
    const node = createElement('mesh');
    insert(root, node, null);
    const scheduleSync = vi.fn();
    root.runtime = { scheduleSync };
    const callback = vi.fn();
    const first = onNodeEvent(node, 'pointerenter', callback);
    const second = onNodeEvent(node, 'pointerenter', callback);
    dispatchNodeEvent(node, 'pointerenter');
    expect(callback).toHaveBeenCalledTimes(2);
    first();
    const invalidations = scheduleSync.mock.calls.length;
    first();
    expect(scheduleSync).toHaveBeenCalledTimes(invalidations);
    dispatchNodeEvent(node, 'pointerenter');
    expect(callback).toHaveBeenCalledTimes(3);
    second();
    expect(node.listeners.size).toBe(0);
  });

  it('reruns reactive attachments and cleans them up on disable and conditional removal', async () => {
    const Scene = compileTypeGpuSource<{
      change(value: number): void;
      enable(value: boolean): void;
      show(value: boolean): void;
    }>(`
      <script>
        let { setup } = $props();
        let value = $state(1);
        let enabled = $state(true);
        let visible = $state(true);
        export function change(next) { value = next; }
        export function enable(next) { enabled = next; }
        export function show(next) { visible = next; }
      </script>
      <scene>{#if visible}<mesh {@attach enabled && setup(value)} />{/if}</scene>
    `);
    const root = createFragment();
    const events: string[] = [];
    const nodes: TypeGpuNode[] = [];
    const setup =
      (value: number): TypeGpuAttachment =>
      (node) => {
        nodes.push(node);
        events.push(`setup:${value}`);
        const off = onNodeEvent(node, 'click', () => events.push(`click:${value}`));
        return () => {
          off();
          events.push(`cleanup:${value}`);
        };
      };
    const instance = mount(Scene, { renderer, target: root, props: { setup } });
    try {
      flushSync();
      const node = nodes[0];
      dispatchNodeEvent(node, 'click');
      flushSync(() => instance.change(2));
      expect(nodes[1]).toBe(node);
      dispatchNodeEvent(node, 'click');
      flushSync(() => instance.enable(false));
      dispatchNodeEvent(node, 'click');
      flushSync(() => instance.enable(true));
      flushSync(() => instance.show(false));
      expect(events).toEqual([
        'setup:1',
        'click:1',
        'cleanup:1',
        'setup:2',
        'click:2',
        'cleanup:2',
        'setup:2',
        'cleanup:2'
      ]);
      expect(node.listeners.size).toBe(0);
    } finally {
      await unmount(instance);
    }
    expect(events.filter((event) => event.startsWith('cleanup'))).toHaveLength(3);
  });

  it('forwards attachments through component spreads without restarting on keyed moves', async () => {
    const Box = compileTypeGpuSource(`
      <script>let { children, ...props } = $props();</script>
      <mesh {...props}>{@render children?.()}</mesh>
    `);
    const Scene = compileTypeGpuSource<{ reverse(): void; remove(): void }>(`
      <script>
        let { Box, setup } = $props();
        let items = $state([1, 2]);
        export function reverse() { items.reverse(); }
        export function remove() { items = items.slice(1); }
      </script>
      <scene>
        {#each items as item (item)}
          <Box position={[item, 0, 0]} {@attach setup}><boxGeometry /></Box>
        {/each}
      </scene>
    `);
    const cleanup = vi.fn();
    const nodes: TypeGpuNode[] = [];
    const setup: TypeGpuAttachment = (node) => {
      nodes.push(node);
      return () => cleanup(node);
    };
    const root = createFragment();
    const instance = mount(Scene, { renderer, target: root, props: { Box, setup } });
    try {
      flushSync();
      expect(nodes).toHaveLength(2);
      const scene = nodes[0].parent!;
      flushSync(() => instance.reverse());
      expect(scene.children.filter((node) => node.name === 'mesh')).toEqual([...nodes].reverse());
      expect(nodes).toHaveLength(2);
      expect(cleanup).not.toHaveBeenCalled();
      flushSync(() => instance.remove());
      expect(cleanup).toHaveBeenCalledExactlyOnceWith(nodes[1]);
    } finally {
      await unmount(instance);
    }
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it('preserves the update and destroy lifecycle for renderer-safe legacy actions', async () => {
    const Scene = compileTypeGpuSource<{ change(): void }>(`
      <script>
        let { setup } = $props();
        let value = $state(1);
        export function change() { value = 2; }
      </script>
      <scene><mesh use:setup={value} /></scene>
    `);
    const update = vi.fn();
    const destroy = vi.fn();
    const setup = vi.fn((_node: TypeGpuNode, _value: number) => ({ update, destroy }));
    const instance = mount(Scene, { renderer, target: createFragment(), props: { setup } });
    try {
      flushSync();
      expect(setup).toHaveBeenCalledOnce();
      expect(setup.mock.calls[0][1]).toBe(1);
      flushSync(() => instance.change());
      expect(update).toHaveBeenCalledExactlyOnceWith(2);
    } finally {
      await unmount(instance);
    }
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('supports component bindings and component references independently of host bindings', async () => {
    const Box = compileTypeGpuSource(`
      <script>
        let { x = $bindable(0) } = $props();
        export function move() { x += 1; }
      </script>
      <mesh position={[x, 0, 0]} />
    `);
    const Scene = compileTypeGpuSource<{ move(): void; read(): number }>(`
      <script>
        let { Box } = $props();
        let box = $state();
        let x = $state(0);
        export function move() { box.move(); }
        export function read() { return x; }
      </script>
      <scene><Box bind:x bind:this={box} /></scene>
    `);
    const instance = mount(Scene, { renderer, target: createFragment(), props: { Box } });
    try {
      flushSync();
      flushSync(() => instance.move());
      expect(instance.read()).toBe(1);
    } finally {
      await unmount(instance);
    }
  });

  it.each([
    '<mesh bind:this={value} />',
    '<mesh transition:value />',
    '<mesh in:value />',
    '<mesh out:value />',
    '{#each [1, 2] as item (item)}<mesh animate:value />{/each}'
  ])('records the pinned compiler boundary for %s', (markup) => {
    expect(() =>
      compileTypeGpuSource(`<script>let value;</script><scene>${markup}</scene>`)
    ).toThrow(/not compatible with `customRenderer`/);
  });
});
