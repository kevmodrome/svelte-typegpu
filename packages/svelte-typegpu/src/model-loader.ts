import { loadGlbModel } from './glb-loader';
import { loadObjModel } from './obj-loader';
import type { TypeGpuLoadedModel } from './types';

export interface TypeGpuModelLoadOptions {
  signal?: AbortSignal;
}

let nextAssetKey = 1;

/** Load CPU model data once, then share it across `<model asset={...}>` nodes. */
export async function loadModel(
  source: string | ArrayBuffer,
  { signal }: TypeGpuModelLoadOptions = {}
): Promise<TypeGpuLoadedModel> {
  signal?.throwIfAborted();
  const key = `asset:${nextAssetKey++}`;
  return typeof source === 'string'
    ? loadUrlModel(source, key, signal)
    : loadDataModel(source, key);
}

export async function loadUrlModel(
  src: string,
  key = `url:${src}`,
  signal?: AbortSignal
): Promise<TypeGpuLoadedModel> {
  signal?.throwIfAborted();
  const response = await (signal ? fetch(src, { signal }) : fetch(src));
  if (!response.ok) {
    throw new Error(`Failed to load model ${src}: ${response.status}`);
  }

  const data = await response.arrayBuffer();
  signal?.throwIfAborted();
  return isObjUrl(src)
    ? loadObjModel(new TextDecoder().decode(data), key)
    : loadGlbModel(data, key);
}

export async function loadDataModel(data: ArrayBuffer, key: string): Promise<TypeGpuLoadedModel> {
  if (isGlbBuffer(data)) return loadGlbModel(data, key);

  const text = new TextDecoder().decode(data);
  if (hasInvalidObjTextCharacters(text) || !looksLikeObjText(text)) {
    throw new Error(`Unsupported model data format for ${key}. Expected GLB binary or OBJ text.`);
  }

  const model = loadObjModel(text, key);
  if (model.meshes.length === 0) {
    throw new Error(`OBJ model data for ${key} did not contain renderable geometry.`);
  }

  return model;
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

function looksLikeObjText(text: string): boolean {
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.split('#', 1)[0]?.trim() ?? '';
    if (line.length === 0) continue;
    if (/^(?:v|vt|vn|vp|f|o|g|s|usemtl|mtllib)\b/.test(line)) return true;
  }
  return false;
}

function hasInvalidObjTextCharacters(text: string): boolean {
  return /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffd]/.test(text);
}
