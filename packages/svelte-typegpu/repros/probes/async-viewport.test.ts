// @vitest-environment happy-dom
import { compile } from 'svelte/compiler';
import { flushSync, getContext, mount, unmount, type Component } from 'svelte';
import * as client from 'svelte/internal/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileAsyncViewportSource } from '../../src/viewport-test-utils';
import { settleComponentUpdates } from '../../src/component-test-utils';
import { createFragment, walk, type TypeGpuNode } from '../../src/core';
import { createTypeGpuRoot, type TypeGpuRoot } from '../../src/svelte-renderer';

vi.mock('../../src/svelte-renderer', async (original) => ({
  ...await original<typeof import('../../src/svelte-renderer')>(), createTypeGpuRoot: vi.fn()
}));
const mounted = new Set<ReturnType<typeof mount>>();
afterEach(async () => {
  for (const instance of mounted) await unmount(instance);
  mounted.clear();
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.mocked(createTypeGpuRoot).mockReset();
});

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function meshes(root: TypeGpuNode) {
  const result: TypeGpuNode[] = [];
  walk(root, (node) => { if (node.name === 'mesh') result.push(node); });
  return result;
}

type ParentExports = { update(value: Promise<string>): void; recover(value: Promise<string>): void };
async function fixture(mode: 'attribute' | 'derived', dev: boolean) {
  const request = deferred();
  const root = Object.assign(createFragment(), {
    runtime: { scheduleSync: vi.fn() },
    gpu: { setOptions: vi.fn() }, dispose: vi.fn()
  }) as unknown as TypeGpuRoot;
  vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
  const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
  const nativeCleanup = vi.fn(), nativeSetup = vi.fn(() => nativeCleanup);
  const report = vi.fn();
  const Viewport = await compileAsyncViewportSource(`<script>
    let { request, nativeSetup, setup, get } = $props();
    ${mode === 'derived' ? 'let label = $derived(await request);' : ''}
    const color = get('theme');
  </script>
  <canvas aria-label={${mode === 'derived' ? 'label' : 'await request'}} {@attach nativeSetup}
    bind:clientWidth={null, () => {}}>
    <scene><mesh name="ready" {color} {@attach setup} /></scene>
  </canvas>
  <style>canvas { height: 420px; }</style>`, {}, dev);
  const compiled = compile(`<script>
    let { Viewport, initial, setup, nativeSetup, report, get } = $props();
    let request = $state.raw(initial);
    let retry;
    function onerror(error, reset) { report(error); retry = reset; }
    export function update(value) { request = value; }
    export function recover(value) { request = value; retry(); }
  </script>
  {#snippet pending()}<p data-status="pending">Loading</p>{/snippet}
  {#snippet failed(error)}<p data-status="failed">{error.message}</p>{/snippet}
  <svelte:boundary {pending} {failed} {onerror}>
    <Viewport {request} {setup} {nativeSetup} {get} />
  </svelte:boundary>`, {
    filename: 'AsyncViewportParent.svelte', runes: true, dev, experimental: { async: true }
  });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  const Parent: Component<any, ParentExports> = new Function('$', `${code}\nreturn ${name};`)(client);
  const instance = mount(Parent, {
    target: document.body, context: new Map([['theme', [1, 0, 0]]]),
    props: { Viewport, initial: request.promise, setup, nativeSetup, report, get: getContext }
  });
  mounted.add(instance);
  await settleComponentUpdates();
  expect(document.querySelector('[data-status="pending"]')).not.toBeNull();
  expect(document.querySelector('canvas')).toBeNull();
  expect(createTypeGpuRoot).not.toHaveBeenCalled();
  expect(nativeSetup).not.toHaveBeenCalled();
  expect(setup).not.toHaveBeenCalled();
  return { instance, request, root, setup, cleanup, nativeSetup, nativeCleanup, report,
    async dispose() { await unmount(instance); mounted.delete(instance); }
  };
}

describe.each(['attribute', 'derived'] as const)('async native canvas %s', (mode) => {
  it.each([false, true])('retains its canvas/root across async prop updates (dev %s)', async (dev) => {
    const view = await fixture(mode, dev);
    view.request.resolve('first');
    await settleComponentUpdates(); await settleComponentUpdates();
    const canvas = document.querySelector('canvas')!;
    expect(canvas).not.toBeNull();
    expect(canvas.getAttribute('aria-label')).toBe('first');
    expect(document.querySelector('scene, mesh')).toBeNull();
    expect(view.nativeSetup).toHaveBeenCalledExactlyOnceWith(canvas);
    expect([...canvas.classList].some((name) => name.startsWith('typegpu-'))).toBe(true);
    const mesh = meshes(view.root)[0];
    expect(mesh.attributes.color).toEqual([1, 0, 0]);
    expect(view.setup).toHaveBeenCalledExactlyOnceWith(mesh);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();

    const next = deferred();
    flushSync(() => view.instance.update(next.promise));
    await settleComponentUpdates();
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(canvas.getAttribute('aria-label')).toBe('first');
    next.resolve('next');
    await settleComponentUpdates();
    expect(canvas.getAttribute('aria-label')).toBe('next');
    expect(meshes(view.root)).toEqual([mesh]);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(view.setup).toHaveBeenCalledOnce();
    expect(view.nativeSetup).toHaveBeenCalledOnce();
    expect(view.root.dispose).not.toHaveBeenCalled();
    await view.dispose();
    expect(view.cleanup).toHaveBeenCalledOnce();
    expect(view.nativeCleanup).toHaveBeenCalledOnce();
    expect(view.root.dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('canvas')).toBeNull();
  });

  it('recovers from a rejected canvas prop without allocating an offscreen GPU root', async () => {
    const view = await fixture(mode, false);
    const failure = new Error('load failed');
    view.request.reject(failure);
    await settleComponentUpdates();
    expect(document.querySelector('[data-status="failed"]')?.textContent).toBe('load failed');
    expect(view.report).toHaveBeenCalledExactlyOnceWith(failure);
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    const retry = deferred();
    flushSync(() => view.instance.recover(retry.promise));
    await settleComponentUpdates();
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    retry.resolve('recovered');
    await settleComponentUpdates(); await settleComponentUpdates();
    expect(document.querySelector('canvas')?.getAttribute('aria-label')).toBe('recovered');
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(view.setup).toHaveBeenCalledOnce();
    await view.dispose();
    expect(view.cleanup).toHaveBeenCalledOnce();
    expect(view.root.dispose).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('ignores a late initial %s after unmount', async (outcome) => {
    const view = await fixture(mode, false);
    await view.dispose();
    if (outcome === 'resolve') view.request.resolve('obsolete');
    else view.request.reject(new Error('obsolete'));
    await settleComponentUpdates();
    expect(document.querySelector('canvas')).toBeNull();
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(view.setup).not.toHaveBeenCalled();
    expect(view.nativeSetup).not.toHaveBeenCalled();
    expect(view.report).not.toHaveBeenCalled();
  });
});
