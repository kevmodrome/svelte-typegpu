import { afterEach, describe, expect, it, vi } from 'vitest';
import { createModelCache } from './model-cache';
import type { TypeGpuLoadedModel } from './types';
import { createGlbFixture } from './glb-test-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function loadedModel(key: string): TypeGpuLoadedModel {
  return { key, meshes: [] };
}

describe('TypeGPU model cache', () => {
  function collect(cache: ReturnType<typeof createModelCache>, requests: Parameters<typeof cache.read>[0][] = []) {
    cache.beginCollection();
    const entries = requests.map(request => cache.read(request));
    cache.endCollection();
    return entries;
  }

  it.each(['resolve', 'reject'] as const)('ignores an evicted URL %s without replacing a new same-source request', async outcome => {
    const loads: { signal: AbortSignal; resolve(value: TypeGpuLoadedModel): void; reject(error: unknown): void }[] = [];
    const loadUrl = vi.fn((_src: string, signal?: AbortSignal) => new Promise<TypeGpuLoadedModel>((resolve, reject) => {
      loads.push({ signal: signal!, resolve, reject });
    }));
    const onSettled = vi.fn();
    const cache = createModelCache({ loadUrl, onSettled });
    const request = { src: '/shared.obj' };
    collect(cache, [request]); collect(cache);
    expect(loads[0].signal.aborted).toBe(true);
    const [replacement] = collect(cache, [request]);
    if (outcome === 'resolve') loads[0].resolve(loadedModel('obsolete'));
    else loads[0].reject(new Error('obsolete'));
    await Promise.resolve();
    expect(cache.read(request)).toBe(replacement);
    expect(onSettled).not.toHaveBeenCalled();
    loads[1].resolve(loadedModel('replacement'));
    await Promise.resolve();
    expect(cache.read(request)).toMatchObject({ status: 'ready', model: { key: 'replacement' } });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it.each(['resolve', 'reject'] as const)('ignores an evicted data %s without retaining the old buffer entry', async outcome => {
    const loads: { resolve(value: TypeGpuLoadedModel): void; reject(error: unknown): void }[] = [];
    const loadData = vi.fn(() => new Promise<TypeGpuLoadedModel>((resolve, reject) => loads.push({ resolve, reject })));
    const onSettled = vi.fn();
    const cache = createModelCache({ loadData, onSettled });
    const request = { data: new ArrayBuffer(0) };
    collect(cache, [request]); collect(cache);
    const [replacement] = collect(cache, [request]);
    expect(loadData).toHaveBeenCalledTimes(2);
    if (outcome === 'resolve') loads[0].resolve(loadedModel('obsolete'));
    else loads[0].reject(new Error('obsolete'));
    await Promise.resolve();
    expect(cache.read(request)).toBe(replacement);
    expect(onSettled).not.toHaveBeenCalled();
    loads[1].resolve(loadedModel('replacement'));
    await Promise.resolve();
    expect(cache.read(request)).toMatchObject({ status: 'ready', model: { key: 'replacement' } });
    expect(onSettled).toHaveBeenCalledOnce();
  });

  it.each(['ready', 'failed'] as const)('releases settled %s URL entries and retries when owned again', async status => {
    let signal!: AbortSignal;
    const loadUrl = vi.fn(async (_src: string, value?: AbortSignal) => {
      signal = value!;
      if (status === 'failed') throw new Error('failed');
      return loadedModel('ready');
    });
    const cache = createModelCache({ loadUrl });
    const request = { src: '/shared.obj' };
    collect(cache, [request]); await Promise.resolve();
    const entry = cache.read(request);
    expect(entry.status).toBe(status);
    collect(cache, [request]);
    expect(cache.read(request)).toBe(entry);
    expect(loadUrl).toHaveBeenCalledOnce();
    const abort = vi.fn();
    signal.addEventListener('abort', abort);
    collect(cache);
    expect(abort).not.toHaveBeenCalled();
    collect(cache, [request]);
    expect(loadUrl).toHaveBeenCalledTimes(2);
  });

  it.each(['url', 'data'] as const)('disposal invalidates late %s settlement and prevents new reads from loading', async source => {
    let finish!: (model: TypeGpuLoadedModel) => void;
    const load = vi.fn(() => new Promise<TypeGpuLoadedModel>(resolve => { finish = resolve; }));
    const onSettled = vi.fn();
    const cache = createModelCache({ loadUrl: load, loadData: load, onSettled });
    const request = source === 'url' ? { src: '/shared.obj' } : { data: new ArrayBuffer(0) };
    collect(cache, [request]);
    cache.dispose(); cache.dispose();
    finish(loadedModel('disposed')); await Promise.resolve();
    expect(onSettled).not.toHaveBeenCalled();
    expect(cache.read(request)).toEqual({ status: 'idle' });
    expect(cache.read({ asset: loadedModel('external') })).toEqual({ status: 'idle' });
    expect(load).toHaveBeenCalledOnce();
  });

  it('shares parsed data until its last owner leaves, then gives a reload a fresh geometry key', async () => {
    const loadData = vi.fn(async (_buffer: ArrayBuffer, key: string) => loadedModel(key));
    const cache = createModelCache({ loadData });
    const request = { data: new ArrayBuffer(0) };
    collect(cache, [request, request]); await Promise.resolve();
    const [first] = collect(cache, [request]);
    expect(loadData).toHaveBeenCalledOnce();
    expect(first).toMatchObject({ status: 'ready', model: { key: 'data:1' } });
    collect(cache);
    collect(cache, [request]); await Promise.resolve();
    expect(cache.read(request)).toMatchObject({ status: 'ready', model: { key: 'data:2' } });
    expect(loadData).toHaveBeenCalledTimes(2);
  });

  it('invalidates an entry before a synchronous abort callback rereads its key', () => {
    const loadUrl = vi.fn((_src: string, signal?: AbortSignal) => new Promise<TypeGpuLoadedModel>(() => {
      signal!.addEventListener('abort', () => cache.read({ src: '/shared.obj' }), { once: true });
    }));
    const cache = createModelCache({ loadUrl });
    collect(cache, [{ src: '/shared.obj' }]); collect(cache);
    expect(loadUrl).toHaveBeenCalledTimes(2);
    cache.dispose();
    expect(loadUrl).toHaveBeenCalledTimes(2);
  });

  it('reads resolved assets synchronously with stable weak entries and no loading work', () => {
    const loadUrl = vi.fn();
    const loadData = vi.fn();
    const onSettled = vi.fn();
    const cache = createModelCache({ loadUrl, loadData, onSettled });
    const asset = loadedModel('asset:shared');
    const first = cache.read({ asset, data: new ArrayBuffer(0), src: '/ignored.glb' });
    expect(first).toMatchObject({ status: 'ready', model: asset });
    expect(cache.read({ asset })).toBe(first);
    expect(cache.read({ asset: loadedModel('asset:next') })).not.toBe(first);
    expect(loadUrl).not.toHaveBeenCalled();
    expect(loadData).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
  });

  it('starts URL loading once and notifies when ready', async () => {
    const onSettled = vi.fn();
    const loadUrl = vi.fn(async (src: string) => loadedModel(`url:${src}`));
    const cache = createModelCache({ loadUrl, loadData: vi.fn(), onSettled });

    const first = cache.read({ src: '/models/chair.glb' });
    const second = cache.read({ src: '/models/chair.glb' });

    expect(first.status).toBe('loading');
    expect(second.status).toBe('loading');
    expect(loadUrl).toHaveBeenCalledOnce();

    await Promise.resolve();

    expect(onSettled).toHaveBeenCalledOnce();
    expect(cache.read({ src: '/models/chair.glb' })).toMatchObject({
      status: 'ready',
      model: { key: 'url:/models/chair.glb' }
    });
  });

  it('uses ArrayBuffer identity for data cache entries', async () => {
    const firstData = new ArrayBuffer(4);
    const secondData = new ArrayBuffer(4);
    const loadData = vi.fn(async (_data: ArrayBuffer, key: string) => loadedModel(key));
    const cache = createModelCache({ loadUrl: vi.fn(), loadData, onSettled: vi.fn() });

    cache.read({ data: firstData });
    cache.read({ data: firstData });
    cache.read({ data: secondData });

    expect(loadData).toHaveBeenCalledTimes(2);
    expect(loadData.mock.calls[0][1]).toBe('data:1');
    expect(loadData.mock.calls[1][1]).toBe('data:2');
  });

  it('settles URL loads against the original request source', async () => {
    let resolveLoad: (model: TypeGpuLoadedModel) => void = () => {};
    const loadUrl = vi.fn(
      () => new Promise<TypeGpuLoadedModel>((resolve) => (resolveLoad = resolve))
    );
    const cache = createModelCache({ loadUrl, loadData: vi.fn(), onSettled: vi.fn() });
    const request = { src: '/models/chair.glb' };

    cache.read(request);
    request.src = '/models/table.glb';
    resolveLoad(loadedModel('url:/models/chair.glb'));
    await Promise.resolve();

    expect(cache.read({ src: '/models/chair.glb' })).toMatchObject({
      status: 'ready',
      model: { key: 'url:/models/chair.glb' }
    });
  });

  it('settles data loads against the original request buffer', async () => {
    const firstData = new ArrayBuffer(4);
    const secondData = new ArrayBuffer(4);
    let resolveLoad: (model: TypeGpuLoadedModel) => void = () => {};
    const loadData = vi.fn(
      () => new Promise<TypeGpuLoadedModel>((resolve) => (resolveLoad = resolve))
    );
    const cache = createModelCache({ loadUrl: vi.fn(), loadData, onSettled: vi.fn() });
    const request = { data: firstData };

    cache.read(request);
    request.data = secondData;
    resolveLoad(loadedModel('data:1'));
    await Promise.resolve();

    expect(cache.read({ data: firstData })).toMatchObject({
      status: 'ready',
      model: { key: 'data:1' }
    });
  });

  it('loads OBJ URLs through the default URL loader and ignores query/hash for format detection', async () => {
    const fetchMock = vi.fn(async () => new Response(objTriangleText(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const cache = createModelCache({ onSettled: vi.fn() });
    const src = '/models/triangle.obj?v=1#preview';

    expect(cache.read({ src }).status).toBe('loading');
    const entry = await settleModel(cache, { src });

    expect(fetchMock).toHaveBeenCalledWith(src, { signal: expect.any(AbortSignal) });
    expect(entry).toMatchObject({
      status: 'ready',
      model: {
        key: 'url:/models/triangle.obj?v=1#preview',
        meshes: [{ geometry: { key: 'url:/models/triangle.obj?v=1#preview:primitive:0' } }]
      }
    });
  });

  it('keeps GLB URL loading through the default URL loader', async () => {
    const glb = createGlbFixture({ asset: { version: '2.0' }, scenes: [] });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(glb, { status: 200 })));
    const cache = createModelCache();
    const src = '/models/chair.glb';

    cache.read({ src });
    const entry = await settleModel(cache, { src });

    expect(entry).toMatchObject({
      status: 'ready',
      model: { key: 'url:/models/chair.glb', meshes: [] }
    });
  });

  it('routes ArrayBuffer data with GLB magic to the GLB loader', async () => {
    const cache = createModelCache();
    const data = createGlbFixture({ asset: { version: '2.0' }, scenes: [] });

    cache.read({ data });
    const entry = await settleModel(cache, { data });

    expect(entry).toMatchObject({
      status: 'ready',
      model: { key: 'data:1', meshes: [] }
    });
  });

  it('routes text ArrayBuffer data to the OBJ loader', async () => {
    const cache = createModelCache();
    const data = new TextEncoder().encode(objTriangleText()).buffer;

    cache.read({ data });
    const entry = await settleModel(cache, { data });

    expect(entry).toMatchObject({
      status: 'ready',
      model: {
        key: 'data:1',
        meshes: [{ geometry: { key: 'data:1:primitive:0', vertexCount: 3 } }]
      }
    });
  });

  it('rejects non-GLB ArrayBuffer data that does not look like OBJ text', async () => {
    const cache = createModelCache();
    const data = new Uint8Array([0, 1, 2, 3, 4, 5]).buffer;

    cache.read({ data });
    const entry = await settleModel(cache, { data });

    expect(entry.status).toBe('failed');
    expect(entry.status === 'failed' ? entry.error : null).toEqual(
      new Error('Unsupported model data format for data:1. Expected GLB binary or OBJ text.')
    );
  });

  it('rejects OBJ-looking binary ArrayBuffer data', async () => {
    const cache = createModelCache();
    const data = new Uint8Array([0x6f, 0x00, 0xff, 0x66, 0x20, 0x31]).buffer;

    cache.read({ data });
    const entry = await settleModel(cache, { data });

    expect(entry.status).toBe('failed');
    expect(entry.status === 'failed' ? entry.error : null).toEqual(
      new Error('Unsupported model data format for data:1. Expected GLB binary or OBJ text.')
    );
  });

  it('rejects OBJ-looking ArrayBuffer text without renderable geometry', async () => {
    const cache = createModelCache();
    const data = new TextEncoder().encode(`
o Empty
g Group
s off
v 0 0 0
f 1 2 3
`).buffer;

    cache.read({ data });
    const entry = await settleModel(cache, { data });

    expect(entry.status).toBe('failed');
    expect(entry.status === 'failed' ? entry.error : null).toEqual(
      new Error('OBJ model data for data:1 did not contain renderable geometry.')
    );
  });

  it('reports URL failures with neutral model wording', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    const cache = createModelCache();
    const src = '/models/missing.obj';

    cache.read({ src });
    const entry = await settleModel(cache, { src });

    expect(entry.status).toBe('failed');
    expect(entry.status === 'failed' ? entry.error : null).toEqual(
      new Error('Failed to load model /models/missing.obj: 404')
    );
  });
});

async function settleModel(
  cache: ReturnType<typeof createModelCache>,
  request: Parameters<ReturnType<typeof createModelCache>['read']>[0]
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await Promise.resolve();
    const entry = cache.read(request);
    if (entry.status !== 'loading') return entry;
  }

  return cache.read(request);
}

function objTriangleText(): string {
  return `
v 0 0 0
v 1 0 0
v 0 1 0
f 1 2 3
`;
}
