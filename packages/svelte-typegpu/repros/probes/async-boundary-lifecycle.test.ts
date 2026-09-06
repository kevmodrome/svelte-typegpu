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
