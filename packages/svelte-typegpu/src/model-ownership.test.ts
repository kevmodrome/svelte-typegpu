import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, createFragment, insert, remove, setAttribute } from './core';
import { Dirty } from './dirty';
import { createModelCache } from './model-cache';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';
import { createTypeGpuRuntimeForTest } from './svelte-renderer';
import type { TypeGpuRenderer } from './gpu-renderer';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

function fixture() {
  const requests: { src: string; signal?: AbortSignal; resolve(value: Response): void }[] = [];
  vi.stubGlobal('fetch', vi.fn((src: string, options?: RequestInit) => new Promise<Response>(resolve => {
    requests.push({ src, signal: options?.signal ?? undefined, resolve });
  })));
  const root = createFragment();
  const group = createElement('group');
  const first = createElement('model');
  const second = createElement('model');
  insert(root, group, null);
  for (const model of [first, second]) {
    setAttribute(model, 'src', '/shared.obj');
    insert(group, model, null);
  }
  const settled = vi.fn();
  const modelCache = createModelCache({ onSettled: settled });
  const cache = createTypeGpuSceneCache({ modelCache });
  const sync = () => createSceneState(root, cache);
  return { root, group, first, second, modelCache, requests, settled, cache, sync };
}

describe('scene-owned model loading', () => {
  it('keeps hidden/shared owners but cancels when the last owner is removed', () => {
    const { group, first, second, requests, sync } = fixture();
    sync();
    expect(requests).toHaveLength(1);
    expect(requests[0].signal).toBeInstanceOf(AbortSignal);
    setAttribute(group, 'visible', false); sync();
    expect(requests[0].signal!.aborted).toBe(false);
    remove(first); sync();
    expect(requests[0].signal!.aborted).toBe(false);
    remove(second); sync();
    expect(requests[0].signal!.aborted).toBe(true);
  });

  it('retains a moved node without restarting its request', () => {
    const { root, first, second, requests, sync } = fixture();
    remove(second); sync();
    remove(first); insert(root, first, null); sync();
    expect(requests).toHaveLength(1);
    expect(requests[0].signal?.aborted).toBe(false);
  });

  it('releases URL ownership when an explicit asset takes precedence', () => {
    const { first, second, requests, sync } = fixture();
    remove(second); sync();
    setAttribute(first, 'asset', { key: 'explicit', meshes: [] }); sync();
    expect(requests[0].signal?.aborted).toBe(true);
    setAttribute(first, 'asset', undefined); sync();
    expect(requests).toHaveLength(2);
    expect(requests[1].signal?.aborted).toBe(false);
  });

  it('keeps an old source until the last shared model switches to its replacement', () => {
    const { first, second, requests, sync } = fixture();
    sync();
    setAttribute(first, 'src', '/replacement.obj'); sync();
    expect(requests).toHaveLength(2);
    expect(requests[0].signal?.aborted).toBe(false);
    setAttribute(second, 'src', '/replacement.obj'); sync();
    expect(requests).toHaveLength(2);
    expect(requests[0].signal?.aborted).toBe(true);
    expect(requests[1].signal?.aborted).toBe(false);
  });

  it('does not retain the URL of a data-backed model', async () => {
    const { first, second, requests, sync } = fixture();
    remove(second); sync();
    setAttribute(first, 'data', new TextEncoder().encode('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3').buffer);
    sync(); await Promise.resolve();
    expect(requests[0].signal?.aborted).toBe(true);
    expect(sync().drawBatches).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it('does not collect or reread model ownership during incremental transforms', () => {
    const { root, first, requests, modelCache, cache, sync } = fixture();
    sync();
    const begin = vi.spyOn(modelCache, 'beginCollection');
    const read = vi.spyOn(modelCache, 'read');
    const end = vi.spyOn(modelCache, 'endCollection');
    for (let i = 1; i <= 100; i++) {
      setAttribute(first, 'position', [i, 0, 0]);
      createSceneState(root, cache, { dirty: Dirty.Transform, dirtyNodes: new Map([[first, Dirty.Transform]]) });
    }
    expect(begin).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
    expect(requests[0].signal?.aborted).toBe(false);
  });

  it('does not prune owners when a scene walk fails before reaching them', () => {
    const { root, group, requests, sync } = fixture();
    sync();
    const broken = createElement('mesh');
    Object.defineProperty(broken.attributes, 'position', { get() { throw new Error('invalid scene'); } });
    insert(root, broken, group);
    expect(sync).toThrow('invalid scene');
    expect(requests[0].signal?.aborted).toBe(false);
    remove(broken); sync();
    expect(requests).toHaveLength(1);
  });

  it('cancels pending model requests on root disposal without a final scene walk', async () => {
    const { root, requests } = fixture();
    const gpu = { setScene: vi.fn(), dispose: vi.fn() } as unknown as TypeGpuRenderer;
    const runtime = createTypeGpuRuntimeForTest(root, new EventTarget() as HTMLCanvasElement, gpu);
    root.runtime = runtime;
    runtime.scheduleSync(root);
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    runtime.dispose(); runtime.dispose();
    expect(requests[0].signal?.aborted).toBe(true);
    requests[0].resolve(new Response('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3'));
    for (let i = 0; i < 12; i++) await Promise.resolve();
    expect(gpu.setScene).toHaveBeenCalledOnce();
    expect(gpu.dispose).toHaveBeenCalledOnce();
  });
});
