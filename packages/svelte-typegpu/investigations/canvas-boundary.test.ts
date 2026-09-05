// @vitest-environment happy-dom
// Isolated compatibility probes, not the proposed viewport implementation.
import { compile } from 'svelte/compiler';
import { flushSync, getAllContexts, mount, onMount, tick, unmount } from 'svelte';
import { render } from 'svelte/server';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import renderer from '../src/svelte-renderer';
import { createFragment, walk, type TypeGpuNode } from '../src/core';
import { typeGpuRendererPath } from '../src/test-paths';

const mounted: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0).reverse()) await unmount(instance);
  document.body.replaceChildren();
});

function compileProbe(source: string, custom: boolean, dependencies: Record<string, unknown> = {}) {
  const result = compile(source, {
    filename: 'BoundaryProbe.svelte',
    generate: 'client',
    runes: true,
    experimental: { customRenderer: () => (custom ? typeGpuRendererPath : null) }
  });
  const executable = result.js.code
    .replace(/^import .*;\n/gm, '')
    .replace('export default function BoundaryProbe', 'function BoundaryProbe');
  return new Function(
    '$',
    '$renderer',
    ...Object.keys(dependencies),
    `${executable}\nreturn BoundaryProbe;`
  )(client, renderer, ...Object.values(dependencies));
}

function elements(root: TypeGpuNode, name: string) {
  const result: TypeGpuNode[] = [];
  walk(root, (node) => {
    if (node.name === name) result.push(node);
  });
  return result;
}

const conditionalScene = `
  {#if editing}
    <scene name="editor">
      {#each items as item (item)}
        <mesh name={String(item)} {@attach setup} />
      {/each}
    </scene>
  {:else}
    <scene name="preview"><mesh name="preview" /></scene>
  {/if}
`;

function domHost() {
  const SnippetHost = compileProbe(
    `
    <script>let { children } = $props();</script>
    {@render children()}
  `,
    true
  );
  return compileProbe(
    `
    <script>
      let { children, target, ready, disposed } = $props();
      let canvas;
      const context = getAllContexts();
      onMount(() => {
        const instance = mount(SnippetHost, {
          renderer: sceneRenderer, target, context, props: { children }
        });
        ready(canvas);
        return () => { void unmount(instance); disposed(); };
      });
    </script>
    <canvas bind:this={canvas} />
  `,
    false,
    { getAllContexts, onMount, mount, unmount, SnippetHost, sceneRenderer: renderer }
  );
}

describe('declarative canvas boundary investigation (pinned PR, no WebGPU)', () => {
  it('already composes a canvas-named retained node with conditional scenes and keyed children', async () => {
    const root = createFragment();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const Component = compileProbe(
      `
      <script>
        let { setup } = $props();
        let editing = $state(true);
        let items = $state([1, 2]);
        export function toggle() { editing = !editing; }
        export function reorder() { items = [2, 1]; }
      </script>
      <canvas frameloop="demand">${conditionalScene}</canvas>
    `,
      true
    );
    const instance = mount(Component, { renderer, target: root, props: { setup } });
    mounted.push(instance);
    await tick();
    const canvas = elements(root, 'canvas')[0];
    const meshes = elements(root, 'mesh');
    flushSync(() => instance.reorder());
    expect(elements(root, 'mesh')).toEqual([meshes[1], meshes[0]]);
    expect(setup).toHaveBeenCalledTimes(2);
    expect(cleanup).not.toHaveBeenCalled();
    flushSync(() => instance.toggle());
    expect(elements(root, 'canvas')).toEqual([canvas]);
    expect(elements(root, 'scene')[0].attributes.name).toBe('preview');
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('rejects DOM-authored scene snippets mounted under the custom renderer', () => {
    const Producer = compileProbe(
      `
      <script>export function content() { return children; }</script>
      {#snippet children()}<scene><mesh /></scene>{/snippet}
    `,
      false
    );
    const producer = mount(Producer, { target: document.body });
    mounted.push(producer);
    const Consumer = compileProbe(
      `
      <script>let { content } = $props();</script>{@render content()}
    `,
      true
    );
    expect(() =>
      mount(Consumer, {
        renderer,
        target: createFragment(),
        props: { content: producer.content() }
      })
    ).toThrow(/snippet_renderer_mismatch/);
  });

  it('passes custom-authored children through a static DOM host without remounting the host', async () => {
    const root = createFragment();
    const ready = vi.fn();
    const disposed = vi.fn();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const Component = compileProbe(
      `
      <script>
        import Host from './ProbeHost.svelte';
        let { target, ready, disposed, setup } = $props();
        let editing = $state(true);
        let items = $state([1, 2]);
        export function toggle() { editing = !editing; }
        export function reorder() { items = [2, 1]; }
      </script>
      <Host {target} {ready} {disposed}>${conditionalScene}</Host>
    `,
      true,
      { Host: domHost() }
    );
    const instance = mount(Component, {
      target: document.body,
      props: { target: root, ready, disposed, setup }
    });
    mounted.push(instance);
    await tick();
    const canvas = document.querySelector('canvas');
    const meshes = elements(root, 'mesh');
    expect(canvas).not.toBeNull();
    expect(ready).toHaveBeenCalledExactlyOnceWith(canvas);
    flushSync(() => instance.reorder());
    expect(elements(root, 'mesh')).toEqual([meshes[1], meshes[0]]);
    flushSync(() => instance.toggle());
    expect(elements(root, 'scene')[0].attributes.name).toBe('preview');
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(ready).toHaveBeenCalledOnce();
    expect(disposed).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledTimes(2);
    await unmount(instance);
    mounted.pop();
    expect(disposed).toHaveBeenCalledOnce();
    expect(elements(root, 'scene')).toEqual([]);
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('can conditionally mount the static-host viewport from a DOM parent and update ordinary props', async () => {
    const target = createFragment();
    const ready = vi.fn();
    const disposed = vi.fn();
    const Viewport = compileProbe(
      `
      <script>
        import Host from './ProbeHost.svelte';
        let { target, ready, disposed, value } = $props();
      </script>
      <Host {target} {ready} {disposed}>
        <scene><mesh position={[value, 0, 0]} /></scene>
      </Host>
    `,
      true,
      { Host: domHost() }
    );
    const App = compileProbe(
      `
      <script>
        import Viewport from './Viewport.typegpu.svelte';
        let { target, ready, disposed } = $props();
        let visible = $state(true);
        let value = $state(1);
        export function toggle() { visible = !visible; }
        export function move() { value = 2; }
      </script>
      <div>{#if visible}<Viewport {target} {ready} {disposed} {value} />{/if}</div>
    `,
      false,
      { Viewport }
    );
    const app = mount(App, { target: document.body, props: { target, ready, disposed } });
    mounted.push(app);
    await tick();
    const canvas = document.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(elements(target, 'mesh')[0].attributes.position).toEqual([1, 0, 0]);
    flushSync(() => app.move());
    expect(elements(target, 'mesh')[0].attributes.position).toEqual([2, 0, 0]);
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(ready).toHaveBeenCalledOnce();
    flushSync(() => app.toggle());
    await tick();
    expect(document.querySelector('canvas')).toBeNull();
    expect(elements(target, 'scene')).toEqual([]);
    expect(disposed).toHaveBeenCalledOnce();
    flushSync(() => app.toggle());
    await tick();
    expect(document.querySelector('canvas')).not.toBeNull();
    expect(document.querySelector('canvas')).not.toBe(canvas);
    expect(elements(target, 'mesh')[0].attributes.position).toEqual([2, 0, 0]);
    expect(ready).toHaveBeenCalledTimes(2);
  });

  it('cannot place that DOM host inside a custom-rendered conditional with the current adapter', () => {
    const Component = compileProbe(
      `
      <script>
        import Host from './ProbeHost.svelte';
        let { target, ready, disposed, show = true } = $props();
      </script>
      {#if show}<Host {target} {ready} {disposed}><scene /></Host>{/if}
    `,
      true,
      { Host: domHost() }
    );
    expect(() =>
      mount(Component, {
        renderer,
        target: createFragment(),
        props: { target: createFragment(), ready: vi.fn(), disposed: vi.fn() }
      })
    ).toThrow(/before is not a function/);
  });

  it.each([
    '<script>let value = $state(0);</script><input type="range" bind:value />',
    '<script>let width = $state(0);</script><canvas bind:clientWidth={width} />',
    '<script>import { fade } from "svelte/transition";</script><canvas transition:fade />'
  ])('does not gain normal DOM directives by calling a custom node canvas: %s', (source) => {
    expect(() => compileProbe(source, true)).toThrow(/not compatible with `customRenderer`/);
  });

  it('server-compiles a custom canvas component to a no-op, not an accessible canvas shell', () => {
    const result = compile('<canvas aria-label="Editor"><scene /></canvas>', {
      filename: 'BoundaryProbe.svelte',
      generate: 'server',
      runes: true,
      experimental: { customRenderer: typeGpuRendererPath }
    });
    const Component = new Function(
      `${result.js.code.replace('export default function', 'function')}\nreturn BoundaryProbe;`
    )();
    expect(render(Component).body).not.toContain('<canvas');
  });
});
