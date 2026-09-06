// @vitest-environment happy-dom
import { compile } from 'svelte/compiler';
import { flushSync, mount, settled, tick, unmount, type Component } from 'svelte';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileAsyncTypeGpuSource } from '../../src/component-test-utils';
import { createFragment, walk, type TypeGpuNode } from '../../src/core';
import renderer from '../../src/svelte-renderer';

type Host = 'scene' | 'dom';
const mounted = new Set<ReturnType<typeof mount>>();
afterEach(async () => {
  for (const instance of mounted) await unmount(instance);
  mounted.clear();
  document.body.replaceChildren();
});

function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function finish(request: ReturnType<typeof deferred>, outcome: 'resolve' | 'reject') {
  if (outcome === 'resolve') request.resolve('obsolete');
  else request.reject(new Error('obsolete'));
}

async function fixture<Exports extends Record<string, unknown>>(
  host: Host, source: string, props: Record<string, unknown>
) {
  await import('svelte/internal/flags/async');
  let component: Component<any, Exports>;
  if (host === 'scene') {
    component = await compileAsyncTypeGpuSource<Exports>(source);
  } else {
    const compiled = compile(source, {
      filename: 'AsyncProbe.svelte', generate: 'client', runes: true,
      experimental: { async: true }
    });
    const name = compiled.js.code.match(/export default function (\w+)/)![1];
    const code = compiled.js.code.replace(/^import .*;\n/gm, '')
      .replace(`export default function ${name}`, `function ${name}`);
    component = new Function('$', `${code}\nreturn ${name};`)(client);
  }
  const scheduleSync = vi.fn();
  const root = createFragment();
  root.runtime = { scheduleSync };
  const target = document.createElement('main');
  if (host === 'dom') document.body.append(target);
  const instance = host === 'scene'
    ? mount(component, { renderer, target: root, props })
    : mount(component, { target, props });
  mounted.add(instance);
  await tick();
  return {
    instance, scheduleSync,
    names() {
      if (host === 'dom') return [...target.querySelectorAll('[name]')]
        .map((node) => node.getAttribute('name'));
      const nodes: TypeGpuNode[] = [];
      walk(root, (node) => { if (node.kind === 'element') nodes.push(node); });
      return nodes.map((node) => node.attributes.name);
    },
    async dispose() {
      await unmount(instance);
      mounted.delete(instance);
      expect(host === 'scene' ? root.children.length : target.childNodes.length).toBe(0);
    }
  };
}

describe.each(['scene', 'dom'] as const)('isolated async boundary candidate (%s)', (host) => {
  const tag = host === 'scene' ? 'mesh' : 'div';

  it('defers attachments created during a conditional remount', async () => {
    const first = deferred();
    const next = deferred();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const view = await fixture<{ hide(): void; show(value: Promise<string>): void }>(host, `
      <script>
        let { initial, setup } = $props();
        let request = $state.raw(initial);
        let visible = $state(true);
        export function hide() { visible = false; }
        export function show(value) { request = value; visible = true; }
      </script>
      {#snippet pending()}<${tag} name="pending"></${tag}>{/snippet}
      {#if visible}
        <svelte:boundary {pending}><svelte:boundary>
          <${tag} name={await request} {@attach setup}></${tag}>
        </svelte:boundary></svelte:boundary>
      {/if}
    `, { initial: first.promise, setup });
    first.resolve('first'); await tick(); await settled();
    expect(setup).toHaveBeenCalledOnce();
    flushSync(() => view.instance.hide()); await tick();
    expect(view.names()).toEqual([]);
    expect(cleanup).toHaveBeenCalledOnce();
    flushSync(() => view.instance.show(next.promise)); await tick();
    expect(view.names()).toEqual(['pending']);
    const pendingCalls = setup.mock.calls.length;
    next.resolve('next'); await tick(); await settled();
    expect(view.names()).toEqual(['next']);
    expect(pendingCalls).toBe(1);
    expect(setup).toHaveBeenCalledTimes(2);
    await view.dispose();
    expect(cleanup).toHaveBeenCalledTimes(2);
  });

  it.each(['parent', 'child'] as const)('waits for all pending ancestors when %s resolves first', async (first) => {
    const parent = deferred();
    const child = deferred();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const view = await fixture(host, `
      <script>let { parent, child, setup } = $props();</script>
      {#snippet outerPending()}<${tag} name="outer-pending"></${tag}>{/snippet}
      {#snippet innerPending()}<${tag} name="inner-pending"></${tag}>{/snippet}
      <svelte:boundary pending={outerPending}>
        <${tag} name={await parent}></${tag}>
        <svelte:boundary pending={innerPending}>
          <${tag} name={await child} {@attach setup}></${tag}>
        </svelte:boundary>
      </svelte:boundary>
    `, { parent: parent.promise, child: child.promise, setup });
    expect(view.names()).toEqual(['outer-pending']);
    const requests = { parent, child };
    requests[first].resolve(first);
    await tick();
    expect(view.names()).toEqual(first === 'parent' ? ['parent', 'inner-pending'] : ['outer-pending']);
    const prematureCalls = setup.mock.calls.length;
    const last = first === 'parent' ? 'child' : 'parent';
    requests[last].resolve(last);
    await tick();
    await settled();
    expect(view.names()).toEqual(['parent', 'child']);
    expect(prematureCalls).toBe(0);
    expect(setup).toHaveBeenCalledOnce();
    await view.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it('discards deferred attachments on rejection and starts them once after reset', async () => {
    const first = deferred();
    const next = deferred();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const report = vi.fn();
    const view = await fixture<{ recover(value: Promise<string>): void }>(host, `
      <script>
        let { initial, setup, report } = $props();
        let request = $state.raw(initial);
        let retry;
        function onerror(error, reset) { report(error); retry = reset; }
        export function recover(value) { request = value; retry(); }
      </script>
      {#snippet pending()}<${tag} name="pending"></${tag}>{/snippet}
      {#snippet failed(error)}<${tag} name={error.message}></${tag}>{/snippet}
      <${tag} name="sibling"></${tag}>
      <svelte:boundary {pending} {failed} {onerror}>
        <svelte:boundary>
          <${tag} name={await request} {@attach setup}></${tag}>
        </svelte:boundary>
      </svelte:boundary>
    `, { initial: first.promise, setup, report });
    first.reject(new Error('broken'));
    await tick();
    expect(view.names()).toEqual(['sibling', 'broken']);
    expect(report).toHaveBeenCalledOnce();
    const rejectedCalls = setup.mock.calls.length;
    flushSync(() => view.instance.recover(next.promise));
    await tick();
    expect(view.names()).toEqual(['sibling', 'pending']);
    const retryCalls = setup.mock.calls.length;
    next.resolve('recovered');
    await tick();
    await settled();
    expect(view.names()).toEqual(['sibling', 'recovered']);
    expect(rejectedCalls).toBe(0);
    expect(retryCalls).toBe(0);
    expect(setup).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    await view.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('drains a removed nested boundary into its live parent (%s)', async (outcome) => {
    const request = deferred();
    const setup = vi.fn();
    const view = await fixture<{ hide(): void }>(host, `
      <script>
        let { request, setup } = $props();
        let visible = $state(true);
        export function hide() { visible = false; }
      </script>
      {#snippet pending()}<${tag} name="pending"></${tag}>{/snippet}
      {#snippet failed(error)}<${tag} name="failed"></${tag}>{/snippet}
      <svelte:boundary {pending} {failed}>
        <${tag} name="parent"></${tag}>
        {#if visible}
          <svelte:boundary>
            <${tag} name={await request} {@attach setup}></${tag}>
          </svelte:boundary>
        {/if}
      </svelte:boundary>
    `, { request: request.promise, setup });
    expect(view.names()).toEqual(['pending']);
    const initialCalls = setup.mock.calls.length;
    flushSync(() => view.instance.hide());
    await tick();
    finish(request, outcome);
    await tick();
    await settled();
    expect(view.names()).toEqual(['parent']);
    expect(initialCalls, 'attachments must not run behind an ancestor pending snippet').toBe(0);
    expect(setup.mock.calls.length).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('does not let obsolete keyed work replace a live sibling (%s)', async (outcome) => {
    const first = deferred();
    const second = deferred();
    const cleanup = vi.fn();
    const setup = vi.fn(() => cleanup);
    const view = await fixture<{ replace(value: Promise<string>): void }>(host, `
      <script>
        let { initial, setup } = $props();
        let request = $state.raw(initial);
        export function replace(value) { request = value; }
      </script>
      {#snippet pending()}<${tag} name="pending"></${tag}>{/snippet}
      {#snippet failed(error)}<${tag} name="failed"></${tag}>{/snippet}
      <${tag} name="sibling"></${tag}>
      {#key request}
        <svelte:boundary {pending} {failed}>
          <${tag} name={await request} {@attach setup}></${tag}>
        </svelte:boundary>
      {/key}
    `, { initial: first.promise, setup });
    expect(view.names()).toEqual(['sibling', 'pending']);
    flushSync(() => view.instance.replace(second.promise));
    await tick();
    second.resolve('current');
    await tick();
    expect(view.names()).toEqual(['sibling', 'current']);
    expect(setup).toHaveBeenCalledOnce();
    view.scheduleSync.mockClear();
    finish(first, outcome);
    await tick();
    await settled();
    expect(view.names()).toEqual(['sibling', 'current']);
    expect(setup).toHaveBeenCalledOnce();
    expect(cleanup).not.toHaveBeenCalled();
    expect(view.scheduleSync).not.toHaveBeenCalled();
    await view.dispose();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('discards partially resolved content after unmount (%s)', async (outcome) => {
    const first = deferred();
    const second = deferred();
    const setup = vi.fn();
    const view = await fixture(host, `
      <script>let { first, second, setup } = $props();</script>
      {#snippet pending()}<${tag} name="pending"></${tag}>{/snippet}
      {#snippet failed(error)}<${tag} name="failed"></${tag}>{/snippet}
      <svelte:boundary {pending} {failed}>
        <${tag} name={await first} {@attach setup}></${tag}>
        <${tag} name={await second} {@attach setup}></${tag}>
      </svelte:boundary>
    `, { first: first.promise, second: second.promise, setup });
    first.resolve('first');
    await tick();
    expect(view.names()).toEqual(['pending']);
    expect(setup).not.toHaveBeenCalled();
    await view.dispose();
    view.scheduleSync.mockClear();
    finish(second, outcome);
    await tick();
    await settled();
    expect(view.names()).toEqual([]);
    expect(setup).not.toHaveBeenCalled();
    expect(view.scheduleSync).not.toHaveBeenCalled();
  });
});
