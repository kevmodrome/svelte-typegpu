// @vitest-environment happy-dom
import { execFileSync } from 'node:child_process';
import { flushSync, mount, unmount } from 'svelte';
import * as windowValues from 'svelte/reactivity/window';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFragment, walk, type TypeGpuNode } from './core';
import renderer, { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';

// The DPR export owns a query from module initialization, before any scene mounts.
const resolution = await vi.hoisted(async () => {
  const { createRequire } = await import('node:module');
  const require = createRequire(`${process.cwd()}/package.json`);
  const env = createRequire(require.resolve('svelte/package.json')).resolve('esm-env');
  // Match Svelte's actual dependency, not a different workspace copy of esm-env.
  vi.doMock(env, async importOriginal => ({ ...await importOriginal<object>(), BROWSER: true }));
  const initial = new EventTarget();
  const original = window.matchMedia.bind(window);
  vi.spyOn(window, 'matchMedia').mockImplementation(query =>
    query.startsWith('(resolution:') ? initial as MediaQueryList : original(query));
  return { initial };
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function sceneRuntime() {
  const root = createFragment();
  const gpu = {
    setOptions: vi.fn(), setScene: vi.fn(), setCamera: vi.fn(), invalidate: vi.fn(),
    renderFrame: vi.fn(), setFrameHandler: vi.fn(), getRenderSize: vi.fn(), dispose: vi.fn()
  } as TypeGpuRenderer;
  const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
  root.runtime = runtime;
  return { root, runtime, changed: vi.mocked(gpu.setScene) };
}

function meshes(root: TypeGpuNode) {
  const nodes: TypeGpuNode[] = [];
  walk(root, node => { if (node.name === 'mesh') nodes.push(node); });
  return nodes;
}

const eventValues = [
  { name: 'innerWidth', event: 'resize', initial: 1200, next: 600 },
  { name: 'innerHeight', event: 'resize', initial: 900, next: 700 },
  { name: 'outerWidth', event: 'resize', initial: 1300, next: 900 },
  { name: 'outerHeight', event: 'resize', initial: 1000, next: 800 },
  { name: 'scrollX', event: 'scroll', initial: 0, next: 100 },
  { name: 'scrollY', event: 'scroll', initial: 0, next: 200 },
  { name: 'online', event: 'offline', initial: true, next: false }
] as const;

describe('native reactive window values in scenes', () => {
  it.each(eventValues.flatMap(value => [false, true].map(component => ({ ...value, component }))))
    ('shares $name across keyed snippets and releases its last consumer (component: $component)',
      async ({ name, event, initial, next, component }) => {
    let value: number | boolean = initial;
    if (name === 'online') vi.spyOn(navigator, 'onLine', 'get').mockImplementation(() => Boolean(value));
    else vi.spyOn(window, name, 'get').mockImplementation(() => Number(value));
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    const request = vi.spyOn(window, 'requestAnimationFrame');
    const count = (spy: typeof add) => spy.mock.calls.filter(([type]) => type === event).length;
    expect(windowValues[name].current).toBe(initial);
    expect(count(add)).toBe(0);
    const source = `<mesh name={id} position={[Number(${name}.current ?? 0), id, 0]} {@attach setup}>
      <boxGeometry /><standardMaterial />
    </mesh>`;
    const dependencies = { [name]: windowValues[name] };
    const Child = compileViewportSource(`<script>
      import { ${name} } from 'svelte/reactivity/window';
      let { id, setup } = $props();
    </script>${source}`, dependencies);
    const Scene = compileViewportSource<{ show(id: number, value: boolean): void }>(`<script>
      import { ${name} } from 'svelte/reactivity/window';
      let { Child, setup } = $props();
      const visible = $state([true, true]);
      export function show(id, value) { visible[id] = value; }
    </script>
    {#snippet object(id)}${component ? '<Child {id} {setup} />' : source}{/snippet}
    <scene>
      {#each [0, 1] as id (id)}{#if visible[id]}{@render object(id)}{/if}{/each}
      <mesh name="static"><boxGeometry /><standardMaterial /></mesh>
    </scene>`, dependencies);
    const { root, runtime, changed } = sceneRuntime();
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const instance = mount(Scene, { renderer, target: root, props: { Child, setup } });
    try {
      await settleComponentUpdates();
      expect(count(add)).toBe(1);
      const original = meshes(root), storage = changed.mock.lastCall![0].drawBatches[0].instances;
      expect(original.slice(0, 2).map(node => node.attributes.position)).toEqual([[Number(initial), 0, 0], [Number(initial), 1, 0]]);
      changed.mockClear();
      window.dispatchEvent(new Event(event)); await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();
      value = next;
      window.dispatchEvent(new Event(event)); await settleComponentUpdates();
      expect(changed).toHaveBeenCalledOnce();
      const state = changed.mock.lastCall![0];
      expect(state.drawBatchesChanged).toBe(false);
      expect(state.drawBatches[0].instances).toBe(storage);
      expect(state.instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 2 }]);
      expect(meshes(root)).toEqual(original);
      expect(original.slice(0, 2).map(node => node.attributes.position)).toEqual([[Number(next), 0, 0], [Number(next), 1, 0]]);
      expect(count(add)).toBe(1);
      expect(count(remove)).toBe(0);
      expect(cleanup).not.toHaveBeenCalled();
      flushSync(() => instance.show(0, false)); await settleComponentUpdates();
      expect(count(remove)).toBe(0);
      flushSync(() => instance.show(1, false)); await settleComponentUpdates();
      expect(count(remove)).toBe(1);
      expect(cleanup).toHaveBeenCalledTimes(2);
      changed.mockClear();
      value = initial;
      window.dispatchEvent(new Event(name === 'online' ? 'online' : event)); await settleComponentUpdates();
      expect(changed).not.toHaveBeenCalled();
      flushSync(() => { instance.show(0, true); instance.show(1, true); });
      await settleComponentUpdates();
      expect(count(add)).toBe(2);
      expect(meshes(root)[2]).toBe(original[2]);
      expect(meshes(root)[0].attributes.position).toEqual([Number(initial), 0, 0]);
      expect(request).not.toHaveBeenCalled();
    } finally { await unmount(instance); runtime.dispose(); await settleComponentUpdates(); }
    expect(count(remove)).toBe(2);
    expect(cleanup).toHaveBeenCalledTimes(4);
    if (name === 'online') {
      expect(add.mock.calls.filter(([type]) => type === 'online')).toHaveLength(2);
      expect(remove.mock.calls.filter(([type]) => type === 'online')).toHaveLength(2);
    }
  });

  it.each(['screenLeft', 'screenTop'] as const)('shares the upstream %s polling loop and cancels it after the last consumer', async name => {
    let value = 0, id = 0;
    vi.spyOn(window, name, 'get').mockImplementation(() => value);
    const pending = new Map<number, FrameRequestCallback>();
    const request = vi.fn((callback: FrameRequestCallback) => { pending.set(++id, callback); return id; });
    vi.stubGlobal('requestAnimationFrame', request);
    vi.stubGlobal('cancelAnimationFrame', (key: number) => pending.delete(key));
    const step = async () => {
      const callbacks = [...pending]; pending.clear();
      for (const [, callback] of callbacks) callback(0);
      await settleComponentUpdates();
    };
    expect(windowValues[name].current).toBe(0);
    expect(request).not.toHaveBeenCalled();
    const Scene = compileViewportSource<{ show(id: number, value: boolean): void }>(`<script>
      import { ${name} } from 'svelte/reactivity/window';
      const visible = $state([true, true]);
      export function show(id, value) { visible[id] = value; }
    </script><scene>{#each [0, 1] as id (id)}{#if visible[id]}
      <mesh position={[${name}.current ?? 0, id, 0]}><boxGeometry /><standardMaterial /></mesh>
    {/if}{/each}</scene>`, { [name]: windowValues[name] });
    const { root, runtime, changed } = sceneRuntime();
    const instance = mount(Scene, { renderer, target: root });
    try {
      await settleComponentUpdates();
      expect(pending.size).toBe(1);
      changed.mockClear();
      await step();
      expect(pending.size).toBe(1);
      expect(changed).not.toHaveBeenCalled();
      value = 100; await step();
      expect(changed).toHaveBeenCalledOnce();
      expect(changed.mock.lastCall![0].instanceUpdates![0].dirtyRanges).toEqual([{ start: 0, count: 2 }]);
      flushSync(() => instance.show(0, false)); await settleComponentUpdates();
      expect(pending.size).toBe(1);
      flushSync(() => instance.show(1, false)); await settleComponentUpdates();
      expect(pending.size).toBe(0);
      changed.mockClear(); value = 200; await step();
      expect(changed).not.toHaveBeenCalled();
      flushSync(() => instance.show(0, true)); await settleComponentUpdates();
      expect(meshes(root)[0].attributes.position).toEqual([200, 0, 0]);
      expect(pending.size).toBe(1);
    } finally { await unmount(instance); runtime.dispose(); await settleComponentUpdates(); }
    expect(pending.size).toBe(0);
  });

  it('rearms the module-owned DPR listener without confusing it with scene lifetime', async () => {
    let ratio = window.devicePixelRatio;
    vi.spyOn(window, 'devicePixelRatio', 'get').mockImplementation(() => ratio);
    const second = new EventTarget(), third = new EventTarget();
    const initialRemove = vi.spyOn(resolution.initial, 'removeEventListener');
    const secondAdd = vi.spyOn(second, 'addEventListener'), secondRemove = vi.spyOn(second, 'removeEventListener');
    const thirdAdd = vi.spyOn(third, 'addEventListener'), thirdRemove = vi.spyOn(third, 'removeEventListener');
    const match = vi.spyOn(window, 'matchMedia').mockReturnValueOnce(second as MediaQueryList).mockReturnValueOnce(third as MediaQueryList);
    const Scene = compileViewportSource(`<script>import { devicePixelRatio } from 'svelte/reactivity/window';</script>
      <scene><mesh scale={devicePixelRatio.current ?? 1}><boxGeometry /><standardMaterial /></mesh></scene>`,
      { devicePixelRatio: windowValues.devicePixelRatio });
    const { root, runtime, changed } = sceneRuntime();
    const instance = mount(Scene, { renderer, target: root });
    let disposed = false;
    try {
      await settleComponentUpdates(); changed.mockClear();
      ratio = 2; resolution.initial.dispatchEvent(new Event('change')); await settleComponentUpdates();
      expect(initialRemove).toHaveBeenCalledOnce();
      expect(match).toHaveBeenLastCalledWith('(resolution: 2dppx)');
      expect(secondAdd).toHaveBeenCalledOnce();
      expect(meshes(root)[0].attributes.scale).toBe(2);
      expect(changed).toHaveBeenCalledOnce();
      await unmount(instance); runtime.dispose(); await settleComponentUpdates(); disposed = true;
      expect(secondRemove).not.toHaveBeenCalled();
      changed.mockClear(); ratio = 3; second.dispatchEvent(new Event('change')); await settleComponentUpdates();
      expect(match).toHaveBeenLastCalledWith('(resolution: 3dppx)');
      expect(secondRemove).toHaveBeenCalledOnce(); expect(thirdAdd).toHaveBeenCalledOnce();
      expect(thirdRemove).not.toHaveBeenCalled();
      expect(windowValues.devicePixelRatio.current).toBe(3);
      expect(changed).not.toHaveBeenCalled();
    } finally {
      if (!disposed) { await unmount(instance); runtime.dispose(); await settleComponentUpdates(); }
      vi.restoreAllMocks();
      // Return the module subscription to a real query after restoring native DPR.
      third.dispatchEvent(new Event('change'));
    }
  });

  it('returns undefined for every value on the actual server export without browser globals', () => {
    const names = [...eventValues.map(({ name }) => name), 'screenLeft', 'screenTop', 'devicePixelRatio'];
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import * as values from 'svelte/reactivity/window';
      assert.equal(typeof window, 'undefined');
      for (const name of ${JSON.stringify(names)}) assert.equal(values[name].current, undefined, name);
      console.log('server window values verified');
    `], { cwd: process.cwd(), encoding: 'utf8' });
    expect(output.trim()).toBe('server window values verified');
  });

  it.each(['Tween', 'Spring'])('server-renders a derived %s.of target and records the direct window-read limitation', kind => {
    const component = (derived: boolean) => `<script>
      import { ${kind} } from 'svelte/motion';
      import { innerWidth } from 'svelte/reactivity/window';
      ${derived ? 'const target = $derived(innerWidth.current ?? 800);' : ''}
      const motion = ${kind}.of(() => ${derived ? 'target' : 'innerWidth.current ?? 800'});
    </script><div>{motion.current}</div>`;
    const output = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import assert from 'node:assert/strict';
      import { compile } from 'svelte/compiler';
      import { render } from 'svelte/server';
      import * as server from 'svelte/internal/server';
      import { ${kind} } from 'svelte/motion';
      import { innerWidth } from 'svelte/reactivity/window';
      function component(source) {
        const { js } = compile(source, { filename: 'Probe.svelte', generate: 'server', runes: true });
        const code = js.code.replace(/^import .*;\\n/gm, '').replace('export default function Probe', 'function Probe');
        return new Function('$', '${kind}', 'innerWidth', code + '; return Probe;')(server, ${kind}, innerWidth);
      }
      assert.equal(typeof window, 'undefined');
      assert(render(component(${JSON.stringify(component(true))})).body.includes('<div>800</div>'));
      assert.throws(() => render(component(${JSON.stringify(component(false))})).body, /window is not defined/);
      console.log('server factory target verified');
    `], { cwd: process.cwd(), encoding: 'utf8' });
    expect(output.trim()).toBe('server factory target verified');
  });
});
