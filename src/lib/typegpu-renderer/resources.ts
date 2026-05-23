import { dimensionArg, numberArg } from './attributes';
import type { TypeGpuNode } from './core';
import {
  createBoxGeometryData,
  createBufferGeometryData,
  createPlaneGeometryData,
  createSphereGeometryData
} from './geometries';
import {
  readInlineMaterial as readInlineMaterialDescriptor,
  samplerDescriptorFor,
  textureSourceFor
} from './material-descriptors';
import type {
  TypeGpuBounds,
  TypeGpuGeometryData,
  TypeGpuLiveResourceKeys,
  TypeGpuMaterialDescriptor,
  TypeGpuSamplerDescriptor,
  TypeGpuTextureSource,
  Vector3Tuple
} from './types';

export interface TypeGpuResourceCollection {
  geometries: Map<string, TypeGpuGeometryData>;
  materials: Map<string, TypeGpuMaterialDescriptor>;
  textures: Map<string, TypeGpuTextureSource>;
  samplers: Map<string, TypeGpuSamplerDescriptor>;
  liveResourceKeys: TypeGpuLiveResourceKeys;
}

export function collectSceneResources(root: TypeGpuNode): TypeGpuResourceCollection {
  const resources = createResourceCollection();
  const nodes = [...walk(root)];

  for (const node of nodes) {
    const id = resourceId(node);
    if (!id) continue;

    const geometry = readInlineGeometry(node);
    if (geometry) {
      resources.geometries.set(id, geometry);
      resources.liveResourceKeys.geometry.add(geometry.key);
      continue;
    }

    const texture = readInlineTexture(node);
    if (texture) {
      resources.textures.set(id, texture);
      resources.liveResourceKeys.texture.add(texture.key ?? `texture:${id}`);
      continue;
    }

    const sampler = readInlineSampler(node);
    if (sampler) {
      resources.samplers.set(id, sampler);
      resources.liveResourceKeys.sampler.add(sampler.key);
    }
  }

  for (const node of nodes) {
    const id = resourceId(node);
    if (!id) continue;

    const material = readInlineMaterial(node, resources);
    if (!material) continue;

    resources.materials.set(id, material);
    if (material.key) resources.liveResourceKeys.material.add(material.key);
    if (material.textureKey) resources.liveResourceKeys.texture.add(material.textureKey);
    if (material.samplerKey) resources.liveResourceKeys.sampler.add(material.samplerKey);
  }

  return resources;
}

export function readInlineGeometry(node: TypeGpuNode): TypeGpuGeometryData | null {
  if (node.name === 'boxGeometry') {
    return createBoxGeometryData(
      dimensionArg(node.attributes.width, 1),
      dimensionArg(node.attributes.height, 1),
      dimensionArg(node.attributes.depth, 1)
    );
  }

  if (node.name === 'planeGeometry') {
    return createPlaneGeometryData(
      dimensionArg(node.attributes.width, 1),
      dimensionArg(node.attributes.height, 1),
      segmentArg(node.attributes.widthSegments),
      segmentArg(node.attributes.heightSegments)
    );
  }

  if (node.name === 'sphereGeometry') {
    return createSphereGeometryData(
      dimensionArg(node.attributes.radius, 0.5),
      segmentArg(node.attributes.widthSegments, 16),
      segmentArg(node.attributes.heightSegments, 8)
    );
  }

  if (node.name === 'bufferGeometry') {
    const vertices = node.attributes.vertices;
    const bounds = boundsArg(node.attributes.bounds);
    if (!(vertices instanceof Float32Array) || !bounds) return null;

    return createBufferGeometryData({
      key: stringArg(node.attributes.key) ?? stringArg(node.attributes.id) ?? `buffer:${node.uid}`,
      vertices,
      bounds,
      topology: node.attributes.topology === 'triangle-list' ? 'triangle-list' : undefined
    });
  }

  return null;
}

export function readInlineMaterial(
  node: TypeGpuNode,
  resources?: TypeGpuResourceCollection
): TypeGpuMaterialDescriptor | null {
  return readInlineMaterialDescriptor(node, resources);
}

export function resolveGeometryReference(
  value: unknown,
  resources: TypeGpuResourceCollection
): TypeGpuGeometryData | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  const geometry = resources.geometries.get(value);
  if (!geometry) return null;

  resources.liveResourceKeys.geometry.add(geometry.key);
  return geometry;
}

export function resolveMaterialReference(
  value: unknown,
  resources: TypeGpuResourceCollection
): TypeGpuMaterialDescriptor | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  const material = resources.materials.get(value);
  if (!material) return null;

  if (material.key) resources.liveResourceKeys.material.add(material.key);
  if (material.textureKey) resources.liveResourceKeys.texture.add(material.textureKey);
  if (material.samplerKey) resources.liveResourceKeys.sampler.add(material.samplerKey);
  return material;
}

function createResourceCollection(): TypeGpuResourceCollection {
  return {
    geometries: new Map(),
    materials: new Map(),
    textures: new Map(),
    samplers: new Map(),
    liveResourceKeys: {
      geometry: new Set(),
      material: new Set(),
      texture: new Set(),
      sampler: new Set()
    }
  };
}

function* walk(node: TypeGpuNode): Iterable<TypeGpuNode> {
  yield node;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    yield* walk(child);
  }
}

function readInlineTexture(node: TypeGpuNode): TypeGpuTextureSource | null {
  if (node.name !== 'texture') return null;

  const id = resourceId(node);
  if (!id) return null;

  const src = stringArg(node.attributes.src);
  if (src) {
    return {
      kind: 'url',
      key: `texture:${id}`,
      src,
      format: formatArg(node.attributes.format)
    };
  }

  const source = textureSourceFor({
    kind: 'data',
    key: `texture:${id}`,
    src: '',
    data: node.attributes.data,
    width: node.attributes.width,
    height: node.attributes.height,
    format: node.attributes.format
  });

  return source?.kind === 'data' ? source : null;
}

function readInlineSampler(node: TypeGpuNode): TypeGpuSamplerDescriptor | null {
  if (node.name !== 'sampler') return null;

  const id = resourceId(node);
  if (!id) return null;

  return samplerDescriptorFor({
    ...node.attributes,
    key: `sampler:${id}`
  });
}

function resourceId(node: TypeGpuNode): string | null {
  return stringArg(node.attributes.id);
}

function stringArg(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function segmentArg(value: unknown, fallback = 1): number {
  return Math.max(1, Math.floor(numberArg(value, fallback)));
}

function boundsArg(value: unknown): TypeGpuBounds | null {
  if (!value || typeof value !== 'object') return null;

  const bounds = value as { min?: unknown; max?: unknown };
  const min = vector3Arg(bounds.min);
  const max = vector3Arg(bounds.max);
  if (!min || !max) return null;

  return { min, max };
}

function vector3Arg(value: unknown): Vector3Tuple | null {
  if (!Array.isArray(value) || value.length < 3) return null;

  const vector = [
    numberArg(value[0], Number.NaN),
    numberArg(value[1], Number.NaN),
    numberArg(value[2], Number.NaN)
  ];

  return vector.every(Number.isFinite) ? (vector as Vector3Tuple) : null;
}

function formatArg(value: unknown): GPUTextureFormat | undefined {
  return typeof value === 'string' && value.length > 0 ? (value as GPUTextureFormat) : undefined;
}
