export interface ParsedGlbContainer {
  json: GltfJson;
  binary: Uint8Array;
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

function trimJsonPadding(chunk: Uint8Array): Uint8Array {
  let end = chunk.byteLength;

  while (end > 0 && chunk[end - 1] === 0x20) {
    end -= 1;
  }

  return chunk.subarray(0, end);
}
