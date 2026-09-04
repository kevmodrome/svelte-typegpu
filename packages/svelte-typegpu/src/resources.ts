import { dimensionArg, numberArg } from './attributes';
import type { TypeGpuNode } from './core';
import {
  createBoxGeometryData,
  createBufferGeometryData,
  createPlaneGeometryData,
  createSphereGeometryData
} from './geometries';
import { readInlineMaterial as readInlineMaterialDescriptor } from './material-descriptors';
import type {
  TypeGpuBounds,
  TypeGpuGeometryData,
  TypeGpuMaterialDescriptor,
  Vector3Tuple
} from './types';

const inlineGeometryCache = new WeakMap<TypeGpuNode, {
  revision: number;
  geometry: TypeGpuGeometryData | null;
}>();

export function readInlineGeometry(node: TypeGpuNode): TypeGpuGeometryData | null {
  const previous = inlineGeometryCache.get(node);
  if (previous?.revision === node.revision) return previous.geometry;

  const geometry = readGeometryAttributes(node);
  inlineGeometryCache.set(node, { revision: node.revision, geometry });
  return geometry;
}

function readGeometryAttributes(node: TypeGpuNode): TypeGpuGeometryData | null {
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
    if (!(vertices instanceof Float32Array) || !bounds) {
      return null;
    }

    const explicitKey = stringArg(node.attributes.key);
    const indices = indicesArg(node.attributes.indices);
    return createBufferGeometryData({
      key: versionedKey(explicitKey ?? autoBufferGeometryKey(vertices, indices), node),
      vertices,
      indices,
      bounds,
      topology: node.attributes.topology === 'triangle-list' ? 'triangle-list' : undefined
    });
  }

  return null;
}

export function readInlineMaterial(node: TypeGpuNode): TypeGpuMaterialDescriptor | null {
  return readInlineMaterialDescriptor(node);
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

function indicesArg(value: unknown): Uint16Array | Uint32Array | undefined {
  return value instanceof Uint16Array || value instanceof Uint32Array ? value : undefined;
}

function versionedKey(base: string, node: TypeGpuNode): string {
  return `${base}@rev:${node.revision}`;
}

const bufferGeometryIds = new WeakMap<ArrayBufferView, number>();
let nextBufferGeometryId = 1;

function autoBufferGeometryKey(vertices: Float32Array, indices?: Uint16Array | Uint32Array): string {
  return `buffer:auto:${bufferIdentity(vertices)}:indices:${indices ? bufferIdentity(indices) : 'none'}`;
}

function bufferIdentity(data: ArrayBufferView): number {
  const cached = bufferGeometryIds.get(data);
  if (cached) return cached;

  const next = nextBufferGeometryId++;
  bufferGeometryIds.set(data, next);
  return next;
}
