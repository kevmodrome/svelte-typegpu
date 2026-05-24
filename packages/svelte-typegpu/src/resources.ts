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
  geometryNodes: Map<string, TypeGpuNode>;
  materials: Map<string, TypeGpuMaterialDescriptor>;
  materialNodes: Map<string, TypeGpuNode>;
  textures: Map<string, TypeGpuTextureSource>;
  textureNodes: Map<string, TypeGpuNode>;
  samplers: Map<string, TypeGpuSamplerDescriptor>;
  samplerNodes: Map<string, TypeGpuNode>;
  liveResourceKeys: TypeGpuLiveResourceKeys;
}

export interface TypeGpuResolvedResource<T> {
  node: TypeGpuNode;
  value: T;
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
      resources.geometryNodes.set(id, node);
      resources.liveResourceKeys.geometries.add(geometry.key);
      continue;
    }

    const texture = readInlineTexture(node);
    if (texture) {
      resources.textures.set(id, texture);
      resources.textureNodes.set(id, node);
      resources.liveResourceKeys.textures.add(texture.key ?? `texture:${id}`);
      continue;
    }

    const sampler = readInlineSampler(node);
    if (sampler) {
      resources.samplers.set(id, sampler);
      resources.samplerNodes.set(id, node);
      resources.liveResourceKeys.samplers.add(sampler.key);
    }
  }

  for (const node of nodes) {
    const id = resourceId(node);
    if (!id) continue;

    const material = readInlineMaterial(node, resources);
    if (!material) continue;

    resources.materials.set(id, material);
    resources.materialNodes.set(id, node);
    if (material.key) resources.liveResourceKeys.materials.add(material.key);
    if (material.textureKey) resources.liveResourceKeys.textures.add(material.textureKey);
    if (material.samplerKey) resources.liveResourceKeys.samplers.add(material.samplerKey);
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
      key: versionedKey(
        stringArg(node.attributes.key) ?? stringArg(node.attributes.id) ?? `buffer:${node.uid}`,
        node
      ),
      vertices,
      indices: indicesArg(node.attributes.indices),
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
  return resolveGeometryResourceReference(value, resources)?.value ?? null;
}

export function resolveMaterialReference(
  value: unknown,
  resources: TypeGpuResourceCollection
): TypeGpuMaterialDescriptor | null {
  return resolveMaterialResourceReference(value, resources)?.value ?? null;
}

export function resolveGeometryResourceReference(
  value: unknown,
  resources: TypeGpuResourceCollection
): TypeGpuResolvedResource<TypeGpuGeometryData> | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  const geometry = resources.geometries.get(value);
  const node = resources.geometryNodes.get(value);
  if (!geometry || !node) return null;

  resources.liveResourceKeys.geometries.add(geometry.key);
  return { node, value: geometry };
}

export function resolveMaterialResourceReference(
  value: unknown,
  resources: TypeGpuResourceCollection
): TypeGpuResolvedResource<TypeGpuMaterialDescriptor> | null {
  if (typeof value !== 'string' || value.length === 0) return null;

  const material = resources.materials.get(value);
  const node = resources.materialNodes.get(value);
  if (!material || !node) return null;

  if (material.key) resources.liveResourceKeys.materials.add(material.key);
  if (material.textureKey) resources.liveResourceKeys.textures.add(material.textureKey);
  if (material.samplerKey) resources.liveResourceKeys.samplers.add(material.samplerKey);
  return { node, value: material };
}

function createResourceCollection(): TypeGpuResourceCollection {
  return {
    geometries: new Map(),
    geometryNodes: new Map(),
    materials: new Map(),
    materialNodes: new Map(),
    textures: new Map(),
    textureNodes: new Map(),
    samplers: new Map(),
    samplerNodes: new Map(),
    liveResourceKeys: {
      geometries: new Set(),
      materials: new Set(),
      textures: new Set(),
      samplers: new Set(),
      pipelines: new Set()
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
      key: versionedKey(`texture:${id}`, node),
      src,
      format: formatArg(node.attributes.format)
    };
  }

  const source = textureSourceFor({
    kind: 'data',
    key: versionedKey(`texture:${id}`, node),
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
    key: versionedKey(`sampler:${id}`, node)
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

function indicesArg(value: unknown): Uint16Array | Uint32Array | undefined {
  return value instanceof Uint16Array || value instanceof Uint32Array ? value : undefined;
}

function versionedKey(base: string, node: TypeGpuNode): string {
  return `${base}@rev:${node.revision}`;
}
