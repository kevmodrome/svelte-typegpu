import { loadDataModel, loadUrlModel } from './model-loader';
import type { TypeGpuLoadedModel } from './types';

export type TypeGpuModelCacheEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; model: TypeGpuLoadedModel; revision: number }
  | { status: 'failed'; error: unknown; revision: number };

export interface TypeGpuModelRequest {
  asset?: unknown;
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
  const assets = new WeakMap<TypeGpuLoadedModel, TypeGpuModelCacheEntry>();
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
      if (isLoadedModel(request.asset)) {
        const asset = request.asset;
        let entry = assets.get(asset);
        if (!entry) {
          entry = { status: 'ready', model: asset, revision: revision++ };
          assets.set(asset, entry);
        }
        return entry;
      }

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

function isLoadedModel(value: unknown): value is TypeGpuLoadedModel {
  return typeof value === 'object' && value !== null &&
    'key' in value && typeof value.key === 'string' &&
    'meshes' in value && Array.isArray(value.meshes);
}
