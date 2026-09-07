// @vitest-environment happy-dom
import { flushSync, getContext, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Canvas from './Canvas.svelte';
import CanvasHost from './test-fixtures/CanvasHost.svelte';
import { createTypeGpuRoot, type TypeGpuRoot } from './svelte-renderer';
import { createFragment, walk, type TypeGpuNode } from './core';
import { compileTypeGpuSource } from './component-test-utils';
import { createAttachmentKey } from 'svelte/attachments';

vi.mock('./svelte-renderer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./svelte-renderer')>();
  return { ...actual, createTypeGpuRoot: vi.fn() };
});

const instances: ReturnType<typeof mount>[] = [];
afterEach(async () => {
  for (const instance of instances.splice(0)) await unmount(instance);
  document.body.replaceChildren();
  vi.mocked(createTypeGpuRoot).mockReset();
});

function gpuRoot(events: string[] = []) {
  return Object.assign(createFragment(), {
    canvas: document.createElement('canvas'),
    gpu: { setOptions: vi.fn() },
    dispose: vi.fn(() => events.push('dispose'))
  }) as unknown as TypeGpuRoot;
}

function sceneNodes(root: TypeGpuNode) {
  const result: TypeGpuNode[] = [];
  walk(root, (node) => {
    if (node.kind === 'element') result.push(node);
  });
  return result;
}

describe('Svelte Canvas boundary', () => {
  it.each([false, true])('uses current live options across delayed startup (removed: %s)', async removed => {
    let resolve!: (root: TypeGpuRoot) => void;
    vi.mocked(createTypeGpuRoot).mockReturnValue(new Promise(yes => { resolve = yes; }));
    const root = gpuRoot(), foreign = gpuRoot();
    const onready = vi.fn(() => expect(root.gpu.setOptions).toHaveBeenLastCalledWith({ frameloop: 'manual', maxDevicePixelRatio: 0.5, gpuTiming: undefined }));
    const setup = vi.fn(() => expect(root.gpu.setOptions).toHaveBeenCalled());
    const Scene = compileTypeGpuSource('<script>let { setup } = $props();</script><mesh {@attach setup} />');
    const instance = mount(CanvasHost, { target: document.body, props: {
      Scene, props: { setup }, options: { frameloop: 'demand', maxDevicePixelRatio: 2 }, callbacks: { onready }
    } });
    instances.push(instance);
    await tick();
    flushSync(() => instance.updateOptions('manual', 0.5));
    expect(root.gpu.setOptions).not.toHaveBeenCalled();
    if (removed) { await unmount(instance); instances.pop(); }
    resolve(root); await tick(); await tick();
    if (removed) {
      expect(root.dispose).toHaveBeenCalledOnce();
      expect(root.gpu.setOptions).not.toHaveBeenCalled();
      expect(setup).not.toHaveBeenCalled();
      expect(onready).not.toHaveBeenCalled();
      return;
    }
    expect(onready).toHaveBeenCalledOnce();
    const canvas = document.querySelector('canvas'), mesh = sceneNodes(root)[0];
    flushSync(() => instance.replaceRoot(foreign));
    vi.mocked(root.gpu.setOptions).mockClear();
    flushSync(() => instance.updateOptions('always', 1));
    expect(root.gpu.setOptions).toHaveBeenCalledExactlyOnceWith({ frameloop: 'always', maxDevicePixelRatio: 1, gpuTiming: undefined });
    flushSync(() => instance.updateOptions(undefined, undefined));
    expect(root.gpu.setOptions).toHaveBeenLastCalledWith({ frameloop: undefined, maxDevicePixelRatio: undefined, gpuTiming: undefined });
    expect(foreign.gpu.setOptions).not.toHaveBeenCalled();
    expect(sceneNodes(root)[0]).toBe(mesh);
    expect(document.querySelector('canvas')).toBe(canvas);
    expect(setup).toHaveBeenCalledOnce();
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    await unmount(instance); instances.pop();
    vi.mocked(root.gpu.setOptions).mockClear();
    flushSync(() => instance.updateOptions('demand', 2));
    expect(root.gpu.setOptions).not.toHaveBeenCalled();
    expect(root.dispose).toHaveBeenCalledOnce();
    expect(foreign.dispose).not.toHaveBeenCalled();
  });

  it('cleans up a root if applying pending options fails before scene mount', async () => {
    const root = gpuRoot(), error = new Error('Cannot configure renderer');
    vi.mocked(root.gpu.setOptions).mockImplementation(() => { throw error; });
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const onerror = vi.fn(), onready = vi.fn();
    const instance = mount(CanvasHost, { target: document.body, props: {
      Scene: compileTypeGpuSource('<mesh />'), callbacks: { onerror, onready }
    } });
    instances.push(instance);
    await tick(); await tick();
    expect(onerror).toHaveBeenCalledExactlyOnceWith(error);
    expect(onready).not.toHaveBeenCalled();
    expect(root.dispose).toHaveBeenCalledOnce();
    expect(sceneNodes(root)).toEqual([]);
  });

  it('updates native canvas attributes, events and attachments without replacing scene or GPU state', async () => {
    const root = gpuRoot();
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const Scene = compileTypeGpuSource(
      '<script>let { setup } = $props();</script><mesh {@attach setup} />'
    );
    const sceneCleanup = vi.fn();
    const sceneSetup = vi.fn(() => sceneCleanup);
    const canvasCleanup = vi.fn();
    const attach = vi.fn(() => canvasCleanup);
    const key = createAttachmentKey();
    const first = vi.fn((event: KeyboardEvent) => {
      expect(event.currentTarget).toBe(document.querySelector('canvas'));
    });
    const second = vi.fn();
    const instance = mount(CanvasHost, {
      target: document.body,
      props: {
        Scene,
        props: { setup: sceneSetup },
        canvasProps: {
          'aria-label': 'Model preview',
          tabindex: -1,
          class: ['viewport', { selected: true }],
          style: 'touch-action: pan-y',
          onkeydown: first,
          [key]: attach
        }
      }
    });
    instances.push(instance);
    await tick();
    await tick();
    const canvas = document.querySelector('canvas')!;
    const mesh = sceneNodes(root)[0];
    expect(canvas.getAttribute('aria-label')).toBe('Model preview');
    expect(canvas.tabIndex).toBe(-1);
    expect(canvas.style.touchAction).toBe('pan-y');
    expect(canvas.classList.contains('viewport')).toBe(true);
    expect(canvas.classList.contains('selected')).toBe(true);
    expect(canvas.classList.contains('renderer-root-canvas')).toBe(true);
    expect([...canvas.classList].some((name) => name.startsWith('svelte-'))).toBe(true);
    expect(attach).toHaveBeenCalledExactlyOnceWith(canvas);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
    canvas.dispatchEvent(event);
    expect(first).toHaveBeenCalledExactlyOnceWith(event);
    canvas.width = 640;
    canvas.height = 480;
    flushSync(() =>
      instance.updateCanvasProps({
        'aria-label': 'Updated preview',
        tabindex: 0,
        class: { active: true },
        onkeydown: second,
        [key]: attach,
        width: 5,
        height: 7,
        children: 'ignored'
      })
    );
    expect(canvas.getAttribute('aria-label')).toBe('Updated preview');
    expect(canvas.tabIndex).toBe(0);
    expect(canvas.hasAttribute('style')).toBe(false);
    expect(canvas.classList.contains('viewport')).toBe(false);
    expect(canvas.classList.contains('active')).toBe(true);
    expect(canvas.classList.contains('renderer-root-canvas')).toBe(true);
    expect([...canvas.classList].some((name) => name.startsWith('svelte-'))).toBe(true);
    expect(canvas.width).toBe(640);
    expect(canvas.height).toBe(480);
    expect(canvas.textContent).toBe('');
    canvas.dispatchEvent(event);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledExactlyOnceWith(event);
    expect(attach).toHaveBeenCalledOnce();
    expect(canvasCleanup).not.toHaveBeenCalled();
    expect(sceneNodes(root)[0]).toBe(mesh);
    expect(sceneSetup).toHaveBeenCalledOnce();
    expect(sceneCleanup).not.toHaveBeenCalled();
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(root.dispose).not.toHaveBeenCalled();
    flushSync(() => instance.updateCanvasProps({}));
    expect(canvas.hasAttribute('aria-label')).toBe(false);
    expect(canvas.hasAttribute('tabindex')).toBe(false);
    expect(canvasCleanup).toHaveBeenCalledOnce();
    await unmount(instance);
    instances.pop();
    expect(sceneCleanup).toHaveBeenCalledOnce();
    expect(root.dispose).toHaveBeenCalledOnce();
    expect(canvasCleanup).toHaveBeenCalledOnce();
  });

  it('forwards props, context and callbacks while retaining the scene and GPU root', async () => {
    const events: string[] = [];
    const root = gpuRoot(events);
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const Scene = compileTypeGpuSource(`
      <script>
        let { value = 1, get, setup } = $props();
        const theme = get('theme');
      </script>
      <mesh position={[value, 0, 0]} color={theme.color} {@attach setup} />
    `);
    const setup = vi.fn(() => () => events.push('unmount'));
    const onready = vi.fn();
    const onfps = vi.fn();
    const nextFps = vi.fn();
    const instance = mount(CanvasHost, {
      target: document.body,
      context: new Map([['theme', { color: [1, 0, 0, 1] }]]),
      props: {
        Scene,
        props: { value: 3, get: getContext, setup },
        callbacks: { onready, onfps },
        options: { frameloop: 'manual' }
      }
    });
    instances.push(instance);
    await tick();
    await tick();
    const node = sceneNodes(root)[0];
    expect(node.attributes.position).toEqual([3, 0, 0]);
    expect(node.attributes.color).toEqual([1, 0, 0, 1]);
    expect(instance.currentRoot()).toBe(root);
    expect(onready).toHaveBeenCalledWith(root);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    const options = vi.mocked(createTypeGpuRoot).mock.calls[0][0];
    expect(options.frameloop).toBe('manual');
    expect(options.canvas).toBe(document.querySelector('canvas'));
    expect(options.target).toBe(document.querySelector('[aria-label="GPU scene"]'));
    flushSync(() => instance.updateProps({ value: 4, get: getContext, setup }));
    expect(sceneNodes(root)[0]).toBe(node);
    expect(node.attributes.position).toEqual([4, 0, 0]);
    expect(setup).toHaveBeenCalledOnce();
    options.onFps!(120);
    expect(onfps).toHaveBeenCalledWith(120);
    flushSync(() => instance.updateHandlers({ onfps: nextFps }));
    options.onFps!(144);
    expect(nextFps).toHaveBeenCalledWith(144);
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    await unmount(instance);
    instances.pop();
    expect(events).toEqual(['unmount', 'dispose']);
    expect(instance.currentRoot()).toBe(null);
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('replaces the scene component without replacing the GPU root', async () => {
    const root = gpuRoot();
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const First = compileTypeGpuSource(
      '<script>let { setup } = $props();</script><mesh name="first" {@attach setup} />'
    );
    const Second = compileTypeGpuSource('<mesh name="second" />');
    const cleanup = vi.fn();
    const instance = mount(CanvasHost, {
      target: document.body,
      props: { Scene: First, props: { setup: () => cleanup } }
    });
    instances.push(instance);
    await tick();
    await tick();
    expect(sceneNodes(root)[0].attributes.name).toBe('first');
    flushSync(() => instance.updateScene(Second));
    expect(sceneNodes(root).map((node) => node.attributes.name)).toEqual(['second']);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(createTypeGpuRoot).toHaveBeenCalledOnce();
    expect(root.dispose).not.toHaveBeenCalled();
  });

  it('disposes late initialization without mounting or notifying after unmount', async () => {
    let resolve!: (root: TypeGpuRoot) => void;
    vi.mocked(createTypeGpuRoot).mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      })
    );
    const root = gpuRoot();
    const onready = vi.fn();
    const Scene = compileTypeGpuSource('<mesh />');
    const instance = mount(Canvas, {
      target: document.body,
      props: { scene: Scene, sceneProps: {}, onready }
    });
    await tick();
    await unmount(instance);
    resolve(root);
    await tick();
    expect(root.dispose).toHaveBeenCalledOnce();
    expect(sceneNodes(root)).toEqual([]);
    expect(onready).not.toHaveBeenCalled();
    expect(document.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('uses the latest scene props and callbacks when initialization finishes', async () => {
    let resolve!: (root: TypeGpuRoot) => void;
    vi.mocked(createTypeGpuRoot).mockReturnValue(
      new Promise((yes) => {
        resolve = yes;
      })
    );
    const Scene = compileTypeGpuSource(
      '<script>let { value } = $props();</script><mesh position={[value, 0, 0]} />'
    );
    const before = vi.fn();
    const after = vi.fn();
    const instance = mount(CanvasHost, {
      target: document.body,
      props: { Scene, props: { value: 1 }, callbacks: { onready: before } }
    });
    instances.push(instance);
    await tick();
    flushSync(() => {
      instance.updateProps({ value: 9 });
      instance.updateHandlers({ onready: after });
    });
    const root = gpuRoot();
    resolve(root);
    await tick();
    expect(sceneNodes(root)[0].attributes.position).toEqual([9, 0, 0]);
    expect(before).not.toHaveBeenCalled();
    expect(after).toHaveBeenCalledWith(root);
  });

  it('ignores initialization rejection after unmount', async () => {
    let reject!: (error: Error) => void;
    vi.mocked(createTypeGpuRoot).mockReturnValue(
      new Promise((_yes, no) => {
        reject = no;
      })
    );
    const onerror = vi.fn();
    const Scene = compileTypeGpuSource('<mesh />');
    const instance = mount(Canvas, {
      target: document.body,
      props: { scene: Scene, sceneProps: {}, onerror }
    });
    await tick();
    await unmount(instance);
    reject(new Error('late failure'));
    await tick();
    expect(onerror).not.toHaveBeenCalled();
  });

  it.each([true, false])('reports initialization failure (callback: %s)', async (callback) => {
    const error = new Error('WebGPU unavailable');
    const onerror = callback ? vi.fn() : undefined;
    vi.mocked(createTypeGpuRoot).mockRejectedValue(error);
    const Scene = compileTypeGpuSource('<mesh />');
    instances.push(
      mount(Canvas, { target: document.body, props: { scene: Scene, sceneProps: {}, onerror } })
    );
    await tick();
    await tick();
    if (onerror) expect(onerror).toHaveBeenCalledWith(error);
    else expect(document.querySelector('[role="alert"]')?.textContent).toBe('WebGPU unavailable');
  });

  it('frees acquired GPU state when the scene cannot mount', async () => {
    const root = gpuRoot();
    vi.mocked(createTypeGpuRoot).mockResolvedValue(root);
    const Scene = compileTypeGpuSource('<script>throw new Error("bad scene");</script><mesh />');
    const onerror = vi.fn();
    instances.push(
      mount(Canvas, { target: document.body, props: { scene: Scene, sceneProps: {}, onerror } })
    );
    await tick();
    await tick();
    expect(onerror).toHaveBeenCalledOnce();
    expect(onerror.mock.calls[0][0].message).toContain('bad scene');
    expect(root.dispose).toHaveBeenCalledOnce();
  });
});
