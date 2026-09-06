// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import MagicString from 'magic-string';
import { compile } from 'svelte/compiler';
import { render } from 'svelte/server';
import * as svelteServer from 'svelte-test/server';
import { flushSync, getContext, hydrate, unmount, type Component } from 'svelte';
import * as client from 'svelte/internal/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileTypeGpu } from '../../compiler/index';
import { compileAsyncViewportSource } from '../../src/viewport-test-utils';
import { settleComponentUpdates } from '../../src/component-test-utils';
import { createFragment, walk, type TypeGpuNode } from '../../src/core';
import { createTypeGpuRoot, type TypeGpuRoot } from '../../src/svelte-renderer';
import * as canvasBindings from '../../src/canvas-bindings';

vi.mock('../../src/svelte-renderer', async (original) => ({
  ...await original<typeof import('../../src/svelte-renderer')>(), createTypeGpuRoot: vi.fn()
}));
const mounted = new Set<ReturnType<typeof hydrate>>();
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
type Controls = { reference(): HTMLCanvasElement | null | undefined; update(value: Promise<string>): void };
async function components(mode: 'attribute' | 'derived', dev: boolean) {
  await import('svelte/internal/flags/async');
  const source = `<script>
    let { initial, sceneWork, setup, nativeSetup, measure, keydown, get, onready } = $props();
    let request = $state.raw(initial);
    let canvas = $state();
    ${mode === 'derived' ? 'let label = $derived(await request);' : ''}
    const theme = get('theme');
    export function reference() { return canvas; }
    export function update(value) { request = value; }
  </script>
  {#snippet pending()}<mesh name="pending" />{/snippet}
  <canvas aria-label={${mode === 'derived' ? 'label' : 'await request'}} data-theme={theme}
    bind:this={canvas} bind:clientWidth={null, measure} tabindex="0"
    onkeydown={keydown} {@attach nativeSetup} {onready}>
    <scene><svelte:boundary {pending}>
      <mesh name={await sceneWork()} {@attach setup} />
    </svelte:boundary></scene>
  </canvas>
  <style>canvas { height: 420px; }</style>`;
  const server = await vi.importActual<Record<string, unknown>>('svelte/internal/server');
  function evaluate(code: string, dependencies: Record<string, unknown>, runtime = server): Component<any> {
    const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'module' });
    const output = new MagicString(code);
    let name: string | undefined;
    for (const node of ast.body) {
      if (node.type === 'ImportDeclaration') output.remove(node.start, node.end);
      if (node.type !== 'ExportDefaultDeclaration') continue;
      if (node.declaration.type === 'FunctionDeclaration') {
        name = node.declaration.id?.name;
        output.remove(node.start, node.declaration.start);
      } else if (node.declaration.type === 'Identifier') {
        name = node.declaration.name;
        output.remove(node.start, node.end);
      }
    }
    if (!name) throw new Error('Unsupported server component export in hydration probe');
    return new Function('$', ...Object.keys(dependencies), `${output}\nreturn ${name};`)(
      runtime, ...Object.values(dependencies)
    );
  }
  const initialize = vi.fn();
  const hostPath = join(dirname(fileURLToPath(import.meta.url)), '../../src/ViewportCanvas.svelte');
  const hostSource = readFileSync(hostPath, 'utf8');
  const Host = evaluate(compile(hostSource, {
    filename: hostPath, generate: 'server', runes: true, dev, experimental: { async: true }
  }).js.code, {
    getAllContexts: svelteServer.getAllContexts, onMount: svelteServer.onMount, startCanvasScene: initialize
  });
  const Server = evaluate(compileTypeGpu(source, {
    filename: 'Viewport.typegpu.svelte', generate: 'server', runes: true, dev, experimental: { async: true }
  }).js.code, { TypeGpuViewportCanvas: Host, TypeGpuCanvasBindings: canvasBindings });
  const Client = await compileAsyncViewportSource<Controls>(source, {}, dev);
  return { Server, Client, initialize,
    pendingParent(host: 'viewport' | 'native' | 'component') {
      const parent = `<script>
        import Viewport from './Viewport.typegpu.svelte';
        let { initial, onPending, report, ...props } = $props();
        let request = $state.raw(initial);
        let retry;
        function onerror(error, reset) { report(error); retry = reset; }
        export function recover(value) { request = value; retry(); }
      </script>
      {#snippet pending()}<p data-status="pending" {@attach onPending}>Loading canvas</p>{/snippet}
      {#snippet failed(error)}<p data-status="failed">{error.message}</p>{/snippet}
      <svelte:boundary {pending} {failed} {onerror}><Viewport {...props} initial={request} /></svelte:boundary>`;
      const compileParent = (generate: 'client' | 'server') => {
        const runtime = generate === 'server' ? server : client;
        const options = { filename: 'NativeCanvas.svelte', generate, runes: true, dev, experimental: { async: true } };
        const NativeCanvasHost = host === 'component' ? evaluate(compile(`<script>
          let { children, ...attributes } = $props();
          const { class: canvasClass, ...nativeAttributes } = $derived(attributes);
        </script><canvas {...nativeAttributes} class={canvasClass}></canvas>`, options).js.code, {}, runtime) : null;
        const tag = host === 'component' ? 'NativeCanvasHost' : 'canvas';
        const Native = host !== 'viewport' ? evaluate(compile(`<script>
          let { initial, nativeSetup } = $props();
          let request = $state.raw(initial);
          ${mode === 'derived' ? 'let label = $derived(await request);' : ''}
        </script><${tag} aria-label={${mode === 'derived' ? 'label' : 'await request'}} {@attach nativeSetup}></${tag}>`,
          options).js.code, { NativeCanvasHost }, runtime) : null;
        return evaluate(compile(parent, {
          filename: 'AsyncViewportParent.svelte', generate, runes: true, dev, experimental: { async: true }
        }).js.code, { Viewport: Native ?? (generate === 'server' ? Server : Client) }, runtime);
      };
      return { Server: compileParent('server'), Client: compileParent('client') as Component<any, {
        recover(value: Promise<string>): void
      }> };
    }
  };
}

describe.each(['attribute', 'derived'] as const)('async canvas hydration (%s)', (mode) => {
  it.each((['viewport', 'native', 'component'] as const).flatMap(host => [false, true].flatMap(dev =>
    ['resolve', 'reject'].map(outcome => ({ host, dev, outcome })))))
    ('hydrates a server pending boundary before $outcome ($host, dev $dev)', async ({ host, dev, outcome }) => {
    const viewport = await components(mode, dev);
    const { Server, Client } = viewport.pendingParent(host);
    const request = deferred();
    const sceneWork = vi.fn(() => Promise.resolve('ready'));
    const pendingCleanup = vi.fn(), onPending = vi.fn(() => pendingCleanup);
    const nativeCleanup = vi.fn(), nativeSetup = vi.fn(() => nativeCleanup);
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const measure = vi.fn(), report = vi.fn();
    const props = { initial: request.promise, sceneWork, onPending, nativeSetup, setup, measure, report };
    const context = new Map([['theme', 'test-theme']]);
    const html = await render(Server, { props: { ...props, get: svelteServer.getContext }, context });
    expect(html.body).toContain('Loading canvas');
    expect(html.body).not.toContain('<canvas');
    expect(sceneWork).not.toHaveBeenCalled();
    expect(onPending).not.toHaveBeenCalled();
    expect(viewport.initialize).not.toHaveBeenCalled();
    document.body.innerHTML = html.body;
    const pending = document.querySelector('[data-status="pending"]')!;
    const root = Object.assign(createFragment(), {
      runtime: { scheduleSync: vi.fn() }, gpu: { setOptions: vi.fn() }, dispose: vi.fn()
    }) as unknown as TypeGpuRoot;
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const instance = hydrate(Client, {
      target: document.body, recover: false, context, props: { ...props, get: getContext }
    });
    mounted.add(instance);
    await settleComponentUpdates();
    expect(document.querySelector('[data-status="pending"]')).toBe(pending);
    expect(onPending).toHaveBeenCalledExactlyOnceWith(pending);
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(nativeSetup).not.toHaveBeenCalled();
    expect(sceneWork).not.toHaveBeenCalled();
    let pendingMounts = 1;
    if (outcome === 'reject') {
      const failure = new Error('client load failed');
      request.reject(failure); await settleComponentUpdates();
      expect(document.querySelector('[data-status="failed"]')?.textContent).toBe(failure.message);
      expect(report).toHaveBeenCalledExactlyOnceWith(failure);
      expect(pendingCleanup).toHaveBeenCalledOnce();
      expect(createTypeGpuRoot).not.toHaveBeenCalled();
      expect(document.querySelectorAll('canvas'), document.body.innerHTML).toHaveLength(0);
      const retry = deferred();
      flushSync(() => instance.recover(retry.promise)); await settleComponentUpdates();
      expect(document.querySelector('[data-status="pending"]')).not.toBeNull();
      expect(createTypeGpuRoot).not.toHaveBeenCalled();
      retry.resolve('Client canvas');
      pendingMounts = 2;
    } else request.resolve('Client canvas');
    await settleComponentUpdates(); await settleComponentUpdates();
    const canvas = document.querySelector('canvas');
    expect(canvas?.getAttribute('aria-label'), document.body.innerHTML).toBe('Client canvas');
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(document.querySelector('[data-status]')).toBeNull();
    expect(createTypeGpuRoot).toHaveBeenCalledTimes(host === 'viewport' ? 1 : 0);
    expect(nativeSetup).toHaveBeenCalledExactlyOnceWith(canvas);
    expect(sceneWork).toHaveBeenCalledTimes(host === 'viewport' ? 1 : 0);
    if (host === 'viewport') expect(setup).toHaveBeenCalledExactlyOnceWith(meshes(root)[0]);
    else expect(setup).not.toHaveBeenCalled();
    expect(onPending).toHaveBeenCalledTimes(pendingMounts);
    expect(pendingCleanup).toHaveBeenCalledTimes(pendingMounts);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await unmount(instance); mounted.delete(instance);
    expect(nativeCleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledTimes(host === 'viewport' ? 1 : 0);
    expect(root.dispose).toHaveBeenCalledTimes(host === 'viewport' ? 1 : 0);
  });

  it.each([false, true].flatMap(dev => ['resolve', 'reject'].map(outcome => ({ dev, outcome }))))
    ('ignores a late hydration value after unmount (dev $dev, $outcome)', async ({ dev, outcome }) => {
    const { Server, Client, initialize } = await components(mode, dev);
    const sceneWork = vi.fn(() => Promise.resolve('scene'));
    const setup = vi.fn(), nativeSetup = vi.fn(), measure = vi.fn();
    const props = { sceneWork, setup, nativeSetup, measure };
    const context = new Map([['theme', 'test-theme']]);
    const html = await render(Server, {
      props: { ...props, initial: Promise.resolve('Server canvas'), get: svelteServer.getContext }, context
    });
    document.body.innerHTML = html.body;
    const canvas = document.querySelector('canvas');
    const request = deferred();
    const warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const instance = hydrate(Client, {
      target: document.body, recover: false, context,
      props: { ...props, initial: request.promise, get: getContext }
    });
    mounted.add(instance);
    await settleComponentUpdates();
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    await unmount(instance); mounted.delete(instance);
    expect(document.querySelector('canvas')).toBeNull();
    if (outcome === 'resolve') request.resolve('obsolete');
    else request.reject(new Error('obsolete'));
    await settleComponentUpdates();
    expect(document.querySelector('canvas')).toBeNull();
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    expect(sceneWork).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
    expect(nativeSetup).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('keeps concurrent async server contexts separate', async () => {
    const { Server, initialize } = await components(mode, false);
    const first = deferred(), second = deferred();
    const sceneWork = vi.fn();
    const props = { sceneWork, get: svelteServer.getContext };
    const firstOutput = Promise.resolve(render(Server, {
      props: { ...props, initial: first.promise }, context: new Map([['theme', 'first-theme']])
    }));
    const secondOutput = Promise.resolve(render(Server, {
      props: { ...props, initial: second.promise }, context: new Map([['theme', 'second-theme']])
    }));
    await settleComponentUpdates();
    second.resolve('Second canvas');
    const secondHtml = await secondOutput;
    expect(secondHtml.body).toContain('aria-label="Second canvas"');
    expect(secondHtml.body).toContain('data-theme="second-theme"');
    expect(secondHtml.body).not.toContain('first-theme');
    first.resolve('First canvas');
    const firstHtml = await firstOutput;
    expect(firstHtml.body).toContain('aria-label="First canvas"');
    expect(firstHtml.body).toContain('data-theme="first-theme"');
    expect(firstHtml.body).not.toContain('second-theme');
    expect(initialize).not.toHaveBeenCalled();
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(sceneWork).not.toHaveBeenCalled();
  });

  it('propagates a server-side rejection without starting GPU work', async () => {
    const { Server, initialize } = await components(mode, false);
    const request = deferred();
    const sceneWork = vi.fn(), nativeSetup = vi.fn(), setup = vi.fn();
    const failure = new Error('server load failed');
    const result = Promise.resolve(render(Server, {
      props: { initial: request.promise, get: svelteServer.getContext, sceneWork, nativeSetup, setup },
      context: new Map([['theme', 'test-theme']])
    }));
    const rejection = expect(result).rejects.toBe(failure);
    await settleComponentUpdates();
    request.reject(failure);
    await rejection;
    expect(initialize).not.toHaveBeenCalled();
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(sceneWork).not.toHaveBeenCalled();
    expect(nativeSetup).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
  });

  it.each([false, true])('hydrates the awaited server canvas without evaluating server scene work (dev %s)', async (dev) => {
    const { Server, Client, initialize } = await components(mode, dev);
    const initial = deferred(), clientInitial = deferred(), scene = deferred();
    const sceneWork = vi.fn(() => scene.promise);
    const cleanup = vi.fn(), setup = vi.fn(() => cleanup);
    const nativeCleanup = vi.fn(), nativeSetup = vi.fn(() => nativeCleanup);
    const measure = vi.fn(), keydown = vi.fn(), onready = vi.fn();
    const props = { sceneWork, setup, nativeSetup, measure, keydown, onready };
    const context = new Map([['theme', 'test-theme']]);
    let rendered = false;
    const output = Promise.resolve(render(Server, {
      props: { ...props, initial: initial.promise, get: svelteServer.getContext }, context
    })).then(value => { rendered = true; return value; });
    await settleComponentUpdates();
    expect(rendered).toBe(false);
    expect(initialize).not.toHaveBeenCalled();
    initial.resolve('Server canvas');
    const html = await output;
    expect(html.body).toContain('aria-label="Server canvas"');
    expect(html.body).toContain('data-theme="test-theme"');
    expect(html.body).not.toContain('<scene');
    expect(html.body).not.toContain('<mesh');
    expect(sceneWork).not.toHaveBeenCalled();
    expect(initialize).not.toHaveBeenCalled();
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(nativeSetup).not.toHaveBeenCalled();
    expect(setup).not.toHaveBeenCalled();
    expect(measure).not.toHaveBeenCalled();

    document.body.innerHTML = html.body;
    const canvas = document.querySelector('canvas')!;
    const classes = canvas.className;
    Object.defineProperty(canvas, 'clientWidth', { value: 640 });
    const root = Object.assign(createFragment(), {
      runtime: { scheduleSync: vi.fn() }, gpu: { setOptions: vi.fn() }, dispose: vi.fn()
    }) as unknown as TypeGpuRoot;
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const instance = hydrate(Client, {
      target: document.body, recover: false, context,
      props: { ...props, initial: clientInitial.promise, get: getContext }
    });
    mounted.add(instance);
    await settleComponentUpdates();
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(createTypeGpuRoot).not.toHaveBeenCalled();
    expect(nativeSetup).not.toHaveBeenCalled();
    clientInitial.resolve('Server canvas');
    await settleComponentUpdates(); await settleComponentUpdates();
    expect(document.querySelectorAll('canvas')).toHaveLength(1);
    expect(instance.reference()).toBe(canvas);
    expect(canvas.className).toBe(classes);
    expect(nativeSetup).toHaveBeenCalledExactlyOnceWith(canvas);
    expect(measure).toHaveBeenCalledExactlyOnceWith(640);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(onready).toHaveBeenCalledExactlyOnceWith(root);
    expect(meshes(root).map(node => node.attributes.name)).toEqual(['pending']);
    expect(setup).not.toHaveBeenCalled();
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    canvas.dispatchEvent(event);
    expect(keydown).toHaveBeenCalledExactlyOnceWith(event);

    scene.resolve('ready'); await settleComponentUpdates();
    const mesh = meshes(root)[0];
    expect(mesh.attributes.name).toBe('ready');
    expect(setup).toHaveBeenCalledExactlyOnceWith(mesh);
    const update = deferred();
    flushSync(() => instance.update(update.promise));
    await settleComponentUpdates();
    expect(canvas.getAttribute('aria-label')).toBe('Server canvas');
    update.resolve('Updated canvas'); await settleComponentUpdates();
    expect(canvas.getAttribute('aria-label')).toBe('Updated canvas');
    expect(instance.reference()).toBe(canvas);
    expect(meshes(root)).toEqual([mesh]);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(sceneWork).toHaveBeenCalledOnce();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    await unmount(instance); mounted.delete(instance);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(nativeCleanup).toHaveBeenCalledOnce();
    expect(root.dispose).toHaveBeenCalledOnce();
    expect(document.querySelector('canvas')).toBeNull();
  });
});
