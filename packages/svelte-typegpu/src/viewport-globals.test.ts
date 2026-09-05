// @vitest-environment happy-dom
import { compile } from 'svelte/compiler';
import { mount, tick, unmount, type Component } from 'svelte';
import { on } from 'svelte/events';
import * as client from 'svelte/internal/client';
import 'svelte/internal/init-operations';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileTypeGpu } from '../compiler/index';

const filename = 'Viewport.typegpu.svelte';
const mounted: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0).reverse()) await unmount(instance);
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function native(source: string): Component<any> {
  const compiled = compile(source, { filename: 'Native.svelte', runes: true });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  return new Function('$', `${code}\nreturn ${name};`)(client);
}

describe('viewport global-element feasibility', () => {
  it.each([
    '<svelte:window onkeydown={() => {}} />',
    '<script>let width = $state(0);</script><svelte:window bind:innerWidth={width} />',
    '<svelte:document onvisibilitychange={() => {}} />',
    '<svelte:body onpointerup={() => {}} />'
  ])('records the upstream rejection, not just our canvas-root restriction: %s', (source) => {
    expect(() => compile(source, { filename, runes: true })).not.toThrow();
    let failure: unknown;
    try {
      compile(source, {
        filename, runes: true,
        experimental: { customRenderer: 'svelte-typegpu/svelte-renderer' }
      });
    } catch (error) { failure = error; }
    expect(failure).toMatchObject({ code: 'incompatible_with_custom_renderer' });
    expect(() => compileTypeGpu(`${source}<canvas />`, { filename, runes: true }))
      .toThrow(/one unconditional top-level <canvas>/);
  });

  it.each([false, true])('compares native parent registration with canvas attachment timing (attachment: %s)', async (attachment) => {
    const contexts: boolean[] = [];
    const record = vi.fn(function (this: EventTarget, event: Event) {
      contexts.push(this === event.currentTarget);
    });
    const cleanup = vi.fn();
    const setup = vi.fn(() => {
      const remove = on(window, 'keydown', record);
      return () => { remove(); cleanup(); };
    });
    const Host = native(`<script>
      let { setup } = $props();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    </script><canvas {@attach setup} />`);
    const Parent = native(`<script>let { Host, record, setup } = $props();</script>
      ${attachment ? '' : '<svelte:window onkeydown={record} />'}
      <Host setup={setup} />`);
    const instance = mount(Parent, {
      target: document.body,
      props: { Host, record, setup: attachment ? setup : undefined }
    });
    mounted.push(instance);
    await tick();
    // A global handler must already exist while the child runs its script.
    expect(record).toHaveBeenCalledTimes(attachment ? 0 : 1);
    record.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(record).toHaveBeenCalledOnce();
    expect(contexts.every(Boolean)).toBe(true);
    await unmount(instance); mounted.pop();
    record.mockClear();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(record).not.toHaveBeenCalled();
    expect(setup).toHaveBeenCalledTimes(attachment ? 1 : 0);
    expect(cleanup).toHaveBeenCalledTimes(attachment ? 1 : 0);
  });
});
