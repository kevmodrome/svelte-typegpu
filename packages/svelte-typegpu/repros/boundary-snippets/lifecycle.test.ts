// @vitest-environment happy-dom
import { createRequire } from 'node:module';
import { compile } from 'svelte/compiler';
import { flushSync, mount, unmount, type Component } from 'svelte';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileTypeGpu } from '../../compiler/index';
import { createFragment, dispatchNodeEvent, walk, type TypeGpuNode } from '../../src/core';
import { settleComponentUpdates } from '../../src/component-test-utils';
import renderer from '../../src/svelte-renderer';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

const modes = (process.env.NODE_ENV === 'production' ? [false] : [false, true])
  .flatMap(dev => ['dom', 'scene'].map(host => ({ dev, host })));
function component<Exports extends Record<string, unknown>>(source: string, host: string, dev: boolean) {
  const options = { filename: 'Boundary.typegpu.svelte', runes: true, dev, hmr: false,
    experimental: host === 'scene' ? { customRenderer: 'svelte-typegpu/svelte-renderer' } : {} };
  const compiled = compile(source, options);
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  return new Function('$', '$renderer', `${code}\nreturn ${name};`)(client, renderer) as Component<any, Exports>;
}
function elements(root: TypeGpuNode | HTMLElement, host: string) {
  if (host === 'dom') return [...(root as HTMLElement).querySelectorAll('[name]')];
  const nodes: TypeGpuNode[] = [];
  walk(root as TypeGpuNode, node => { if (node.kind === 'element' && node.attributes.name) nodes.push(node); });
  return nodes;
}
const nameOf = (node: TypeGpuNode | Element) => 'getAttribute' in node ? node.getAttribute('name') : node.attributes.name;

describe('inline boundary snippet candidate', () => {
  it.each(modes)('retains native constant scope, reactive fallback and cleanup ($host, dev $dev)', async ({ host, dev }) => {
    const tag = host === 'scene' ? 'mesh' : 'div';
    const Scene = component<{ fail(): void; rename(value: string): void }>(`<script>
      let { setup, report } = $props();
      let broken = $state(false), label = $state('first');
      function read() { if (broken) throw new Error('broken'); return label; }
      export function fail() { broken = true; }
      export function rename(value) { label = value; }
    </script>
    <${tag} name="sibling" />
    <svelte:boundary onerror={report}>
      {@const local = label.toUpperCase()}
      <${tag} name={read()} {@attach setup('ready')} />
      {#snippet failed(error, reset)}
        {@render message(error.message)}
        <${tag} name="reset" onclick={() => { broken = false; reset(); }} />
      {/snippet}
      {#snippet message(value)}
        <${tag} name={local + ':' + value} {@attach setup('failed')} />
      {/snippet}
    </svelte:boundary>`, host, dev);
    const log: string[] = [];
    const setup = (phase: string) => () => { log.push(`attach:${phase}`); return () => { log.push(`detach:${phase}`); }; };
    const report = vi.fn();
    const root = host === 'scene' ? createFragment() : document.body;
    const instance = host === 'scene'
      ? mount(Scene, { target: root as TypeGpuNode, renderer, props: { setup, report } })
      : mount(Scene, { target: root as HTMLElement, props: { setup, report } });
    try {
      await settleComponentUpdates();
      const sibling = elements(root, host)[0];
      expect(elements(root, host).map(nameOf)).toEqual(['sibling', 'first']);
      flushSync(() => instance.fail()); await settleComponentUpdates();
      expect(report).toHaveBeenCalledExactlyOnceWith(new Error('broken'), expect.any(Function));
      expect(elements(root, host).map(nameOf)).toEqual(['sibling', 'FIRST:broken', 'reset']);
      expect(log).toEqual(['attach:ready', 'detach:ready', 'attach:failed']);
      flushSync(() => instance.rename('second')); await settleComponentUpdates();
      expect(elements(root, host).map(nameOf)).toEqual(['sibling', 'SECOND:broken', 'reset']);
      const reset = elements(root, host).at(-1)!;
      if (host === 'scene') dispatchNodeEvent(reset as TypeGpuNode, 'click');
      else (reset as HTMLElement).click();
      await settleComponentUpdates();
      expect(elements(root, host).map(nameOf)).toEqual(['sibling', 'second']);
      expect(elements(root, host)[0]).toBe(sibling);
    } finally { await unmount(instance); }
    expect(log).toEqual(['attach:ready', 'detach:ready', 'attach:failed', 'detach:failed', 'attach:ready', 'detach:ready']);
  });

  it.each(modes)('escalates errors from inline failure content to the parent ($host, dev $dev)', async ({ host, dev }) => {
    const tag = host === 'scene' ? 'mesh' : 'div';
    const Scene = component(`
      <script>let { outer, inner } = $props(); function fail(message) { throw new Error(message); }</script>
      <svelte:boundary onerror={outer}>
        <svelte:boundary onerror={inner}>
          <${tag} name={fail('content')} />
          {#snippet failed(error)}<${tag} name={fail('fallback:' + error.message)} />{/snippet}
        </svelte:boundary>
        {#snippet failed(error)}<${tag} name={error.message} />{/snippet}
      </svelte:boundary>`, host, dev);
    const root = host === 'scene' ? createFragment() : document.body;
    const outer = vi.fn(), inner = vi.fn();
    const instance = host === 'scene'
      ? mount(Scene, { target: root as TypeGpuNode, renderer, props: { outer, inner } })
      : mount(Scene, { target: root as HTMLElement, props: { outer, inner } });
    try {
      await settleComponentUpdates();
      expect(inner).toHaveBeenCalledExactlyOnceWith(new Error('content'), expect.any(Function));
      expect(outer).toHaveBeenCalledExactlyOnceWith(new Error('fallback:content'), expect.any(Function));
      expect(elements(root, host).map(nameOf)).toEqual(['fallback:content']);
    } finally { await unmount(instance); }
  });

  it.each([false, true].flatMap(dev => [false, true].map(async => ({ dev, async }))))
    ('compiles inline pending/helper snippets with renderer tags (dev $dev, async $async)', ({ dev, async }) => {
      const source = `<svelte:boundary>
        {@const value = 1}
        {#snippet pending()}<mesh name="pending" />{/snippet}
        {#snippet item(number)}<mesh name={value + number} />{/snippet}
        {#snippet failed(error)}<mesh name={error.message} />{/snippet}
        {@render item(2)}
      </svelte:boundary>`;
      const result = compileTypeGpu(source, { filename: 'Inline.typegpu.svelte', dev, experimental: { async } });
      expect(result.js.code).toContain('$.renderer_snippet($renderer');
      expect(result.js.code).toContain('$.boundary(');
    });

  it.each(modes.filter(mode => mode.host === 'scene'))('retains renderer ownership on every inline snippet (dev $dev)', async ({ dev }) => {
    const capture = vi.fn(() => 'ready');
    const Scene = component(`<script>let { capture } = $props();</script>
      <svelte:boundary>
        {#snippet failed(error)}<mesh name={error.message} />{/snippet}
        {#snippet pending()}<mesh name="pending" />{/snippet}
        {#snippet item()}<mesh name="item" />{/snippet}
        <mesh name={capture(failed, pending, item)} />
      </svelte:boundary>`, 'scene', dev);
    const instance = mount(Scene, { renderer, target: createFragment(), props: { capture } });
    try {
      await settleComponentUpdates();
      expect(capture).toHaveBeenCalledOnce();
      for (const snippet of capture.mock.calls[0] as unknown as Array<(() => void) & { __renderer: unknown }>) {
        expect(snippet.__renderer).toBe(renderer);
        expect(() => snippet()).toThrow(/snippet_renderer_mismatch/);
      }
    } finally { await unmount(instance); }
  });

  it.each([false, true])('keeps native compiler output unchanged (dev $dev)', dev => {
    // The package's CommonJS compiler is an untouched native-output baseline.
    const original = createRequire(import.meta.url)('svelte/compiler') as typeof import('svelte/compiler');
    const source = '<script>let { n } = $props();</script><svelte:boundary>{@const x = n * 2}' +
      '{#snippet failed(error)}<p>{x}: {error.message}</p>{/snippet}<p>{x}</p></svelte:boundary>';
    const options = { filename: 'Native.svelte', dev, hmr: false };
    expect(compile(source, options).js.code).toBe(original.compile(source, options).js.code);
  });

  it('rejects component lowering as a replacement for native boundary constant scope', async () => {
    const Wrapper = component('<script>let { failed, children } = $props();</script>' +
      '<svelte:boundary {failed}>{@render children()}</svelte:boundary>', 'dom', false);
    for (const tag of ['svelte:boundary', 'Wrapper']) {
      const Parent = component(`<script>
        let { Wrapper, report } = $props(); let value = $state(1);
        function fail() { throw new Error('content'); }
      </script>
      <svelte:boundary onerror={report}>
        <${tag}>
          {@const local = value}
          {#snippet failed(error)}<p name={local + ':' + error.message} />{/snippet}
          <p name={fail()} />
        </${tag}>
      </svelte:boundary>`, 'dom', false);
      const report = vi.fn();
      const instance = mount(Parent, { target: document.body, props: { Wrapper, report } });
      try {
        await settleComponentUpdates();
        if (tag === 'svelte:boundary') {
          expect(report).not.toHaveBeenCalled();
          expect(document.querySelector('p')?.getAttribute('name')).toBe('1:content');
        } else {
          expect(report).toHaveBeenCalledExactlyOnceWith(expect.any(ReferenceError), expect.any(Function));
          expect(document.querySelector('p')).toBeNull();
        }
      } finally { await unmount(instance); }
    }
  });

  it('omits inline fallback and scene constants from viewport SSR', () => {
    const result = compileTypeGpu('<canvas><scene><svelte:boundary>{@const n = unavailableOnServer()}' +
      '<mesh name={n} />{#snippet failed(error)}<mesh name={error.message} />{/snippet}' +
      '</svelte:boundary></scene></canvas>', { filename: 'Server.typegpu.svelte', generate: 'server' });
    expect(result.js.code).not.toContain('unavailableOnServer');
    expect(result.js.code).not.toContain('renderer_snippet');
    expect(result.js.code).not.toContain('error.message');
  });

  it.each(['<svelte:boundary unknown={true} />', '<svelte:boundary failed="invalid" />'])
    ('retains native boundary attribute diagnostics for %s', source => {
      expect(() => compileTypeGpu(source, { filename: 'Invalid.typegpu.svelte' }))
        .toThrow(/svelte_boundary_invalid_attribute/);
    });
});
