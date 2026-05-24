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
    throw new Error(`Failed to load GLB model ${src}: ${response.status}`);
  }

  return loadGlbModel(await response.arrayBuffer(), `url:${src}`);
}

async function loadDataModel(data: ArrayBuffer, key: string): Promise<TypeGpuLoadedModel> {
  return loadGlbModel(data, key);
}
