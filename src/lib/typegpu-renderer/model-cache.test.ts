import { describe, expect, it, vi } from 'vitest';
import { createModelCache } from './model-cache';
import type { TypeGpuLoadedModel } from './glb-loader';

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
});
