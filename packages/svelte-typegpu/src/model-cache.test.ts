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

    expect(fetchMock).toHaveBeenCalledWith(src);
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
