import { colorTuple, numberArg } from './attributes';
import type { TypeGpuNode } from './core';
import type { TypeGpuResourceCollection } from './resources';
import type {
  RgbaTuple,
  TypeGpuMaterialDescriptor,
  TypeGpuMaterialKind,
  TypeGpuSamplerDescriptor,
  TypeGpuTextureSource
} from './types';

export const DEFAULT_SAMPLER: TypeGpuSamplerDescriptor = {
  key: 'sampler:default',
  magFilter: 'linear',
  minFilter: 'linear',
  mipmapFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat',
  addressModeW: 'repeat'
};

export function readInlineMaterial(
  node: TypeGpuNode,
  resources?: TypeGpuResourceCollection
): TypeGpuMaterialDescriptor | null {
  const kind = materialKindForNode(node);
  if (!kind) return null;

  const texture = textureSourceFor(node.attributes.map, resources);
  const sampler = samplerDescriptorFor(node.attributes.sampler, resources);
  const textureKey = textureKeyFor(node.attributes.map, resources);
  const samplerKey = samplerKeyFor(node.attributes.sampler, resources);
  const color = colorTuple(node.attributes.color);
  const opacity = numberArg(node.attributes.opacity, color[3]);
  const transparent = Boolean(node.attributes.transparent) || opacity < 1 || color[3] < 1;
  const blendMode = blendModeFor(node.attributes.blendMode, transparent);
  const descriptor: TypeGpuMaterialDescriptor = {
    key: '',
    pipelineKey: '',
    bindGroupKey: '',
    kind,
    color,
    opacity,
    roughness: numberArg(node.attributes.roughness, defaultRoughness(kind)),
    metalness: numberArg(node.attributes.metalness, defaultMetalness(kind)),
    textureKey,
    samplerKey,
    texture,
    sampler,
    transparent,
    depthWrite: booleanArg(node.attributes.depthWrite, !transparent),
    depthTest: booleanArg(node.attributes.depthTest, true),
    cullMode: cullModeFor(node.attributes.cullMode),
    blendMode,
    map: texture
  };

  descriptor.pipelineKey = pipelineKeyFor(descriptor);
  descriptor.bindGroupKey = bindGroupKeyFor(descriptor);
  descriptor.key = materialKeyFor(descriptor);

  return descriptor;
}

export function materialKeyFor(input: TypeGpuMaterialDescriptor): string {
  return [
    `material:${input.kind}`,
    colorKey(input.color),
    `roughness:${input.roughness}`,
    `metalness:${input.metalness}`,
    `opacity:${input.opacity}`,
    input.textureKey ?? 'solid:white',
    input.samplerKey ?? DEFAULT_SAMPLER.key,
    input.blendMode ?? 'opaque',
    input.cullMode ?? 'back'
  ].join('|');
}

export function textureKeyFor(value: unknown, resources?: TypeGpuResourceCollection): string {
  const source = textureSourceFor(value, resources);
  if (!source) return 'solid:white';

  if (source.key) return source.key;
  if (source.kind === 'url' && source.src) return `url:${source.src}`;
  if (source.kind === 'embedded') return `embedded:${source.key ?? 'unknown'}`;
  if (source.kind === 'data') return `data:${source.width ?? 0}:${source.height ?? 0}:${source.format ?? 'rgba8unorm'}`;

  return 'solid:white';
}

export function samplerKeyFor(value: unknown, resources?: TypeGpuResourceCollection): string {
  return samplerDescriptorFor(value, resources).key;
}

export function textureSourceFor(
  value: unknown,
  resources?: TypeGpuResourceCollection
): TypeGpuTextureSource | null {
  if (typeof value === 'string' && value.length > 0) {
    const referenced = resources?.textures.get(value);
    if (referenced) return referenced;

    if (value.startsWith('texture:')) {
      return { kind: 'url', key: value, src: value.slice('texture:'.length) };
    }

    return { kind: 'url', key: `url:${value}`, src: value };
  }

  if (!value || typeof value !== 'object') return null;

  const source = value as Partial<TypeGpuTextureSource>;
  if (source.kind === 'url' && typeof source.src === 'string' && source.src.length > 0) {
    return { kind: 'url', key: source.key ?? `url:${source.src}`, src: source.src };
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
      key: source.key.startsWith('embedded:') ? source.key : `embedded:${source.key}`,
      mimeType: source.mimeType,
      data: source.data
    };
  }

  if (
    source.kind === 'data' &&
    (source.data instanceof Uint8Array ||
      source.data instanceof Uint8ClampedArray ||
      source.data instanceof Float32Array)
  ) {
    const width = numberArg(source.width, 1);
    const height = numberArg(source.height, 1);
    return {
      kind: 'data',
      key: source.key ?? `data:${width}:${height}:${source.format ?? 'rgba8unorm'}`,
      src: source.src ?? '',
      data: source.data,
      width,
      height,
      format: source.format
    };
  }

  return null;
}

export function samplerDescriptorFor(
  value: unknown,
  resources?: TypeGpuResourceCollection
): TypeGpuSamplerDescriptor {
  if (typeof value === 'string' && value.length > 0) {
    return resources?.samplers.get(value) ?? { ...DEFAULT_SAMPLER, key: samplerKey(value) };
  }

  if (!value || typeof value !== 'object') return DEFAULT_SAMPLER;

  const sampler = value as Partial<TypeGpuSamplerDescriptor>;
  return {
    key: sampler.key ?? DEFAULT_SAMPLER.key,
    magFilter: filterMode(sampler.magFilter, DEFAULT_SAMPLER.magFilter),
    minFilter: filterMode(sampler.minFilter, DEFAULT_SAMPLER.minFilter),
    mipmapFilter: mipmapFilterMode(sampler.mipmapFilter, DEFAULT_SAMPLER.mipmapFilter),
    addressModeU: addressMode(sampler.addressModeU, DEFAULT_SAMPLER.addressModeU),
    addressModeV: addressMode(sampler.addressModeV, DEFAULT_SAMPLER.addressModeV),
    addressModeW: addressMode(sampler.addressModeW, DEFAULT_SAMPLER.addressModeW)
  };
}

function materialKindForNode(node: TypeGpuNode): TypeGpuMaterialKind | null {
  if (node.name === 'basicMaterial') return 'basic';
  if (node.name === 'phongMaterial') return 'phong';
  if (node.name === 'standardMaterial') return 'standard';
  return null;
}

function defaultRoughness(kind: TypeGpuMaterialKind): number {
  if (kind === 'basic') return 1;
  if (kind === 'phong') return 0.5;
  return 0.45;
}

function defaultMetalness(kind: TypeGpuMaterialKind): number {
  return kind === 'standard' ? 0.05 : 0;
}

function pipelineKeyFor(input: TypeGpuMaterialDescriptor): string {
  return [
    `material:${input.kind}`,
    `blend:${input.blendMode ?? 'opaque'}`,
    `depthWrite:${input.depthWrite !== false}`,
    `depthTest:${input.depthTest !== false}`,
    `cull:${input.cullMode ?? 'back'}`
  ].join('|');
}

function bindGroupKeyFor(input: TypeGpuMaterialDescriptor): string {
  return [input.textureKey ?? 'solid:white', input.samplerKey ?? DEFAULT_SAMPLER.key].join('|');
}

function colorKey(color: RgbaTuple): string {
  return `color:${color.join(',')}`;
}

function booleanArg(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function blendModeFor(value: unknown, transparent: boolean): 'opaque' | 'alpha' | 'additive' {
  if (value === 'alpha' || value === 'additive' || value === 'opaque') return value;
  return transparent ? 'alpha' : 'opaque';
}

function cullModeFor(value: unknown): GPUCullMode {
  return value === 'none' || value === 'front' || value === 'back' ? value : 'back';
}

function filterMode(value: unknown, fallback: GPUFilterMode): GPUFilterMode {
  return value === 'nearest' || value === 'linear' ? value : fallback;
}

function mipmapFilterMode(value: unknown, fallback: GPUMipmapFilterMode): GPUMipmapFilterMode {
  return value === 'nearest' || value === 'linear' ? value : fallback;
}

function addressMode(value: unknown, fallback: GPUAddressMode): GPUAddressMode {
  return value === 'clamp-to-edge' || value === 'repeat' || value === 'mirror-repeat'
    ? value
    : fallback;
}

function samplerKey(value: string): string {
  return value.startsWith('sampler:') ? value : `sampler:${value}`;
}
