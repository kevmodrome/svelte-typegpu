import { colorTuple, numberArg } from './attributes';
import { isTgpuFragmentFn } from 'typegpu';
import type { TypeGpuNode } from './core';
import type {
  RgbaTuple,
  TypeGpuMeshFragment,
  TypeGpuMaterialDescriptor,
  TypeGpuMaterialKind,
  TypeGpuSamplerDescriptor,
  TypeGpuShaderMaterialUniformMap,
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
  node: TypeGpuNode
): TypeGpuMaterialDescriptor | null {
  const kind = materialKindForNode(node);
  if (!kind) return null;
  if (kind === 'shader' && !isMeshMaterialFragment(node.attributes.fragment)) return null;

  return createMaterialDescriptor(kind, node.attributes);
}

export interface TypeGpuMaterialDescriptorInput {
  color?: unknown;
  opacity?: unknown;
  roughness?: unknown;
  metalness?: unknown;
  specularExponent?: unknown;
  map?: unknown;
  texture?: unknown;
  sampler?: unknown;
  transparent?: unknown;
  depthWrite?: unknown;
  depthTest?: unknown;
  cullMode?: unknown;
  blendMode?: unknown;
  fragment?: unknown;
  uniforms?: unknown;
}

export function createMaterialDescriptor(
  kind: TypeGpuMaterialKind,
  input: TypeGpuMaterialDescriptorInput = {}
): TypeGpuMaterialDescriptor {
  const textureInput = input.map ?? input.texture;
  const texture = textureSourceFor(textureInput);
  const sampler = samplerDescriptorFor(input.sampler);
  const textureKey = textureKeyFor(textureInput);
  const samplerKey = samplerKeyFor(input.sampler);
  const color = colorTuple(input.color);
  const opacity = numberArg(input.opacity, color[3]);
  const transparent = Boolean(input.transparent) || opacity < 1 || color[3] < 1;
  const inputBlendMode = input.blendMode;
  const explicitBlendMode = isBlendMode(inputBlendMode);
  const explicitDepthWrite = typeof input.depthWrite === 'boolean';
  const explicitDepthTest = typeof input.depthTest === 'boolean';
  const blendMode: TypeGpuMaterialDescriptor['blendMode'] = explicitBlendMode
    ? inputBlendMode
    : transparent
      ? 'alpha'
      : 'opaque';
  const descriptor: TypeGpuMaterialDescriptor = {
    key: '',
    pipelineKey: '',
    bindGroupKey: '',
    kind,
    color,
    opacity,
    roughness: numberArg(input.roughness, defaultRoughness(kind)),
    metalness: numberArg(input.metalness, defaultMetalness(kind)),
    specularExponent: nonNegativeMaterialNumber(input.specularExponent, defaultSpecularExponent(kind)),
    textureKey,
    samplerKey,
    texture,
    sampler,
    transparent,
    depthWrite: booleanArg(input.depthWrite, !transparent),
    depthTest: booleanArg(input.depthTest, true),
    cullMode: cullModeFor(input.cullMode),
    blendMode,
    explicitBlendMode,
    explicitDepthWrite,
    explicitDepthTest,
    map: texture,
    ...(kind === 'shader'
      ? {
          fragment: input.fragment as TypeGpuMeshFragment,
          uniforms: normalizeShaderMaterialUniforms(input.uniforms),
          uniformKey: shaderMaterialUniformKey(normalizeShaderMaterialUniforms(input.uniforms))
        }
      : {})
  } as TypeGpuMaterialDescriptor;

  descriptor.pipelineKey = pipelineKeyFor(descriptor);
  descriptor.bindGroupKey = bindGroupKeyFor(descriptor);
  descriptor.key = materialKeyFor(descriptor);

  return descriptor;
}

export function materialKeyFor(input: TypeGpuMaterialDescriptor): string {
  const keyParts = [
    `material:${input.kind}`,
    colorKey(input.color),
    `roughness:${input.roughness}`,
    `metalness:${input.metalness}`,
    `specularExponent:${input.specularExponent}`,
    `opacity:${input.opacity}`,
    input.textureKey ?? 'solid:white',
    input.samplerKey ?? DEFAULT_SAMPLER.key
  ];

  if (input.kind === 'shader') keyParts.push(input.uniformKey);

  keyParts.push(input.blendMode ?? 'opaque', input.cullMode ?? 'back');

  return keyParts.join('|');
}

export function textureKeyFor(value: unknown): string {
  const source = textureSourceFor(value);
  if (!source) return 'solid:white';

  if (source.key) return source.key;
  if (source.kind === 'url' && source.src) return `url:${source.src}`;
  if (source.kind === 'embedded') return `embedded:${source.key ?? 'unknown'}`;
  if (source.kind === 'data') return `data:${source.width ?? 0}:${source.height ?? 0}:${source.format ?? 'rgba8unorm'}`;

  return 'solid:white';
}

export function samplerKeyFor(value: unknown): string {
  return samplerDescriptorFor(value).key;
}

export function textureSourceFor(value: unknown): TypeGpuTextureSource | null {
  if (typeof value === 'string' && value.length > 0) {
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
    const format = source.format ?? 'rgba8unorm';
    return {
      kind: 'data',
      key: source.key ?? `data:${width}:${height}:${format}:${hashTextureData(source.data)}`,
      src: source.src ?? '',
      data: source.data,
      width,
      height,
      format
    };
  }

  return null;
}

export function samplerDescriptorFor(value: unknown): TypeGpuSamplerDescriptor {
  if (typeof value === 'string' && value.length > 0) {
    return { ...DEFAULT_SAMPLER, key: samplerKey(value) };
  }

  if (!value || typeof value !== 'object') return DEFAULT_SAMPLER;

  const sampler = value as Partial<TypeGpuSamplerDescriptor>;
  const descriptor = {
    key: '',
    magFilter: filterMode(sampler.magFilter, DEFAULT_SAMPLER.magFilter),
    minFilter: filterMode(sampler.minFilter, DEFAULT_SAMPLER.minFilter),
    mipmapFilter: mipmapFilterMode(sampler.mipmapFilter, DEFAULT_SAMPLER.mipmapFilter),
    addressModeU: addressMode(sampler.addressModeU, DEFAULT_SAMPLER.addressModeU),
    addressModeV: addressMode(sampler.addressModeV, DEFAULT_SAMPLER.addressModeV),
    addressModeW: addressMode(sampler.addressModeW, DEFAULT_SAMPLER.addressModeW)
  };

  return {
    ...descriptor,
    key: sampler.key ?? canonicalSamplerKey(descriptor)
  };
}

function materialKindForNode(node: TypeGpuNode): TypeGpuMaterialKind | null {
  if (node.name === 'basicMaterial') return 'basic';
  if (node.name === 'phongMaterial') return 'phong';
  if (node.name === 'standardMaterial') return 'standard';
  if (node.name === 'shaderMaterial') return 'shader';
  return null;
}

function isMeshMaterialFragment(value: unknown): value is TypeGpuMeshFragment {
  if (!isTgpuFragmentFn(value)) return false;

  const input = value.shell.in as Record<string, { type?: string }> | undefined;
  const output = value.shell.out as { type?: string } | undefined;
  if (!input) return false;

  const expected = {
    color: 'vec4f',
    normal: 'vec3f',
    material: 'vec4f',
    world_position: 'vec3f',
    uv: 'vec2f',
    vertex_color: 'vec4f',
    material_extra: 'vec4f'
  } as const;
  const inputKeys = Object.keys(input);

  return (
    inputKeys.length === Object.keys(expected).length &&
    Object.entries(expected).every(([key, type]) => decoratedType(input[key]) === type) &&
    decoratedType(output) === 'vec4f'
  );
}

function decoratedType(value: { type?: string; inner?: { type?: string } } | undefined): string | undefined {
  return value?.inner?.type ?? value?.type;
}

function defaultRoughness(kind: TypeGpuMaterialKind): number {
  if (kind === 'basic') return 1;
  if (kind === 'phong') return 0.5;
  return 0.45;
}

function defaultMetalness(kind: TypeGpuMaterialKind): number {
  return kind === 'standard' ? 0.05 : 0;
}

function defaultSpecularExponent(kind: TypeGpuMaterialKind): number {
  return kind === 'phong' ? 8 : 0;
}

function nonNegativeMaterialNumber(value: unknown, fallback: number): number {
  const resolved = numberArg(value, fallback);
  return Number.isFinite(resolved) ? Math.max(0, resolved) : fallback;
}

function pipelineKeyFor(input: TypeGpuMaterialDescriptor): string {
  return [
    `material:${input.kind}`,
    input.kind === 'shader' ? shaderMaterialFragmentKey(input.fragment) : 'fragment:default',
    `blend:${input.blendMode ?? 'opaque'}`,
    `depthWrite:${input.depthWrite !== false}`,
    `depthTest:${input.depthTest !== false}`,
    `cull:${input.cullMode ?? 'back'}`
  ].join('|');
}

const shaderMaterialFragmentIds = new WeakMap<object, number>();
let nextShaderMaterialFragmentId = 1;

function shaderMaterialFragmentKey(fragment: TypeGpuMeshFragment): string {
  const cached = shaderMaterialFragmentIds.get(fragment);
  if (cached) return `fragment:${cached}`;

  const next = nextShaderMaterialFragmentId++;
  shaderMaterialFragmentIds.set(fragment, next);
  return `fragment:${next}`;
}

function bindGroupKeyFor(input: TypeGpuMaterialDescriptor): string {
  const keyParts = [input.textureKey ?? 'solid:white', input.samplerKey ?? DEFAULT_SAMPLER.key];

  if (input.kind === 'shader') keyParts.push(input.uniformKey);

  return keyParts.join('|');
}

function colorKey(color: RgbaTuple): string {
  return `color:${color.join(',')}`;
}

function booleanArg(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function isBlendMode(value: unknown): value is 'opaque' | 'alpha' | 'additive' {
  return value === 'alpha' || value === 'additive' || value === 'opaque';
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

function canonicalSamplerKey(sampler: Omit<TypeGpuSamplerDescriptor, 'key'>): string {
  if (
    sampler.magFilter === DEFAULT_SAMPLER.magFilter &&
    sampler.minFilter === DEFAULT_SAMPLER.minFilter &&
    sampler.mipmapFilter === DEFAULT_SAMPLER.mipmapFilter &&
    sampler.addressModeU === DEFAULT_SAMPLER.addressModeU &&
    sampler.addressModeV === DEFAULT_SAMPLER.addressModeV &&
    sampler.addressModeW === DEFAULT_SAMPLER.addressModeW
  ) {
    return DEFAULT_SAMPLER.key;
  }

  return [
    `sampler:min:${sampler.minFilter}`,
    `mag:${sampler.magFilter}`,
    `mipmap:${sampler.mipmapFilter}`,
    `u:${sampler.addressModeU}`,
    `v:${sampler.addressModeV}`,
    `w:${sampler.addressModeW}`
  ].join('|');
}

function hashTextureData(data: Uint8Array | Uint8ClampedArray | Float32Array): string {
  const bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  let hash = 0x811c9dc5;

  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function normalizeShaderMaterialUniforms(value: unknown): TypeGpuShaderMaterialUniformMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const uniforms: TypeGpuShaderMaterialUniformMap = {};

  for (const [name, source] of Object.entries(value)) {
    if (!isShaderMaterialUniformName(name)) continue;

    const vector = uniformValue(source);
    if (vector) uniforms[name] = vector;
  }

  return uniforms;
}

function shaderMaterialUniformKey(uniforms: TypeGpuShaderMaterialUniformMap): string {
  const entries = Object.entries(uniforms).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return 'uniforms:default';

  return entries
    .map(([name, value]) => `${name}:${Array.isArray(value) ? value.join(',') : value}`)
    .join('|');
}

function isShaderMaterialUniformName(
  name: string
): name is keyof TypeGpuShaderMaterialUniformMap {
  return /^value[0-7]$/.test(name);
}

function uniformValue(value: unknown): [number, number, number, number] | null {
  if (typeof value === 'number') {
    const scalar = finiteNumber(value);
    return scalar === null ? null : [scalar, 0, 0, 0];
  }

  if (!Array.isArray(value) || value.length < 2 || value.length > 4) return null;

  const x = finiteNumber(value[0]);
  const y = finiteNumber(value[1]);
  const z = value.length > 2 ? finiteNumber(value[2]) : 0;
  const w = value.length > 3 ? finiteNumber(value[3]) : 0;

  if (x === null || y === null || z === null || w === null) return null;

  return [x, y, z, w];
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
