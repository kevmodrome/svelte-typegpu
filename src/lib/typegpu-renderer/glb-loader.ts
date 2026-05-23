import { MESH_VERTEX_FLOATS } from './instance-data';
import { DEFAULT_STANDARD_MATERIAL } from './materials';
import { IDENTITY_TRANSFORM } from './transform';
import type { TypeGpuGeometryData, TypeGpuStandardMaterialDescriptor } from './types';

export interface ParsedGlbContainer {
  json: GltfJson;
  binary: Uint8Array;
}

export interface TypeGpuLoadedModel {
  key: string;
  meshes: TypeGpuLoadedModelMesh[];
}

export interface TypeGpuLoadedModelMesh {
  geometry: TypeGpuGeometryData;
  material: TypeGpuStandardMaterialDescriptor;
  transform: typeof IDENTITY_TRANSFORM;
}

export interface GltfJson {
  asset?: { version?: string };
  scenes?: Array<{ nodes?: number[] }>;
  scene?: number;
  nodes?: GltfNode[];
  meshes?: GltfMesh[];
  buffers?: Array<{ byteLength?: number }>;
  bufferViews?: GltfBufferView[];
  accessors?: GltfAccessor[];
  materials?: GltfMaterial[];
  textures?: GltfTexture[];
  images?: GltfImage[];
}

export interface GltfNode {
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export interface GltfMesh {
  primitives?: GltfPrimitive[];
}

export interface GltfPrimitive {
  attributes?: Record<string, number>;
  indices?: number;
  material?: number;
  mode?: number;
  extensions?: Record<string, unknown>;
}

export interface GltfBufferView {
  buffer?: number;
  byteOffset?: number;
  byteLength?: number;
  byteStride?: number;
}

export interface GltfAccessor {
  bufferView?: number;
  byteOffset?: number;
  componentType?: number;
  count?: number;
  type?: string;
  sparse?: unknown;
}

export interface GltfMaterial {
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    metallicFactor?: number;
    roughnessFactor?: number;
    baseColorTexture?: { index?: number };
  };
}

export interface GltfTexture {
  source?: number;
}

export interface GltfImage {
  mimeType?: string;
  bufferView?: number;
}

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const GL_TRIANGLES = 4;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const COMPONENT_FLOAT = 5126;

export function parseGlbContainer(input: ArrayBuffer): ParsedGlbContainer {
  const view = new DataView(input);

  if (input.byteLength < 20) {
    throw new Error('GLB is too short.');
  }

  const magic = view.getUint32(0, true);
  if (magic !== GLB_MAGIC) {
    throw new Error('Invalid GLB magic.');
  }

  const version = view.getUint32(4, true);
  if (version !== GLB_VERSION) {
    throw new Error(`Unsupported GLB version ${version}.`);
  }

  const declaredLength = view.getUint32(8, true);
  if (declaredLength !== input.byteLength) {
    throw new Error('GLB length does not match the buffer length.');
  }

  let offset = 12;
  let json: GltfJson | null = null;
  let binary = new Uint8Array();

  while (offset < input.byteLength) {
    if (offset + 8 > input.byteLength) {
      throw new Error('Malformed GLB chunk header.');
    }

    const chunkLength = view.getUint32(offset, true);
    offset += 4;
    const chunkType = view.getUint32(offset, true);
    offset += 4;

    if (offset + chunkLength > input.byteLength) {
      throw new Error('Malformed GLB chunk length.');
    }

    const chunk = new Uint8Array(input, offset, chunkLength);
    offset += chunkLength;

    if (chunkType === JSON_CHUNK) {
      json = JSON.parse(new TextDecoder().decode(trimJsonPadding(chunk))) as GltfJson;
    } else if (chunkType === BIN_CHUNK) {
      binary = chunk;
    }
  }

  if (!json) {
    throw new Error('GLB JSON chunk is missing.');
  }

  return { json, binary };
}

export function loadGlbModel(input: ArrayBuffer, key: string): TypeGpuLoadedModel {
  const container = parseGlbContainer(input);
  const meshes: TypeGpuLoadedModelMesh[] = [];
  let primitiveIndex = 0;

  for (const nodeIndex of rootNodeIndices(container.json)) {
    collectNodePrimitives(container, key, nodeIndex, meshes, () => primitiveIndex++);
  }

  return { key, meshes };
}

function rootNodeIndices(json: GltfJson): number[] {
  const sceneIndex = json.scene ?? 0;
  return json.scenes?.[sceneIndex]?.nodes ?? [];
}

function collectNodePrimitives(
  container: ParsedGlbContainer,
  modelKey: string,
  nodeIndex: number,
  meshes: TypeGpuLoadedModelMesh[],
  nextPrimitiveIndex: () => number
): void {
  const node = container.json.nodes?.[nodeIndex];
  if (!node) return;

  if (typeof node.mesh === 'number') {
    const mesh = container.json.meshes?.[node.mesh];

    for (const primitive of mesh?.primitives ?? []) {
      const loaded = readPrimitive(container, modelKey, primitive, nextPrimitiveIndex());
      if (loaded) meshes.push(loaded);
    }
  }

  for (const childIndex of node.children ?? []) {
    collectNodePrimitives(container, modelKey, childIndex, meshes, nextPrimitiveIndex);
  }
}

function readPrimitive(
  container: ParsedGlbContainer,
  modelKey: string,
  primitive: GltfPrimitive,
  primitiveIndex: number
): TypeGpuLoadedModelMesh | null {
  if ((primitive.mode ?? GL_TRIANGLES) !== GL_TRIANGLES) return null;
  if (!primitive.attributes || typeof primitive.attributes.POSITION !== 'number') return null;
  if (primitive.extensions?.KHR_draco_mesh_compression || primitive.extensions?.EXT_meshopt_compression) {
    return null;
  }

  const positions = readAccessor(container, primitive.attributes.POSITION, 'VEC3', COMPONENT_FLOAT);
  if (!positions) return null;

  const normals = readOptionalAccessor(
    container,
    primitive.attributes,
    'NORMAL',
    'VEC3',
    COMPONENT_FLOAT
  );
  if (normals === undefined) return null;

  const uvs = readOptionalAccessor(
    container,
    primitive.attributes,
    'TEXCOORD_0',
    'VEC2',
    COMPONENT_FLOAT
  );
  if (uvs === undefined) return null;

  const indices = readOptionalIndexAccessor(container, primitive);
  if (indices === undefined) return null;

  const vertexData = buildVertexData(positions, normals, uvs, indices);
  if (!vertexData) return null;

  return {
    geometry: {
      key: `${modelKey}:primitive:${primitiveIndex}`,
      vertexData,
      vertexCount: vertexData.length / MESH_VERTEX_FLOATS,
      vertexFloats: MESH_VERTEX_FLOATS
    },
    material: DEFAULT_STANDARD_MATERIAL,
    transform: IDENTITY_TRANSFORM
  };
}

function readOptionalAccessor(
  container: ParsedGlbContainer,
  attributes: Record<string, number>,
  name: string,
  expectedType: string,
  expectedComponentType: number
): number[][] | null | undefined {
  if (!hasOwn(attributes, name)) return null;

  const accessorIndex = attributes[name];
  if (!isNonNegativeInteger(accessorIndex)) return undefined;

  return readAccessor(container, accessorIndex, expectedType, expectedComponentType) ?? undefined;
}

function readOptionalIndexAccessor(
  container: ParsedGlbContainer,
  primitive: GltfPrimitive
): number[] | null | undefined {
  if (!hasOwn(primitive, 'indices')) return null;
  if (!isNonNegativeInteger(primitive.indices)) return undefined;

  return readIndexAccessor(container, primitive.indices) ?? undefined;
}

function readAccessor(
  container: ParsedGlbContainer,
  accessorIndex: number,
  expectedType: string,
  expectedComponentType: number
): number[][] | null {
  const accessor = container.json.accessors?.[accessorIndex];
  if (!accessor) return null;
  if (accessor.sparse) return null;
  if (accessor.type !== expectedType) return null;
  if (accessor.componentType !== expectedComponentType) return null;
  if (!isNonNegativeInteger(accessor.bufferView)) return null;
  if (!isNonNegativeInteger(accessor.count)) return null;

  const componentCount = accessorComponentCount(accessor.type);
  const componentSize = componentByteSize(accessor.componentType);
  if (!componentCount || !componentSize) return null;

  const bufferView = container.json.bufferViews?.[accessor.bufferView];
  const view = dataViewForBufferView(container, bufferView);
  if (!bufferView || !view) return null;

  const accessorOffset = accessor.byteOffset ?? 0;
  if (!isNonNegativeInteger(accessorOffset)) return null;

  const elementByteSize = componentCount * componentSize;
  const stride = bufferView.byteStride ?? componentCount * componentSize;
  if (!isNonNegativeInteger(stride)) return null;
  if (stride < elementByteSize) return null;
  if (
    !accessorFitsBufferView(accessorOffset, stride, elementByteSize, accessor.count, view.byteLength)
  ) {
    return null;
  }

  const values: number[][] = [];

  for (let index = 0; index < accessor.count; index += 1) {
    const elementOffset = accessorOffset + index * stride;
    const element: number[] = [];

    for (let component = 0; component < componentCount; component += 1) {
      element.push(view.getFloat32(elementOffset + component * componentSize, true));
    }

    values.push(element);
  }

  return values;
}

function readIndexAccessor(container: ParsedGlbContainer, accessorIndex: number): number[] | null {
  const accessor = container.json.accessors?.[accessorIndex];
  if (!accessor) return null;
  if (accessor.sparse) return null;
  if (accessor.type !== 'SCALAR') return null;
  if (!isNonNegativeInteger(accessor.bufferView)) return null;
  if (!isNonNegativeInteger(accessor.count)) return null;
  if (
    accessor.componentType !== COMPONENT_UNSIGNED_SHORT &&
    accessor.componentType !== COMPONENT_UNSIGNED_INT
  ) {
    return null;
  }

  const componentSize = componentByteSize(accessor.componentType);
  if (!componentSize) return null;

  const bufferView = container.json.bufferViews?.[accessor.bufferView];
  const view = dataViewForBufferView(container, bufferView);
  if (!bufferView || !view) return null;

  const accessorOffset = accessor.byteOffset ?? 0;
  if (!isNonNegativeInteger(accessorOffset)) return null;

  const stride = bufferView.byteStride ?? componentSize;
  if (!isNonNegativeInteger(stride)) return null;
  if (stride < componentSize) return null;
  if (
    !accessorFitsBufferView(accessorOffset, stride, componentSize, accessor.count, view.byteLength)
  ) {
    return null;
  }

  const values: number[] = [];

  for (let index = 0; index < accessor.count; index += 1) {
    const elementOffset = accessorOffset + index * stride;
    values.push(
      accessor.componentType === COMPONENT_UNSIGNED_SHORT
        ? view.getUint16(elementOffset, true)
        : view.getUint32(elementOffset, true)
    );
  }

  return values;
}

function buildVertexData(
  positions: number[][],
  normals: number[][] | null,
  uvs: number[][] | null,
  indices: number[] | null
): Float32Array | null {
  const vertexIndices = indices ?? positions.map((_, index) => index);
  if (vertexIndices.length === 0 || vertexIndices.length % 3 !== 0) return null;

  for (const vertexIndex of vertexIndices) {
    if (!isNonNegativeInteger(vertexIndex) || vertexIndex >= positions.length) return null;
    if (normals && vertexIndex >= normals.length) return null;
    if (uvs && vertexIndex >= uvs.length) return null;
  }

  const vertexData: number[] = [];

  for (let triangleOffset = 0; triangleOffset < vertexIndices.length; triangleOffset += 3) {
    const flatNormal = normals
      ? null
      : generateFlatNormal(positions, [
          vertexIndices[triangleOffset] ?? 0,
          vertexIndices[triangleOffset + 1] ?? 0,
          vertexIndices[triangleOffset + 2] ?? 0
        ]);

    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
      const vertexIndex = vertexIndices[triangleOffset + vertexOffset] ?? 0;
      const position = positions[vertexIndex] ?? [0, 0, 0];
      const normal = normals?.[vertexIndex] ?? flatNormal ?? [0, 0, 1];
      const uv = uvs?.[vertexIndex] ?? [0, 0];

      vertexData.push(
        position[0] ?? 0,
        position[1] ?? 0,
        position[2] ?? 0,
        normal[0] ?? 0,
        normal[1] ?? 0,
        normal[2] ?? 1,
        uv[0] ?? 0,
        uv[1] ?? 0
      );
    }
  }

  return new Float32Array(vertexData);
}

function dataViewForBufferView(
  container: ParsedGlbContainer,
  bufferView: GltfBufferView | undefined
): DataView | null {
  if (!bufferView) return null;
  if ((bufferView.buffer ?? 0) !== 0) return null;
  if (!isNonNegativeInteger(bufferView.byteLength)) return null;

  const byteOffset = bufferView.byteOffset ?? 0;
  if (!isNonNegativeInteger(byteOffset)) return null;
  if (byteOffset + bufferView.byteLength > container.binary.byteLength) return null;

  return new DataView(
    container.binary.buffer,
    container.binary.byteOffset + byteOffset,
    bufferView.byteLength
  );
}

function accessorFitsBufferView(
  byteOffset: number,
  byteStride: number,
  elementByteSize: number,
  count: number,
  bufferViewByteLength: number
): boolean {
  if (byteOffset > bufferViewByteLength) return false;
  if (count === 0) return true;

  const finalByte = byteOffset + (count - 1) * byteStride + elementByteSize;
  return finalByte <= bufferViewByteLength;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function accessorComponentCount(type: string): number | null {
  switch (type) {
    case 'SCALAR':
      return 1;
    case 'VEC2':
      return 2;
    case 'VEC3':
      return 3;
    case 'VEC4':
      return 4;
    default:
      return null;
  }
}

function componentByteSize(componentType: number | undefined): number | null {
  switch (componentType) {
    case COMPONENT_UNSIGNED_SHORT:
      return 2;
    case COMPONENT_UNSIGNED_INT:
    case COMPONENT_FLOAT:
      return 4;
    default:
      return null;
  }
}

function generateFlatNormal(positions: number[][], indices: number[]): number[] {
  const a = positions[indices[0] ?? 0] ?? [0, 0, 0];
  const b = positions[indices[1] ?? 1] ?? [0, 0, 0];
  const c = positions[indices[2] ?? 2] ?? [0, 0, 0];
  const ab = [
    (b[0] ?? 0) - (a[0] ?? 0),
    (b[1] ?? 0) - (a[1] ?? 0),
    (b[2] ?? 0) - (a[2] ?? 0)
  ];
  const ac = [
    (c[0] ?? 0) - (a[0] ?? 0),
    (c[1] ?? 0) - (a[1] ?? 0),
    (c[2] ?? 0) - (a[2] ?? 0)
  ];
  const normal = [
    ab[1] * ac[2] - ab[2] * ac[1],
    ab[2] * ac[0] - ab[0] * ac[2],
    ab[0] * ac[1] - ab[1] * ac[0]
  ];
  const length = Math.hypot(normal[0], normal[1], normal[2]);

  if (length === 0) return [0, 0, 1];
  return [normal[0] / length, normal[1] / length, normal[2] / length];
}

function trimJsonPadding(chunk: Uint8Array): Uint8Array {
  let end = chunk.byteLength;

  while (end > 0 && chunk[end - 1] === 0x20) {
    end -= 1;
  }

  return chunk.subarray(0, end);
}
