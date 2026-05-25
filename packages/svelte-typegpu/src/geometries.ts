import { boxBounds, planeBounds, sphereBounds } from './bounds';
import { createBoxVertexData } from './box-data';
import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
import { createSphereVertexData } from './sphere-data';
import type {
  TypeGpuBounds,
  TypeGpuGeometryData,
  TypeGpuPrimitiveTopology
} from './types';

export function createBoxGeometryData(
  width: number,
  height: number,
  depth: number
): TypeGpuGeometryData {
  const vertexData = scalePositions(createBoxVertexData(), [width, height, depth]);

  return {
    key: `box:${width}:${height}:${depth}`,
    kind: 'box',
    vertexData,
    vertexCount: vertexData.length / MESH_VERTEX_FLOATS,
    vertexFloats: MESH_VERTEX_FLOATS,
    bounds: boxBounds([width, height, depth]),
    topology: 'triangle-list',
    layoutKey: MESH_VERTEX_LAYOUT_KEY,
    hasVertexAlpha: false
  };
}

export function createPlaneGeometryData(
  width: number,
  height: number,
  widthSegments: number,
  heightSegments: number
): TypeGpuGeometryData {
  const xSegments = Math.max(1, Math.floor(widthSegments));
  const zSegments = Math.max(1, Math.floor(heightSegments));
  const data: number[] = [];

  for (let z = 0; z < zSegments; z += 1) {
    for (let x = 0; x < xSegments; x += 1) {
      const u0 = x / xSegments;
      const u1 = (x + 1) / xSegments;
      const v0 = z / zSegments;
      const v1 = (z + 1) / zSegments;
      const x0 = (u0 - 0.5) * width;
      const x1 = (u1 - 0.5) * width;
      const z0 = (v0 - 0.5) * height;
      const z1 = (v1 - 0.5) * height;

      pushPlaneVertex(data, x0, z0, u0, v0);
      pushPlaneVertex(data, x1, z0, u1, v0);
      pushPlaneVertex(data, x1, z1, u1, v1);
      pushPlaneVertex(data, x0, z0, u0, v0);
      pushPlaneVertex(data, x1, z1, u1, v1);
      pushPlaneVertex(data, x0, z1, u0, v1);
    }
  }

  const vertexData = new Float32Array(data);

  return {
    key: `plane:${width}:${height}:${xSegments}:${zSegments}`,
    kind: 'plane',
    vertexData,
    vertexCount: vertexData.length / MESH_VERTEX_FLOATS,
    vertexFloats: MESH_VERTEX_FLOATS,
    bounds: planeBounds([width, height, 0]),
    topology: 'triangle-list',
    layoutKey: MESH_VERTEX_LAYOUT_KEY,
    hasVertexAlpha: false
  };
}

export function createSphereGeometryData(
  radius: number,
  widthSegments: number,
  heightSegments: number
): TypeGpuGeometryData {
  const segments = Math.max(3, Math.floor(widthSegments));
  const rings = Math.max(2, Math.floor(heightSegments));
  const vertexData = scalePositions(createSphereVertexData(segments, rings), [
    radius * 2,
    radius * 2,
    radius * 2
  ]);

  return {
    key: `sphere:${radius}:${segments}:${rings}`,
    kind: 'sphere',
    vertexData,
    vertexCount: vertexData.length / MESH_VERTEX_FLOATS,
    vertexFloats: MESH_VERTEX_FLOATS,
    bounds: sphereBounds([radius * 2, radius * 2, radius * 2]),
    topology: 'triangle-list',
    layoutKey: MESH_VERTEX_LAYOUT_KEY,
    hasVertexAlpha: false
  };
}

export function createBufferGeometryData(input: {
  key: string;
  vertices: Float32Array;
  indices?: Uint16Array | Uint32Array;
  bounds: TypeGpuBounds;
  topology?: TypeGpuPrimitiveTopology;
}): TypeGpuGeometryData | null {
  if (input.vertices.length === 0 || input.vertices.length % MESH_VERTEX_FLOATS !== 0) {
    return null;
  }

  const vertexData = new Float32Array(input.vertices);
  const indexData = input.indices ? copyIndexData(input.indices) : undefined;
  const vertexCount = vertexData.length / MESH_VERTEX_FLOATS;

  if (indexData) {
    if (!isValidTriangleListIndexData(indexData, vertexCount)) return null;
  } else if (vertexCount % 3 !== 0) {
    return null;
  }

  return {
    key: input.key,
    kind: 'buffer',
    vertexData,
    indexData,
    vertexCount,
    indexCount: indexData?.length,
    indexFormat: indexData instanceof Uint16Array ? 'uint16' : indexData ? 'uint32' : undefined,
    vertexFloats: MESH_VERTEX_FLOATS,
    bounds: {
      min: [...input.bounds.min],
      max: [...input.bounds.max]
    },
    topology: input.topology ?? 'triangle-list',
    layoutKey: MESH_VERTEX_LAYOUT_KEY,
    hasVertexAlpha: hasVertexAlpha(vertexData)
  };
}

function pushPlaneVertex(data: number[], x: number, z: number, u: number, v: number): void {
  data.push(x, 0, z, 0, 1, 0, u, v, 1, 1, 1, 1);
}

function scalePositions(vertexData: Float32Array, scale: [number, number, number]): Float32Array {
  const scaled = new Float32Array(vertexData);

  for (let index = 0; index < scaled.length; index += MESH_VERTEX_FLOATS) {
    scaled[index] *= scale[0];
    scaled[index + 1] *= scale[1];
    scaled[index + 2] *= scale[2];
  }

  return scaled;
}

function copyIndexData(indices: Uint16Array | Uint32Array): Uint16Array | Uint32Array {
  return indices instanceof Uint16Array ? new Uint16Array(indices) : new Uint32Array(indices);
}

function isValidTriangleListIndexData(
  indices: Uint16Array | Uint32Array,
  vertexCount: number
): boolean {
  if (indices.length === 0 || indices.length % 3 !== 0) return false;

  for (const index of indices) {
    if (index >= vertexCount) return false;
  }

  return true;
}

function hasVertexAlpha(vertexData: Float32Array): boolean {
  for (let index = 0; index < vertexData.length; index += MESH_VERTEX_FLOATS) {
    if ((vertexData[index + 11] ?? 1) < 1) return true;
  }

  return false;
}
