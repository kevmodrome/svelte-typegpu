import { colorTuple, numberArg } from './attributes';
import type {
  RgbaTuple,
  TypeGpuStandardMaterialDescriptor,
  TypeGpuTextureSource
} from './types';

export const DEFAULT_STANDARD_MATERIAL: TypeGpuStandardMaterialDescriptor = {
  kind: 'standard',
  color: [1, 1, 1, 1],
  roughness: 0.45,
  metalness: 0.05,
  opacity: 1,
  map: null
};

const TYPEGPU_STANDARD_MATERIAL = Symbol('TypeGPU standard material');

export interface TypeGpuStandardMaterialInit {
  color?: unknown;
  roughness?: unknown;
  metalness?: unknown;
  opacity?: unknown;
  map?: unknown;
}

export type TypeGpuStandardMaterialObject = TypeGpuStandardMaterialDescriptor & {
  readonly [TYPEGPU_STANDARD_MATERIAL]: true;
};

export function createStandardMaterial(
  init: TypeGpuStandardMaterialInit = {}
): TypeGpuStandardMaterialObject {
  return {
    ...normalizeStandardMaterial(DEFAULT_STANDARD_MATERIAL, init),
    [TYPEGPU_STANDARD_MATERIAL]: true
  };
}

export function isStandardMaterialObject(value: unknown): value is TypeGpuStandardMaterialObject {
  return Boolean(value && typeof value === 'object' && TYPEGPU_STANDARD_MATERIAL in value);
}

export function normalizeStandardMaterial(
  base: TypeGpuStandardMaterialDescriptor,
  attrs: TypeGpuStandardMaterialInit
): TypeGpuStandardMaterialDescriptor {
  return {
    kind: 'standard',
    color: attrs.color === undefined ? ([...base.color] as RgbaTuple) : colorTuple(attrs.color),
    roughness: numberArg(attrs.roughness, base.roughness),
    metalness: numberArg(attrs.metalness, base.metalness),
    opacity: numberArg(attrs.opacity, base.opacity),
    map: attrs.map === undefined ? base.map : textureSource(attrs.map)
  };
}

export function textureSource(value: unknown): TypeGpuTextureSource | null {
  if (typeof value === 'string' && value.length > 0) {
    return { kind: 'url', src: value };
  }

  if (value && typeof value === 'object') {
    const source = value as Partial<TypeGpuTextureSource>;

    if (source.kind === 'url' && typeof source.src === 'string' && source.src.length > 0) {
      return { kind: 'url', src: source.src };
    }

    if (
      source.kind === 'embedded' &&
      typeof source.key === 'string' &&
      source.key.length > 0 &&
      typeof source.mimeType === 'string' &&
      source.mimeType.length > 0 &&
      source.data instanceof Uint8Array
    ) {
      return {
        kind: 'embedded',
        key: source.key,
        mimeType: source.mimeType,
        data: source.data
      };
    }
  }

  return null;
}

export function textureKeyForMaterial(material: TypeGpuStandardMaterialDescriptor): string {
  if (!material.map) return 'solid:white';

  return material.map.kind === 'url'
    ? `url:${material.map.src}`
    : `embedded:${material.map.key}`;
}
