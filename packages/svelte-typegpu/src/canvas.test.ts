// @vitest-environment happy-dom
import { flushSync, getContext, mount, tick, unmount } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Canvas from './Canvas.svelte';
import CanvasHost from './test-fixtures/CanvasHost.svelte';
import { createTypeGpuRoot, type TypeGpuRoot } from './svelte-renderer';
import { createFragment, walk, type TypeGpuNode } from './core';
import { compileTypeGpuSource } from './component-test-utils';

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
