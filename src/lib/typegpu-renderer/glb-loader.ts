import { MESH_VERTEX_FLOATS } from './instance-data';
import { DEFAULT_STANDARD_MATERIAL } from './materials';
import { IDENTITY_TRANSFORM } from './transform';
import type {
  TypeGpuEmbeddedTextureSource,
  TypeGpuGeometryData,
  TypeGpuStandardMaterialDescriptor
} from './types';

type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

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
    collectNodePrimitives(
      container,
      key,
      nodeIndex,
      identityMatrix4(),
      meshes,
      () => primitiveIndex++
    );
  }

  return { key, meshes };
}

function rootNodeIndices(json: GltfJson): number[] {
  const sceneIndex = json.scene === undefined
    ? 0
    : isNonNegativeInteger(json.scene)
      ? json.scene
      : -1;
  const nodes = json.scenes?.[sceneIndex]?.nodes;
  return Array.isArray(nodes) ? nodes.filter(isNonNegativeInteger) : [];
}

function collectNodePrimitives(
  container: ParsedGlbContainer,
  modelKey: string,
  nodeIndex: number,
  parentMatrix: Matrix4,
  meshes: TypeGpuLoadedModelMesh[],
  nextPrimitiveIndex: () => number,
  path: Set<number> = new Set()
): void {
  if (!isNonNegativeInteger(nodeIndex) || path.has(nodeIndex)) return;

  const node = container.json.nodes?.[nodeIndex];
  if (!isRecord(node)) return;

  path.add(nodeIndex);

  const worldMatrix = multiplyMatrix4(parentMatrix, matrixFromNode(node));

  if (typeof node.mesh === 'number') {
    const mesh = container.json.meshes?.[node.mesh];
    const primitives = isRecord(mesh) && Array.isArray(mesh.primitives)
      ? mesh.primitives
      : [];

    for (const primitive of primitives) {
      if (!isRecord(primitive)) continue;
      const loaded = readPrimitive(container, modelKey, primitive, nextPrimitiveIndex(), worldMatrix);
      if (loaded) meshes.push(loaded);
    }
  }

  const children = Array.isArray(node.children) ? node.children : [];
  for (const childIndex of children) {
    collectNodePrimitives(container, modelKey, childIndex, worldMatrix, meshes, nextPrimitiveIndex, path);
  }

  path.delete(nodeIndex);
}

function readPrimitive(
  container: ParsedGlbContainer,
  modelKey: string,
  primitive: GltfPrimitive,
  primitiveIndex: number,
  worldMatrix: Matrix4
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

  const transformedPositions = positions.map((position) => transformPoint(worldMatrix, position));
  const transformedNormals = normals?.map((normal) => transformNormal(worldMatrix, normal)) ?? null;
  const vertexData = buildVertexData(
    transformedPositions,
    transformedNormals,
    uvs,
    indices,
    matrixDeterminant3(worldMatrix) < 0
  );
  if (!vertexData) return null;

  return {
    geometry: {
      key: `${modelKey}:primitive:${primitiveIndex}`,
      vertexData,
      vertexCount: vertexData.length / MESH_VERTEX_FLOATS,
      vertexFloats: MESH_VERTEX_FLOATS
    },
    material: readMaterial(container, modelKey, primitive.material),
    transform: IDENTITY_TRANSFORM
  };
}

function identityMatrix4(): Matrix4 {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1
  ];
}

function matrixFromNode(node: GltfNode): Matrix4 {
  if (node.matrix?.length === 16) {
    return [...node.matrix] as Matrix4;
  }

  const [tx, ty, tz] = node.translation ?? [0, 0, 0];
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
  const [sx, sy, sz] = node.scale ?? [1, 1, 1];
  const xx = x * x;
  const xy = x * y;
  const xz = x * z;
  const xw = x * w;
  const yy = y * y;
  const yz = y * z;
  const yw = y * w;
  const zz = z * z;
  const zw = z * w;

  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + zw) * sx,
    2 * (xz - yw) * sx,
    0,
    2 * (xy - zw) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + xw) * sy,
    0,
    2 * (xz + yw) * sz,
    2 * (yz - xw) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx ?? 0,
    ty ?? 0,
    tz ?? 0,
    1
  ];
}

function multiplyMatrix4(left: Matrix4, right: Matrix4): Matrix4 {
  const result = new Array<number>(16);

  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      result[column * 4 + row] =
        left[0 * 4 + row] * right[column * 4 + 0] +
        left[1 * 4 + row] * right[column * 4 + 1] +
        left[2 * 4 + row] * right[column * 4 + 2] +
        left[3 * 4 + row] * right[column * 4 + 3];
    }
  }

  return result as Matrix4;
}

function transformPoint(matrix: Matrix4, point: number[]): number[] {
  const x = point[0] ?? 0;
  const y = point[1] ?? 0;
  const z = point[2] ?? 0;
  const w = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];

  const transformed = [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]
  ];

  if (w && w !== 1) {
    return [transformed[0] / w, transformed[1] / w, transformed[2] / w];
  }

  return transformed;
}

function transformNormal(matrix: Matrix4, normal: number[]): number[] {
  const x = normal[0] ?? 0;
  const y = normal[1] ?? 0;
  const z = normal[2] ?? 1;
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];
  const b01 = a22 * a11 - a12 * a21;
  const b11 = -a22 * a10 + a12 * a20;
  const b21 = a21 * a10 - a11 * a20;
  const determinant = a00 * b01 + a01 * b11 + a02 * b21;

  if (determinant === 0) {
    return normalizeVector([
      a00 * x + a01 * y + a02 * z,
      a10 * x + a11 * y + a12 * z,
      a20 * x + a21 * y + a22 * z
    ]);
  }

  const inverseDeterminant = 1 / determinant;
  return normalizeVector([
    b01 * inverseDeterminant * x +
      b11 * inverseDeterminant * y +
      b21 * inverseDeterminant * z,
    (-a22 * a01 + a02 * a21) * inverseDeterminant * x +
      (a22 * a00 - a02 * a20) * inverseDeterminant * y +
      (-a21 * a00 + a01 * a20) * inverseDeterminant * z,
    (a12 * a01 - a02 * a11) * inverseDeterminant * x +
      (-a12 * a00 + a02 * a10) * inverseDeterminant * y +
      (a11 * a00 - a01 * a10) * inverseDeterminant * z
  ]);
}

function matrixDeterminant3(matrix: Matrix4): number {
  const a00 = matrix[0];
  const a01 = matrix[4];
  const a02 = matrix[8];
  const a10 = matrix[1];
  const a11 = matrix[5];
  const a12 = matrix[9];
  const a20 = matrix[2];
  const a21 = matrix[6];
  const a22 = matrix[10];

  return (
    a00 * (a22 * a11 - a12 * a21) +
    a01 * (-a22 * a10 + a12 * a20) +
    a02 * (a21 * a10 - a11 * a20)
  );
}

function readMaterial(
  container: ParsedGlbContainer,
  modelKey: string,
  materialIndex: number | undefined
): TypeGpuStandardMaterialDescriptor {
  const material = isNonNegativeInteger(materialIndex)
    ? container.json.materials?.[materialIndex]
    : undefined;
  const pbr = material?.pbrMetallicRoughness;
  const color = pbr?.baseColorFactor;

  return {
    kind: 'standard',
    color: color?.length === 4
      ? [color[0] ?? 1, color[1] ?? 1, color[2] ?? 1, color[3] ?? 1]
      : [...DEFAULT_STANDARD_MATERIAL.color],
    roughness: pbr?.roughnessFactor ?? 1,
    metalness: pbr?.metallicFactor ?? 1,
    opacity: 1,
    map: readEmbeddedTextureSource(container, modelKey, pbr?.baseColorTexture?.index)
  };
}

function readEmbeddedTextureSource(
  container: ParsedGlbContainer,
  modelKey: string,
  textureIndex: number | undefined
): TypeGpuEmbeddedTextureSource | null {
  if (!isNonNegativeInteger(textureIndex)) return null;

  const imageIndex = container.json.textures?.[textureIndex]?.source;
  if (!isNonNegativeInteger(imageIndex)) return null;

  const image = container.json.images?.[imageIndex];
  if (
    !image ||
    !isNonNegativeInteger(image.bufferView) ||
    typeof image.mimeType !== 'string' ||
    image.mimeType.length === 0
  ) {
    return null;
  }

  const bytes = bytesForBufferView(container, container.json.bufferViews?.[image.bufferView]);
  if (!bytes || bytes.byteLength === 0) return null;

  return {
    kind: 'embedded',
    key: `${modelKey}:image:${imageIndex}`,
    mimeType: image.mimeType,
    data: bytes
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
  indices: number[] | null,
  reverseWinding = false
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
    const triangleIndices = [
      vertexIndices[triangleOffset] ?? 0,
      vertexIndices[triangleOffset + 1] ?? 0,
      vertexIndices[triangleOffset + 2] ?? 0
    ];
    if (reverseWinding) triangleIndices.reverse();

    const flatNormal = normals ? null : generateFlatNormal(positions, triangleIndices);

    for (let vertexOffset = 0; vertexOffset < 3; vertexOffset += 1) {
      const vertexIndex = triangleIndices[vertexOffset] ?? 0;
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

function bytesForBufferView(
  container: ParsedGlbContainer,
  bufferView: GltfBufferView | undefined
): Uint8Array | null {
  if (!bufferView) return null;
  if ((bufferView.buffer ?? 0) !== 0) return null;
  if (!isNonNegativeInteger(bufferView.byteLength)) return null;

  const byteOffset = bufferView.byteOffset ?? 0;
  if (!isNonNegativeInteger(byteOffset)) return null;
  if (byteOffset + bufferView.byteLength > container.binary.byteLength) return null;

  return container.binary.slice(byteOffset, byteOffset + bufferView.byteLength);
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

function hasOwn(object: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
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

function normalizeVector(vector: number[]): number[] {
  const length = Math.hypot(vector[0] ?? 0, vector[1] ?? 0, vector[2] ?? 0);

  if (length === 0) return [0, 0, 1];
  return [
    cleanFloat((vector[0] ?? 0) / length),
    cleanFloat((vector[1] ?? 0) / length),
    cleanFloat((vector[2] ?? 0) / length)
  ];
}

function cleanFloat(value: number): number {
  return Math.abs(value) < 1e-12 ? 0 : value;
}

function trimJsonPadding(chunk: Uint8Array): Uint8Array {
  let end = chunk.byteLength;

  while (end > 0 && chunk[end - 1] === 0x20) {
    end -= 1;
  }

  return chunk.subarray(0, end);
}
