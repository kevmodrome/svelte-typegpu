import { MESH_VERTEX_FLOATS, MESH_VERTEX_LAYOUT_KEY } from './instance-data';
import { createMaterialDescriptor } from './material-descriptors';
import { IDENTITY_TRANSFORM } from './transform';
import type {
  TypeGpuBounds,
  TypeGpuLoadedModel,
  TypeGpuLoadedModelMesh,
  Vector2Tuple,
  Vector3Tuple
} from './types';

interface ObjFaceVertex {
  position: number;
  uv: number | null;
  normal: number | null;
}

export function loadObjModel(input: string, key: string): TypeGpuLoadedModel {
  const positions: Vector3Tuple[] = [];
  const uvs: Vector2Tuple[] = [];
  const normals: Vector3Tuple[] = [];
  const vertexData: number[] = [];

  for (const rawLine of input.split(/\r?\n/)) {
    const line = rawLine.split('#', 1)[0]?.trim() ?? '';
    if (line.length === 0) continue;

    const [command, ...tokens] = line.split(/\s+/);

    if (command === 'v') {
      const position = parseVector3(tokens);
      if (position) positions.push(position);
    } else if (command === 'vt') {
      const uv = parseVector2(tokens);
      if (uv) uvs.push(uv);
    } else if (command === 'vn') {
      const normal = parseVector3(tokens);
      if (normal) normals.push(normalizeVector(normal));
    } else if (command === 'f') {
      appendFace(tokens, positions, uvs, normals, vertexData);
    }
  }

  if (vertexData.length === 0) {
    return { key, meshes: [] };
  }

  const data = new Float32Array(vertexData);
  const mesh: TypeGpuLoadedModelMesh = {
    geometry: {
      key: `${key}:primitive:0`,
      kind: 'imported',
      vertexData: data,
      vertexCount: data.length / MESH_VERTEX_FLOATS,
      vertexFloats: MESH_VERTEX_FLOATS,
      bounds: boundsForVertexData(data),
      topology: 'triangle-list',
      layoutKey: MESH_VERTEX_LAYOUT_KEY,
      hasVertexAlpha: false
    },
    material: createMaterialDescriptor('standard', {
      color: [1, 1, 1, 1],
      roughness: 1,
      metalness: 1,
      opacity: 1
    }),
    transform: IDENTITY_TRANSFORM
  };

  return { key, meshes: [mesh] };
}

function appendFace(
  tokens: string[],
  positions: Vector3Tuple[],
  uvs: Vector2Tuple[],
  normals: Vector3Tuple[],
  vertexData: number[]
): void {
  if (tokens.length < 3) return;

  const vertices = tokens.map((token) =>
    parseFaceVertex(token, positions.length, uvs.length, normals.length)
  );
  if (vertices.some((vertex) => vertex === null)) return;

  const face = vertices as ObjFaceVertex[];
  for (let index = 1; index < face.length - 1; index += 1) {
    appendTriangle([face[0], face[index], face[index + 1]], positions, uvs, normals, vertexData);
  }
}

function appendTriangle(
  vertices: [ObjFaceVertex, ObjFaceVertex, ObjFaceVertex],
  positions: Vector3Tuple[],
  uvs: Vector2Tuple[],
  normals: Vector3Tuple[],
  vertexData: number[]
): void {
  const needsFlatNormal = vertices.some((vertex) => vertex.normal === null);
  const flatNormal = needsFlatNormal
    ? generateFlatNormal(
        positions[vertices[0].position],
        positions[vertices[1].position],
        positions[vertices[2].position]
      )
    : null;

  for (const vertex of vertices) {
    const position = positions[vertex.position];
    const normal = vertex.normal === null ? flatNormal : normals[vertex.normal];
    const uv = vertex.uv === null ? null : uvs[vertex.uv];

    vertexData.push(
      position[0],
      position[1],
      position[2],
      normal?.[0] ?? 0,
      normal?.[1] ?? 0,
      normal?.[2] ?? 1,
      uv?.[0] ?? 0,
      uv?.[1] ?? 0,
      1,
      1,
      1,
      1
    );
  }
}

function parseFaceVertex(
  token: string,
  positionCount: number,
  uvCount: number,
  normalCount: number
): ObjFaceVertex | null {
  const parts = token.split('/');
  if (parts.length > 3) return null;

  const [positionToken, uvToken, normalToken] = parts;
  const position = resolveObjIndex(positionToken, positionCount);
  if (position === null) return null;

  const uv = uvToken === undefined || uvToken === ''
    ? null
    : resolveObjIndex(uvToken, uvCount);
  if (uvToken !== undefined && uvToken !== '' && uv === null) return null;

  const normal = normalToken === undefined || normalToken === ''
    ? null
    : resolveObjIndex(normalToken, normalCount);
  if (normalToken !== undefined && normalToken !== '' && normal === null) return null;

  return { position, uv, normal };
}

function resolveObjIndex(token: string | undefined, count: number): number | null {
  if (token === undefined || token === '') return null;
  if (!/^-?\d+$/.test(token)) return null;

  const parsed = Number.parseInt(token, 10);
  if (!Number.isSafeInteger(parsed) || parsed === 0) return null;

  const index = parsed > 0 ? parsed - 1 : count + parsed;
  return index >= 0 && index < count ? index : null;
}

function parseVector3(tokens: string[]): Vector3Tuple | null {
  if (tokens.length < 3) return null;

  const x = finiteNumber(tokens[0]);
  const y = finiteNumber(tokens[1]);
  const z = finiteNumber(tokens[2]);
  return x === null || y === null || z === null ? null : [x, y, z];
}

function parseVector2(tokens: string[]): Vector2Tuple | null {
  if (tokens.length < 2) return null;

  const u = finiteNumber(tokens[0]);
  const v = finiteNumber(tokens[1]);
  return u === null || v === null ? null : [u, v];
}

function finiteNumber(token: string | undefined): number | null {
  if (token === undefined || token.length === 0) return null;

  const value = Number(token);
  return Number.isFinite(value) ? value : null;
}

function generateFlatNormal(
  first: Vector3Tuple,
  second: Vector3Tuple,
  third: Vector3Tuple
): Vector3Tuple {
  const edgeA: Vector3Tuple = [
    second[0] - first[0],
    second[1] - first[1],
    second[2] - first[2]
  ];
  const edgeB: Vector3Tuple = [
    third[0] - first[0],
    third[1] - first[1],
    third[2] - first[2]
  ];

  return normalizeVector([
    edgeA[1] * edgeB[2] - edgeA[2] * edgeB[1],
    edgeA[2] * edgeB[0] - edgeA[0] * edgeB[2],
    edgeA[0] * edgeB[1] - edgeA[1] * edgeB[0]
  ]);
}

function normalizeVector(vector: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (length === 0) return [0, 0, 1];
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

function boundsForVertexData(vertexData: Float32Array): TypeGpuBounds {
  const min: Vector3Tuple = [Infinity, Infinity, Infinity];
  const max: Vector3Tuple = [-Infinity, -Infinity, -Infinity];

  for (let index = 0; index < vertexData.length; index += MESH_VERTEX_FLOATS) {
    for (let axis = 0; axis < 3; axis += 1) {
      const value = vertexData[index + axis] ?? 0;
      min[axis] = Math.min(min[axis], value);
      max[axis] = Math.max(max[axis], value);
    }
  }

  if (!Number.isFinite(min[0])) {
    return { min: [0, 0, 0], max: [0, 0, 0] };
  }

  return { min, max };
}
