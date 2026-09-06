// @vitest-environment happy-dom
import { compile } from 'svelte/compiler';
import { flushSync, mount, unmount, type Component } from 'svelte';
import * as client from 'svelte/internal/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileViewportSource } from './viewport-test-utils';
import { settleComponentUpdates } from './component-test-utils';
import { createTypeGpuRoot, type TypeGpuRoot } from './svelte-renderer';
import { createFragment } from './core';

vi.mock('./svelte-renderer', async (original) => ({
  ...await original<typeof import('./svelte-renderer')>(), createTypeGpuRoot: vi.fn()
}));

class Observer {
  static instances: Observer[] = [];
  targets = new Map<Element, ResizeObserverOptions | undefined>();
  observe = vi.fn((target: Element, options?: ResizeObserverOptions) => this.targets.set(target, options));
  unobserve = vi.fn((target: Element) => this.targets.delete(target));
  constructor(readonly callback: ResizeObserverCallback) { Observer.instances.push(this); }
  static deliver(target: Element, width: number, height: number) {
    const entry = {
      target, contentRect: new DOMRectReadOnly(0, 0, width, height),
      contentBoxSize: [{ inlineSize: width, blockSize: height }],
      borderBoxSize: [{ inlineSize: width + 2, blockSize: height + 2 }],
      devicePixelContentBoxSize: [{ inlineSize: width * 2, blockSize: height * 2 }]
    } as ResizeObserverEntry;
    // Deliver even after unobserve to exercise queued observer callbacks.
    for (const observer of this.instances) observer.callback([entry], observer as unknown as ResizeObserver);
    return entry;
  }
}

const mounted: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  for (const instance of mounted.splice(0).reverse()) await unmount(instance);
  document.body.replaceChildren();
  expect(Observer.instances.every((observer) => observer.targets.size === 0)).toBe(true);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function native<Exports extends Record<string, unknown>>(source: string): Component<any, Exports> {
  const compiled = compile(source, { filename: 'Native.svelte', runes: true });
  const name = compiled.js.code.match(/export default function (\w+)/)![1];
  const code = compiled.js.code.replace(/^import .*;\n/gm, '')
    .replace(`export default function ${name}`, `function ${name}`);
  return new Function('$', `${code}\nreturn ${name};`)(client);
}

function dimensions(canvas: HTMLCanvasElement, width: number, height: number) {
  for (const [key, value] of Object.entries({ clientWidth: width, clientHeight: height, offsetWidth: width + 2, offsetHeight: height + 2 })) {
    Object.defineProperty(canvas, key, { configurable: true, value });
  }
}

function setup() {
  vi.stubGlobal('ResizeObserver', Observer);
  vi.stubGlobal('requestAnimationFrame', vi.fn());
  vi.mocked(createTypeGpuRoot).mockResolvedValue(Object.assign(createFragment(), { gpu: { setOptions: vi.fn() }, dispose: vi.fn() }) as unknown as TypeGpuRoot);
}

describe('native canvas size bindings', () => {
  it.each([false, true])('matches native measurements and observer lifetimes (viewport: %s)', async (viewport) => {
    setup();
    const source = `<script>
      let { measure, recordHeight } = $props();
      let width = $state(0), clientHeight = $state(0);
      let metrics = $state({ width: 0 });
      let rect = $state.raw();
      let content = $state.raw();
      let border = $state.raw();
      let pixels = $state.raw();
      let label = $state('Preview');
      export function read() { return { width, clientHeight, metrics, rect, content, border, pixels }; }
      export function replace() { metrics = { width: -1 }; label = 'Changed'; }
      export function overwrite() { width = 7; }
    </script>
    <canvas aria-label={label} {@attach measure}
      bind:clientWidth={width} bind:clientHeight
      bind:offsetWidth={metrics.width} bind:offsetHeight={null, recordHeight}
      bind:contentRect={rect} bind:contentBoxSize={content}
      bind:borderBoxSize={border} bind:devicePixelContentBoxSize={pixels} />`;
    type Exports = { read(): any; replace(): void; overwrite(): void };
    const Component = viewport ? compileViewportSource<Exports>(source) : native<Exports>(source);
    const recordHeight = vi.fn();
    const measure = vi.fn((canvas: HTMLCanvasElement) => dimensions(canvas, 320, 180));
    const instance = mount(Component, { target: document.body, props: { measure, recordHeight } });
    mounted.push(instance);
    await settleComponentUpdates(); await settleComponentUpdates();
    const canvas = document.querySelector('canvas')!;
    expect(instance.read()).toMatchObject({ width: 320, clientHeight: 180, metrics: { width: 322 } });
    expect(instance.read().rect).toBeUndefined();
    expect(recordHeight).toHaveBeenCalledExactlyOnceWith(182);
    const observers = Observer.instances.filter((observer) => observer.targets.has(canvas));
    expect(observers).toHaveLength(3);
    expect(observers.map((observer) => observer.targets.get(canvas)?.box).sort())
      .toEqual(['border-box', 'content-box', 'device-pixel-content-box']);
    const subscriptions = Observer.instances.reduce((sum, observer) => sum + observer.observe.mock.calls.length, 0);
    const previous = instance.read().metrics;
    flushSync(() => { instance.replace(); instance.overwrite(); });
    expect(instance.read().width).toBe(7);
    expect(canvas.clientWidth).toBe(320); // Read-only: consumer writes never change layout.
    dimensions(canvas, 640, 360);
    const entry = Observer.deliver(canvas, 640, 360);
    await settleComponentUpdates();
    expect(instance.read()).toMatchObject({ width: 640, clientHeight: 360, metrics: { width: 642 } });
    expect(previous.width).toBe(322);
    expect(instance.read().rect).toBe(entry.contentRect);
    expect(instance.read().content).toBe(entry.contentBoxSize);
    expect(instance.read().border).toBe(entry.borderBoxSize);
    expect(instance.read().pixels).toBe(entry.devicePixelContentBoxSize);
    expect(recordHeight).toHaveBeenLastCalledWith(362);
    expect(measure).toHaveBeenCalledOnce();
    expect(Observer.instances.reduce((sum, observer) => sum + observer.observe.mock.calls.length, 0)).toBe(subscriptions);
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    await unmount(instance); mounted.pop();
    expect(observers.every((observer) => !observer.targets.has(canvas))).toBe(true);
    recordHeight.mockClear();
    Observer.deliver(canvas, 800, 400);
    expect(recordHeight).not.toHaveBeenCalled();
  });

  it.each([false, true])('captures function setters once without subscribing to their reads (viewport: %s)', async (viewport) => {
    setup();
    const source = `<script>
      let { first, second } = $props();
      let chosen = $state(first), reads = $state(0);
      function capture() { reads += 1; return chosen; }
      export function switchSetter() { chosen = second; }
      export function count() { return reads; }
    </script><canvas bind:clientWidth={null, capture()} />`;
    type Exports = { switchSetter(): void; count(): number };
    const Component = viewport ? compileViewportSource<Exports>(source) : native<Exports>(source);
    const first = vi.fn(), second = vi.fn();
    const instance = mount(Component, { target: document.body, props: { first, second } });
    mounted.push(instance);
    await settleComponentUpdates(); await settleComponentUpdates();
    flushSync(() => instance.switchSetter());
    const canvas = document.querySelector('canvas')!;
    dimensions(canvas, 500, 300);
    Observer.deliver(canvas, 500, 300);
    await settleComponentUpdates();
    expect(instance.count()).toBe(1);
    expect(first).toHaveBeenLastCalledWith(500);
    expect(second).not.toHaveBeenCalled();
  });

  it('shares observations between viewports and removes only the disposed viewport', async () => {
    setup();
    const Component = compileViewportSource(`<script>let { size } = $props();</script><canvas bind:clientWidth={null, size} />`);
    const first = vi.fn(), second = vi.fn();
    const a = mount(Component, { target: document.body, props: { size: first } });
    const b = mount(Component, { target: document.body, props: { size: second } });
    mounted.push(a, b);
    await settleComponentUpdates(); await settleComponentUpdates();
    const [left, right] = document.querySelectorAll('canvas');
    const observers = Observer.instances.filter((observer) => observer.targets.has(left));
    expect(observers).toHaveLength(1);
    expect(observers[0].targets.has(right)).toBe(true);
    await unmount(b); mounted.pop();
    expect(observers[0].targets.has(left)).toBe(true);
    expect(observers[0].targets.has(right)).toBe(false);
    first.mockClear(); second.mockClear();
    dimensions(left, 700, 400);
    Observer.deliver(left, 700, 400);
    Observer.deliver(right, 700, 400);
    expect(first).toHaveBeenCalledExactlyOnceWith(700);
    expect(second).not.toHaveBeenCalled();
  });
});
