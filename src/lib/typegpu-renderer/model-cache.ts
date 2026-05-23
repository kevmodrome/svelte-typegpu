import { loadGlbModel, type TypeGpuLoadedModel } from './glb-loader';

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
        const existing = data.get(request.data);
        if (existing) return existing;

        const key = `data:${nextDataKey++}`;
        const loading: TypeGpuModelCacheEntry = { status: 'loading' };
        data.set(request.data, loading);
        void loadData(request.data, key)
          .then((model) =>
            settleData(request.data as ArrayBuffer, { status: 'ready', model, revision: revision++ })
          )
          .catch((error: unknown) =>
            settleData(request.data as ArrayBuffer, { status: 'failed', error, revision: revision++ })
          );
        return loading;
      }

      if (typeof request.src === 'string' && request.src.length > 0) {
        const existing = urls.get(request.src);
        if (existing) return existing;

        const loading: TypeGpuModelCacheEntry = { status: 'loading' };
        urls.set(request.src, loading);
        void loadUrl(request.src)
          .then((model) =>
            settleUrl(request.src as string, { status: 'ready', model, revision: revision++ })
          )
          .catch((error: unknown) =>
            settleUrl(request.src as string, { status: 'failed', error, revision: revision++ })
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
    throw new Error(`Failed to load GLB model ${src}: ${response.status}`);
  }

  return loadGlbModel(await response.arrayBuffer(), `url:${src}`);
}

async function loadDataModel(data: ArrayBuffer, key: string): Promise<TypeGpuLoadedModel> {
  return loadGlbModel(data, key);
}
