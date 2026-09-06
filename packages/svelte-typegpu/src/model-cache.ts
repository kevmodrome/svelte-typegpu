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
  loadUrl?: (src: string, signal?: AbortSignal) => Promise<TypeGpuLoadedModel>;
  loadData?: (data: ArrayBuffer, key: string) => Promise<TypeGpuLoadedModel>;
  onSettled?: () => void;
}

export interface TypeGpuModelCache {
  read(request: TypeGpuModelRequest): TypeGpuModelCacheEntry;
  beginCollection(): void;
  endCollection(): void;
  dispose(): void;
}

interface ModelRecord {
  entry: TypeGpuModelCacheEntry;
  lastRead: number;
  controller?: AbortController;
}

export function createModelCache({
  loadUrl = (src, signal) => loadUrlModel(src, undefined, signal),
  loadData = loadDataModel,
  onSettled = () => {}
}: TypeGpuModelCacheOptions = {}): TypeGpuModelCache {
  const urls = new Map<string, ModelRecord>();
  const data = new Map<ArrayBuffer, ModelRecord>();
  let assets = new WeakMap<TypeGpuLoadedModel, TypeGpuModelCacheEntry>();
  let nextDataKey = 1;
  let revision = 1;
  let collection = 0;
  let disposed = false;

  function settle<Key>(
    entries: Map<Key, ModelRecord>, key: Key, record: ModelRecord,
    result: { status: 'ready'; model: TypeGpuLoadedModel } | { status: 'failed'; error: unknown }
  ): void {
    if (disposed || entries.get(key) !== record) return;
    record.controller = undefined;
    record.entry = { ...result, revision: revision++ };
    onSettled();
  }

  function prune<Key>(entries: Map<Key, ModelRecord>): void {
    for (const [key, record] of entries) {
      if (!disposed && record.lastRead === collection) continue;
      // Invalidate before abort: loader abort listeners may run synchronously.
      entries.delete(key);
      record.controller?.abort();
    }
  }

  return {
    beginCollection() { collection++; },
    endCollection() { prune(urls); prune(data); },
    dispose() {
      if (disposed) return;
      disposed = true;
      prune(urls); prune(data);
      assets = new WeakMap();
    },
    read(request) {
      if (disposed) return { status: 'idle' };
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
        if (existing) {
          existing.lastRead = collection;
          return existing.entry;
        }

        const key = `data:${nextDataKey++}`;
        const record: ModelRecord = { entry: { status: 'loading' }, lastRead: collection };
        data.set(buffer, record);
        void loadData(buffer, key).then(
          (model) => settle(data, buffer, record, { status: 'ready', model }),
          (error: unknown) => settle(data, buffer, record, { status: 'failed', error })
        );
        return record.entry;
      }

      if (typeof request.src === 'string' && request.src.length > 0) {
        const src = request.src;
        const existing = urls.get(src);
        if (existing) {
          existing.lastRead = collection;
          return existing.entry;
        }

        const controller = new AbortController();
        const record: ModelRecord = { entry: { status: 'loading' }, lastRead: collection, controller };
        urls.set(src, record);
        void loadUrl(src, controller.signal).then(
          (model) => settle(urls, src, record, { status: 'ready', model }),
          (error: unknown) => settle(urls, src, record, { status: 'failed', error })
        );
        return record.entry;
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
