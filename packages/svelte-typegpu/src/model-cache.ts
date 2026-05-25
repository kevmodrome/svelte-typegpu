import { loadGlbModel } from './glb-loader';
import { loadObjModel } from './obj-loader';
import type { TypeGpuLoadedModel } from './types';

export type TypeGpuModelCacheEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; model: TypeGpuLoadedModel; revision: number }
  | { status: 'failed'; error: unknown; revision: number };

export interface TypeGpuModelRequest {
  src?: unknown;
  data?: unknown;
}

export interface TypeGpuModelCacheOptions {
  loadUrl?: (src: string) => Promise<TypeGpuLoadedModel>;
  loadData?: (data: ArrayBuffer, key: string) => Promise<TypeGpuLoadedModel>;
  onSettled?: () => void;
}

export interface TypeGpuModelCache {
  read(request: TypeGpuModelRequest): TypeGpuModelCacheEntry;
}

export function createModelCache({
  loadUrl = loadUrlModel,
  loadData = loadDataModel,
  onSettled = () => {}
}: TypeGpuModelCacheOptions = {}): TypeGpuModelCache {
  const urls = new Map<string, TypeGpuModelCacheEntry>();
  const data = new WeakMap<ArrayBuffer, TypeGpuModelCacheEntry>();
  let nextDataKey = 1;
  let revision = 1;

  function settleUrl(src: string, entry: TypeGpuModelCacheEntry): void {
    urls.set(src, entry);
    onSettled();
  }

  function settleData(buffer: ArrayBuffer, entry: TypeGpuModelCacheEntry): void {
    data.set(buffer, entry);
    onSettled();
  }

  return {
    read(request) {
      if (request.data instanceof ArrayBuffer) {
        const buffer = request.data;
        const existing = data.get(buffer);
        if (existing) return existing;

        const key = `data:${nextDataKey++}`;
        const loading: TypeGpuModelCacheEntry = { status: 'loading' };
        data.set(buffer, loading);
        void loadData(buffer, key).then(
          (model) => settleData(buffer, { status: 'ready', model, revision: revision++ }),
          (error: unknown) =>
            settleData(buffer, { status: 'failed', error, revision: revision++ })
          );
        return loading;
      }

      if (typeof request.src === 'string' && request.src.length > 0) {
        const src = request.src;
        const existing = urls.get(src);
        if (existing) return existing;

        const loading: TypeGpuModelCacheEntry = { status: 'loading' };
        urls.set(src, loading);
        void loadUrl(src).then(
          (model) => settleUrl(src, { status: 'ready', model, revision: revision++ }),
          (error: unknown) =>
            settleUrl(src, { status: 'failed', error, revision: revision++ })
          );
        return loading;
      }

      return { status: 'idle' };
    }
  };
}

async function loadUrlModel(src: string): Promise<TypeGpuLoadedModel> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`Failed to load model ${src}: ${response.status}`);
  }

  const data = await response.arrayBuffer();
  const key = `url:${src}`;
  return isObjUrl(src)
    ? loadObjModel(new TextDecoder().decode(data), key)
    : loadGlbModel(data, key);
}

async function loadDataModel(data: ArrayBuffer, key: string): Promise<TypeGpuLoadedModel> {
  return isGlbBuffer(data)
    ? loadGlbModel(data, key)
    : loadObjModel(new TextDecoder().decode(data), key);
}

function isObjUrl(src: string): boolean {
  const [withoutHash] = src.split('#', 1);
  const [path] = (withoutHash ?? src).split('?', 1);
  return (path ?? src).toLowerCase().endsWith('.obj');
}

function isGlbBuffer(data: ArrayBuffer): boolean {
  if (data.byteLength < 4) return false;
  return new DataView(data).getUint32(0, true) === 0x46546c67;
}
