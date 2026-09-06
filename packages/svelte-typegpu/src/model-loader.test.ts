import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadModel } from './model-loader';
import { createGlbFixture } from './glb-test-fixtures';

const triangle = 'v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n';

afterEach(() => vi.unstubAllGlobals());

describe('explicit model loading', () => {
  it('parses OBJ and GLB buffers without fetching', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const obj = await loadModel(new TextEncoder().encode(triangle).buffer);
    const glb = await loadModel(createGlbFixture({ asset: { version: '2.0' }, scenes: [] }));
    expect(obj.meshes[0].geometry.vertexCount).toBe(3);
    expect(glb.meshes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('loads URL data with independent geometry identities for retries', async () => {
    const fetchMock = vi.fn(async () => new Response(triangle));
    vi.stubGlobal('fetch', fetchMock);
    const first = await loadModel('/triangle.OBJ?v=1#view');
    const second = await loadModel('/triangle.OBJ?v=1#view');
    expect(first.meshes[0].geometry.key).not.toBe(second.meshes[0].geometry.key);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith('/triangle.OBJ?v=1#view');
  });

  it('loads GLB URLs', async () => {
    const glb = createGlbFixture({ asset: { version: '2.0' }, scenes: [] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(glb))
    );
    expect((await loadModel('/empty.glb')).meshes).toEqual([]);
  });

  it('propagates load failures and allows explicit retry', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 404 }))
      .mockResolvedValueOnce(new Response(triangle));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadModel('/triangle.obj')).rejects.toThrow(
      'Failed to load model /triangle.obj: 404'
    );
    expect((await loadModel('/triangle.obj')).meshes).toHaveLength(1);
    await expect(loadModel(new Uint8Array([0, 1, 2, 3]).buffer)).rejects.toThrow(
      'Unsupported model data format'
    );
  });

  it('rejects an already aborted request before any fetch or parsing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const signal = AbortSignal.abort(new Error('cancelled'));
    await expect(loadModel('/triangle.obj', { signal })).rejects.toThrow('cancelled');
    await expect(loadModel(new ArrayBuffer(0), { signal })).rejects.toThrow('cancelled');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('forwards cancellation to fetch', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn(
      (_src, { signal }: RequestInit) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener('abort', () => reject(signal!.reason), { once: true });
        })
    );
    vi.stubGlobal('fetch', fetchMock);
    const loading = loadModel('/triangle.obj', { signal: controller.signal });
    controller.abort(new Error('replaced'));
    await expect(loading).rejects.toThrow('replaced');
    expect(fetchMock).toHaveBeenCalledWith('/triangle.obj', { signal: controller.signal });
  });

  it('checks cancellation after downloading and before synchronous parsing', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => {
          controller.abort(new Error('unmounted'));
          return new ArrayBuffer(0);
        }
      }))
    );
    await expect(loadModel('/triangle.glb', { signal: controller.signal })).rejects.toThrow(
      'unmounted'
    );
  });

  it('does not consume a late response body after cancellation', async () => {
    const controller = new AbortController();
    const body = vi.fn();
    let finish!: (response: unknown) => void;
    vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { finish = resolve; })));
    const loading = loadModel('/triangle.obj', { signal: controller.signal });
    controller.abort(new Error('removed'));
    finish({ ok: true, arrayBuffer: body });
    await expect(loading).rejects.toThrow('removed');
    expect(body).not.toHaveBeenCalled();
  });
});
