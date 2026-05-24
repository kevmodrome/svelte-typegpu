# TypeGPU GLB Model Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add static GLB model import through `<model src>` and `<model data>` while keeping the existing Svelte scene graph, TypeGPU batching, and standard material pipeline.

**Architecture:** Add a renderer-native GLB loader that converts supported static glTF primitives into existing TypeGPU vertex data and standard material descriptors. Add a scene-cache-owned async model cache so scene reading can synchronously return ready imported draw items and schedule a resync when loading completes. Extend draw batching and material resources to handle imported geometry keys and embedded GLB textures.

**Tech Stack:** Svelte custom renderer, TypeScript, TypeGPU, WebGPU, Vitest.

---

## File Structure

- Create `src/lib/typegpu-renderer/glb-loader.ts`: parse GLB v2 containers, decode glTF accessors, bake model-local transforms into vertex data, and return `TypeGpuLoadedModel`.
- Create `src/lib/typegpu-renderer/glb-loader.test.ts`: generated GLB fixture tests for parsing, geometry conversion, transforms, materials, textures, and unsupported feature skipping.
- Create `src/lib/typegpu-renderer/glb-test-fixtures.ts`: test-only helpers that generate tiny GLB `ArrayBuffer` fixtures from JSON and binary chunks.
- Create `src/lib/typegpu-renderer/model-cache.ts`: async cache for URL and `ArrayBuffer` model loading with ready/loading/failed states and completion notification.
- Create `src/lib/typegpu-renderer/model-cache.test.ts`: model cache tests with injected loaders and fetch functions.
- Create `src/lib/typegpu-renderer/component-helpers/model.ts`: read `<model>` nodes from the scene graph and turn ready loaded model meshes into `TypeGpuMeshDrawItem` records.
- Create `src/lib/typegpu-renderer/component-helpers/draw-items.ts`: walk the scene graph once and collect procedural mesh draw items plus imported model draw items with inherited transforms.
- Modify `src/lib/typegpu-renderer/types.ts`: add imported geometry descriptors and embedded texture sources.
- Modify `src/lib/typegpu-renderer/materials.ts`: normalize embedded texture sources and key materials by embedded texture identity.
- Modify `src/lib/typegpu-renderer/gpu-renderer.ts`: decode embedded texture image bytes without fetching and keep URL texture behavior intact.
- Modify `src/lib/typegpu-renderer/draw-batch-cache.ts`: accept a model cache, collect imported draw items, resolve imported geometry data, and group by stable imported geometry keys.
- Modify `src/lib/typegpu-renderer/scene-state.ts`: create/pass the model cache and keep cached draw batches coherent.
- Modify `src/lib/typegpu-renderer/scene-dirtiness.ts`: treat `<model>` changes as draw-batch invalidations.
- Modify `src/lib/typegpu-renderer/svelte-renderer.ts`: create the scene cache with an async model-completion callback that schedules a root sync.
- Modify `src/lib/typegpu-renderer/core.test.ts`: add scene-reader, draw-batch, and dirtiness tests for `<model>`.
- Modify `src/lib/typegpu-renderer/component-renderer.test.ts`: verify Svelte custom renderer preserves `<model src>` and `<model data>` attributes.

## Task 1: Embedded Texture And Imported Geometry Types

**Files:**
- Create: `src/lib/typegpu-renderer/materials.test.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Modify: `src/lib/typegpu-renderer/materials.ts`

- [ ] **Step 1: Write failing material tests**

Add `src/lib/typegpu-renderer/materials.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { textureKeyForMaterial, textureSource } from './materials';
import type { TypeGpuEmbeddedTextureSource, TypeGpuStandardMaterialDescriptor } from './types';

describe('TypeGPU material helpers', () => {
  it('normalizes embedded texture sources', () => {
    const data = new Uint8Array([1, 2, 3, 4]);
    const source = textureSource({
      kind: 'embedded',
      key: 'model:chair:image:0',
      mimeType: 'image/png',
      data
    });

    expect(source).toEqual({
      kind: 'embedded',
      key: 'model:chair:image:0',
      mimeType: 'image/png',
      data
    });
  });

  it('keys embedded material textures by stable embedded key', () => {
    const map: TypeGpuEmbeddedTextureSource = {
      kind: 'embedded',
      key: 'model:chair:image:0',
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3, 4])
    };
    const material: TypeGpuStandardMaterialDescriptor = {
      kind: 'standard',
      color: [1, 1, 1, 1],
      roughness: 0.45,
      metalness: 0.05,
      opacity: 1,
      map
    };

    expect(textureKeyForMaterial(material)).toBe('embedded:model:chair:image:0');
  });
});
```

- [ ] **Step 2: Run the failing test**

Run: `npm run test -- src/lib/typegpu-renderer/materials.test.ts`

Expected: FAIL because `TypeGpuEmbeddedTextureSource` is not exported and `textureSource` ignores embedded objects.

- [ ] **Step 3: Add the type and material helper support**

In `src/lib/typegpu-renderer/types.ts`, replace the geometry and texture source definitions with this shape:

```ts
export type TypeGpuProceduralGeometryKind = 'box' | 'sphere';
export type TypeGpuGeometryKind = TypeGpuProceduralGeometryKind | 'imported';

export interface TypeGpuGeometryData {
  key: string;
  vertexData: Float32Array;
  vertexCount: number;
  vertexFloats: number;
}

export interface TypeGpuProceduralGeometryDescriptor {
  kind: TypeGpuProceduralGeometryKind;
  size: Vector3Tuple;
}

export interface TypeGpuImportedGeometryDescriptor {
  kind: 'imported';
  key: string;
  size: Vector3Tuple;
  data: TypeGpuGeometryData;
}

export type TypeGpuGeometryDescriptor =
  | TypeGpuProceduralGeometryDescriptor
  | TypeGpuImportedGeometryDescriptor;

export interface TypeGpuUrlTextureSource {
  kind: 'url';
  src: string;
}

export interface TypeGpuEmbeddedTextureSource {
  kind: 'embedded';
  key: string;
  mimeType: string;
  data: Uint8Array;
}

export type TypeGpuTextureSource = TypeGpuUrlTextureSource | TypeGpuEmbeddedTextureSource;
```

Keep the existing `TypeGpuGeometryData` fields in one place only. Do not leave the previous duplicate `TypeGpuGeometryData` declaration in the file.

In `src/lib/typegpu-renderer/materials.ts`, update `textureSource` and `textureKeyForMaterial`:

```ts
export function textureSource(value: unknown): TypeGpuTextureSource | null {
  if (typeof value === 'string' && value.length > 0) {
    return { kind: 'url', src: value };
  }

  if (value && typeof value === 'object') {
    const source = value as Partial<TypeGpuTextureSource>;

    if (source.kind === 'url' && typeof source.src === 'string' && source.src.length > 0) {
      return { kind: 'url', src: source.src };
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
        key: source.key,
        mimeType: source.mimeType,
        data: source.data
      };
    }
  }

  return null;
}

export function textureKeyForMaterial(material: TypeGpuStandardMaterialDescriptor): string {
  if (!material.map) return 'solid:white';

  return material.map.kind === 'url'
    ? `url:${material.map.src}`
    : `embedded:${material.map.key}`;
}
```

- [ ] **Step 4: Verify the material tests**

Run: `npm run test -- src/lib/typegpu-renderer/materials.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/materials.ts src/lib/typegpu-renderer/materials.test.ts
git commit -m "Add imported geometry and embedded texture types"
```

## Task 2: GLB Fixture Builder And Container Parser

**Files:**
- Create: `src/lib/typegpu-renderer/glb-test-fixtures.ts`
- Create: `src/lib/typegpu-renderer/glb-loader.ts`
- Create: `src/lib/typegpu-renderer/glb-loader.test.ts`

- [ ] **Step 1: Add failing GLB container tests**

Add `src/lib/typegpu-renderer/glb-test-fixtures.ts`:

```ts
export function createGlbFixture(json: object, binary = new Uint8Array()): ArrayBuffer {
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const paddedJson = padChunk(jsonBytes, 0x20);
  const paddedBinary = padChunk(binary, 0);
  const hasBinary = paddedBinary.byteLength > 0;
  const byteLength = 12 + 8 + paddedJson.byteLength + (hasBinary ? 8 + paddedBinary.byteLength : 0);
  const buffer = new ArrayBuffer(byteLength);
  const view = new DataView(buffer);
  let offset = 0;

  view.setUint32(offset, 0x46546c67, true);
  offset += 4;
  view.setUint32(offset, 2, true);
  offset += 4;
  view.setUint32(offset, byteLength, true);
  offset += 4;

  view.setUint32(offset, paddedJson.byteLength, true);
  offset += 4;
  view.setUint32(offset, 0x4e4f534a, true);
  offset += 4;
  new Uint8Array(buffer, offset, paddedJson.byteLength).set(paddedJson);
  offset += paddedJson.byteLength;

  if (hasBinary) {
    view.setUint32(offset, paddedBinary.byteLength, true);
    offset += 4;
    view.setUint32(offset, 0x004e4942, true);
    offset += 4;
    new Uint8Array(buffer, offset, paddedBinary.byteLength).set(paddedBinary);
  }

  return buffer;
}

export function createInvalidGlbHeader(version: number): ArrayBuffer {
  const buffer = createGlbFixture({ asset: { version: '2.0' } });
  new DataView(buffer).setUint32(4, version, true);
  return buffer;
}

function padChunk(bytes: Uint8Array, paddingByte: number): Uint8Array {
  const paddedLength = Math.ceil(bytes.byteLength / 4) * 4;
  const padded = new Uint8Array(paddedLength);
  padded.fill(paddingByte);
  padded.set(bytes);
  return padded;
}
```

Add these tests to `src/lib/typegpu-renderer/glb-loader.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createGlbFixture, createInvalidGlbHeader } from './glb-test-fixtures';
import { parseGlbContainer } from './glb-loader';

describe('GLB loader', () => {
  it('parses a GLB v2 JSON chunk and binary chunk', () => {
    const binary = new Uint8Array([1, 2, 3, 4]);
    const parsed = parseGlbContainer(
      createGlbFixture({ asset: { version: '2.0' }, scenes: [] }, binary)
    );

    expect(parsed.json).toEqual({ asset: { version: '2.0' }, scenes: [] });
    expect(Array.from(parsed.binary)).toEqual([1, 2, 3, 4]);
  });

  it('rejects unsupported GLB versions', () => {
    expect(() => parseGlbContainer(createInvalidGlbHeader(1))).toThrow(
      'Unsupported GLB version 1'
    );
  });
});
```

- [ ] **Step 2: Run the failing GLB parser tests**

Run: `npm run test -- src/lib/typegpu-renderer/glb-loader.test.ts`

Expected: FAIL because `glb-loader.ts` does not exist.

- [ ] **Step 3: Implement GLB container parsing**

Add `src/lib/typegpu-renderer/glb-loader.ts`:

```ts
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
```

- [ ] **Step 4: Verify GLB parser tests**

Run: `npm run test -- src/lib/typegpu-renderer/glb-loader.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/typegpu-renderer/glb-test-fixtures.ts src/lib/typegpu-renderer/glb-loader.ts src/lib/typegpu-renderer/glb-loader.test.ts
git commit -m "Add GLB container parser"
```

## Task 3: Accessor Decoding And Static Primitive Geometry

**Files:**
- Modify: `src/lib/typegpu-renderer/glb-test-fixtures.ts`
- Modify: `src/lib/typegpu-renderer/glb-loader.test.ts`
- Modify: `src/lib/typegpu-renderer/glb-loader.ts`

- [ ] **Step 1: Add failing primitive conversion tests**

Extend `src/lib/typegpu-renderer/glb-test-fixtures.ts` with binary helpers:

```ts
export function float32Bytes(values: number[]): Uint8Array {
  return new Uint8Array(new Float32Array(values).buffer);
}

export function uint16Bytes(values: number[]): Uint8Array {
  return new Uint8Array(new Uint16Array(values).buffer);
}

export function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;

  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return output;
}
```

Add these tests inside `describe('GLB loader', ...)`:

```ts
import { MESH_VERTEX_FLOATS } from './instance-data';
import { concatBytes, float32Bytes, uint16Bytes } from './glb-test-fixtures';
import { loadGlbModel } from './glb-loader';

it('loads an indexed triangle into TypeGPU vertex data', () => {
  const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const normals = float32Bytes([0, 0, 1, 0, 0, 1, 0, 0, 1]);
  const uvs = float32Bytes([0, 0, 1, 0, 0, 1]);
  const indices = uint16Bytes([0, 1, 2]);
  const binary = concatBytes([positions, normals, uvs, indices]);
  const model = loadGlbModel(
    createGlbFixture(
      {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [
          {
            primitives: [
              {
                attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
                indices: 3
              }
            ]
          }
        ],
        buffers: [{ byteLength: binary.byteLength }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
          { buffer: 0, byteOffset: positions.byteLength, byteLength: normals.byteLength },
          {
            buffer: 0,
            byteOffset: positions.byteLength + normals.byteLength,
            byteLength: uvs.byteLength
          },
          {
            buffer: 0,
            byteOffset: positions.byteLength + normals.byteLength + uvs.byteLength,
            byteLength: indices.byteLength
          }
        ],
        accessors: [
          { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: 1, componentType: 5126, count: 3, type: 'VEC3' },
          { bufferView: 2, componentType: 5126, count: 3, type: 'VEC2' },
          { bufferView: 3, componentType: 5123, count: 3, type: 'SCALAR' }
        ]
      },
      binary
    ),
    'model:test'
  );

  expect(model.meshes).toHaveLength(1);
  expect(model.meshes[0].geometry).toMatchObject({
    key: 'model:test:primitive:0',
    vertexCount: 3,
    vertexFloats: MESH_VERTEX_FLOATS
  });
  expect(Array.from(model.meshes[0].geometry.vertexData)).toEqual([
    0, 0, 0, 0, 0, 1, 0, 0,
    1, 0, 0, 0, 0, 1, 1, 0,
    0, 1, 0, 0, 0, 1, 0, 1
  ]);
});

it('uses fallback UVs and generated flat normals when optional attributes are absent', () => {
  const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const model = loadGlbModel(
    createGlbFixture(
      {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        buffers: [{ byteLength: positions.byteLength }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
      },
      positions
    ),
    'model:fallbacks'
  );

  expect(Array.from(model.meshes[0].geometry.vertexData.slice(3, 8))).toEqual([0, 0, 1, 0, 0]);
});
```

- [ ] **Step 2: Run the failing primitive tests**

Run: `npm run test -- src/lib/typegpu-renderer/glb-loader.test.ts`

Expected: FAIL because `loadGlbModel` is not exported.

- [ ] **Step 3: Implement accessor decoding and primitive conversion**

In `src/lib/typegpu-renderer/glb-loader.ts`, add imports:

```ts
import { MESH_VERTEX_FLOATS } from './instance-data';
import { DEFAULT_STANDARD_MATERIAL } from './materials';
import { IDENTITY_TRANSFORM } from './transform';
import type { TypeGpuGeometryData, TypeGpuStandardMaterialDescriptor } from './types';
```

Add loaded model types:

```ts
export interface TypeGpuLoadedModel {
  key: string;
  meshes: TypeGpuLoadedModelMesh[];
}

export interface TypeGpuLoadedModelMesh {
  geometry: TypeGpuGeometryData;
  material: TypeGpuStandardMaterialDescriptor;
  transform: typeof IDENTITY_TRANSFORM;
}
```

Add constants:

```ts
const GL_TRIANGLES = 4;
const COMPONENT_UNSIGNED_SHORT = 5123;
const COMPONENT_UNSIGNED_INT = 5125;
const COMPONENT_FLOAT = 5126;
```

Add `loadGlbModel` and helper functions with these exact signatures:

```ts
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

  const normals =
    typeof primitive.attributes.NORMAL === 'number'
      ? readAccessor(container, primitive.attributes.NORMAL, 'VEC3', COMPONENT_FLOAT)
      : null;
  const uvs =
    typeof primitive.attributes.TEXCOORD_0 === 'number'
      ? readAccessor(container, primitive.attributes.TEXCOORD_0, 'VEC2', COMPONENT_FLOAT)
      : null;
  const indices =
    typeof primitive.indices === 'number' ? readIndexAccessor(container, primitive.indices) : null;
  const vertexData = buildVertexData(positions, normals, uvs, indices);

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
```

Implement `readAccessor`, `readIndexAccessor`, and `buildVertexData` in the same file. `readAccessor` must return `number[][]`, one tuple per accessor element. `readIndexAccessor` must support component types `5123` and `5125`. `buildVertexData` must push `[px, py, pz, nx, ny, nz, u, v]` for each emitted vertex. Generate a flat normal from the first triangle when `NORMAL` is absent by crossing `(b - a)` and `(c - a)` and normalizing the result.

- [ ] **Step 4: Verify primitive conversion tests**

Run: `npm run test -- src/lib/typegpu-renderer/glb-loader.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/typegpu-renderer/glb-test-fixtures.ts src/lib/typegpu-renderer/glb-loader.ts src/lib/typegpu-renderer/glb-loader.test.ts
git commit -m "Load static GLB primitive geometry"
```

## Task 4: Model Transforms, Materials, Embedded Images, And Skipping Rules

**Files:**
- Modify: `src/lib/typegpu-renderer/glb-loader.test.ts`
- Modify: `src/lib/typegpu-renderer/glb-loader.ts`

- [ ] **Step 1: Add failing loader scope tests**

Add tests to `src/lib/typegpu-renderer/glb-loader.test.ts`:

```ts
it('bakes node translation into imported vertex positions', () => {
  const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const model = loadGlbModel(
    createGlbFixture(
      {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0, translation: [10, 0, 0] }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
        buffers: [{ byteLength: positions.byteLength }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
      },
      positions
    ),
    'model:translated'
  );

  expect(Array.from(model.meshes[0].geometry.vertexData.slice(0, 3))).toEqual([10, 0, 0]);
});

it('maps metallic-roughness material fields and embedded base color textures', () => {
  const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const pngBytes = new Uint8Array([137, 80, 78, 71]);
  const binary = concatBytes([positions, pngBytes]);
  const model = loadGlbModel(
    createGlbFixture(
      {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
        buffers: [{ byteLength: binary.byteLength }],
        bufferViews: [
          { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
          { buffer: 0, byteOffset: positions.byteLength, byteLength: pngBytes.byteLength }
        ],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }],
        materials: [
          {
            pbrMetallicRoughness: {
              baseColorFactor: [0.2, 0.3, 0.4, 0.5],
              roughnessFactor: 0.7,
              metallicFactor: 0.8,
              baseColorTexture: { index: 0 }
            }
          }
        ],
        textures: [{ source: 0 }],
        images: [{ bufferView: 1, mimeType: 'image/png' }]
      },
      binary
    ),
    'model:material'
  );

  expect(model.meshes[0].material).toMatchObject({
    color: [0.2, 0.3, 0.4, 0.5],
    roughness: 0.7,
    metalness: 0.8,
    map: {
      kind: 'embedded',
      key: 'model:material:image:0',
      mimeType: 'image/png'
    }
  });
  expect(Array.from(model.meshes[0].material.map?.data ?? [])).toEqual([137, 80, 78, 71]);
});

it('skips unsupported primitive modes and missing position primitives', () => {
  const positions = float32Bytes([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const model = loadGlbModel(
    createGlbFixture(
      {
        asset: { version: '2.0' },
        scenes: [{ nodes: [0] }],
        nodes: [{ mesh: 0 }],
        meshes: [
          {
            primitives: [
              { mode: 1, attributes: { POSITION: 0 } },
              { attributes: { NORMAL: 0 } }
            ]
          }
        ],
        buffers: [{ byteLength: positions.byteLength }],
        bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: positions.byteLength }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' }]
      },
      positions
    ),
    'model:skip'
  );

  expect(model.meshes).toEqual([]);
});
```

- [ ] **Step 2: Run the failing loader scope tests**

Run: `npm run test -- src/lib/typegpu-renderer/glb-loader.test.ts`

Expected: FAIL because transforms and material conversion are not implemented.

- [ ] **Step 3: Implement transform baking and material conversion**

In `src/lib/typegpu-renderer/glb-loader.ts`:

- Change `collectNodePrimitives` to carry a `Float32Array` or `number[]` 4x4 world matrix. Start from identity for root nodes.
- Build a node-local matrix from `matrix` when present. Otherwise compose `translation`, quaternion `rotation`, and `scale`.
- Multiply parent matrix by local matrix before reading that node's primitives.
- Pass the world matrix into `readPrimitive`.
- In `readPrimitive`, apply the world matrix to positions and the normal matrix to normals before writing `vertexData`.
- Add `readMaterial(container, modelKey, primitive.material)` and use it instead of `DEFAULT_STANDARD_MATERIAL`.

Use these exact helper signatures:

```ts
type Matrix4 = [
  number, number, number, number,
  number, number, number, number,
  number, number, number, number,
  number, number, number, number
];

function identityMatrix4(): Matrix4;
function matrixFromNode(node: GltfNode): Matrix4;
function multiplyMatrix4(left: Matrix4, right: Matrix4): Matrix4;
function transformPoint(matrix: Matrix4, point: number[]): number[];
function transformNormal(matrix: Matrix4, normal: number[]): number[];
function readMaterial(
  container: ParsedGlbContainer,
  modelKey: string,
  materialIndex: number | undefined
): TypeGpuStandardMaterialDescriptor;
function readEmbeddedTextureSource(
  container: ParsedGlbContainer,
  modelKey: string,
  textureIndex: number | undefined
): TypeGpuEmbeddedTextureSource | null;
```

`matrixFromNode` must support quaternion `[x, y, z, w]` rotations from glTF. `transformNormal` must ignore translation and normalize the transformed direction. `readEmbeddedTextureSource` must return `null` unless the texture source image has `bufferView`, `mimeType`, and bytes inside the GLB binary chunk.

- [ ] **Step 4: Verify all loader tests**

Run: `npm run test -- src/lib/typegpu-renderer/glb-loader.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/typegpu-renderer/glb-loader.ts src/lib/typegpu-renderer/glb-loader.test.ts
git commit -m "Map GLB transforms and materials"
```

## Task 5: Async Model Cache

**Files:**
- Create: `src/lib/typegpu-renderer/model-cache.ts`
- Create: `src/lib/typegpu-renderer/model-cache.test.ts`

- [ ] **Step 1: Write failing cache tests**

Add `src/lib/typegpu-renderer/model-cache.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createModelCache } from './model-cache';
import type { TypeGpuLoadedModel } from './glb-loader';

function loadedModel(key: string): TypeGpuLoadedModel {
  return { key, meshes: [] };
}

describe('TypeGPU model cache', () => {
  it('starts URL loading once and notifies when ready', async () => {
    const onSettled = vi.fn();
    const loadUrl = vi.fn(async (src: string) => loadedModel(`url:${src}`));
    const cache = createModelCache({ loadUrl, loadData: vi.fn(), onSettled });

    const first = cache.read({ src: '/models/chair.glb' });
    const second = cache.read({ src: '/models/chair.glb' });

    expect(first.status).toBe('loading');
    expect(second.status).toBe('loading');
    expect(loadUrl).toHaveBeenCalledOnce();

    await Promise.resolve();

    expect(onSettled).toHaveBeenCalledOnce();
    expect(cache.read({ src: '/models/chair.glb' })).toMatchObject({
      status: 'ready',
      model: { key: 'url:/models/chair.glb' }
    });
  });

  it('uses ArrayBuffer identity for data cache entries', async () => {
    const firstData = new ArrayBuffer(4);
    const secondData = new ArrayBuffer(4);
    const loadData = vi.fn(async (_data: ArrayBuffer, key: string) => loadedModel(key));
    const cache = createModelCache({ loadUrl: vi.fn(), loadData, onSettled: vi.fn() });

    cache.read({ data: firstData });
    cache.read({ data: firstData });
    cache.read({ data: secondData });

    expect(loadData).toHaveBeenCalledTimes(2);
    expect(loadData.mock.calls[0][1]).toBe('data:1');
    expect(loadData.mock.calls[1][1]).toBe('data:2');
  });
});
```

- [ ] **Step 2: Run the failing cache tests**

Run: `npm run test -- src/lib/typegpu-renderer/model-cache.test.ts`

Expected: FAIL because `model-cache.ts` does not exist.

- [ ] **Step 3: Implement the model cache**

Add `src/lib/typegpu-renderer/model-cache.ts`:

```ts
import { loadGlbModel, type TypeGpuLoadedModel } from './glb-loader';

export type TypeGpuModelCacheEntry =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; model: TypeGpuLoadedModel; revision: number }
  | { status: 'failed'; error: unknown; revision: number };

export interface TypeGpuModelRequest {
  src?: unknown;
  data?: unknown;
}

export interface TypeGpuModelCacheOptions {
  loadUrl?: (src: string) => Promise<TypeGpuLoadedModel>;
  loadData?: (data: ArrayBuffer, key: string) => Promise<TypeGpuLoadedModel>;
  onSettled?: () => void;
}

export interface TypeGpuModelCache {
  read(request: TypeGpuModelRequest): TypeGpuModelCacheEntry;
}

export function createModelCache({
  loadUrl = loadUrlModel,
  loadData = loadDataModel,
  onSettled = () => {}
}: TypeGpuModelCacheOptions = {}): TypeGpuModelCache {
  const urls = new Map<string, TypeGpuModelCacheEntry>();
  const data = new WeakMap<ArrayBuffer, TypeGpuModelCacheEntry>();
  let nextDataKey = 1;
  let revision = 1;

  function settleUrl(src: string, entry: TypeGpuModelCacheEntry): void {
    urls.set(src, entry);
    onSettled();
  }

  function settleData(buffer: ArrayBuffer, entry: TypeGpuModelCacheEntry): void {
    data.set(buffer, entry);
    onSettled();
  }

  return {
    read(request) {
      if (request.data instanceof ArrayBuffer) {
        const existing = data.get(request.data);
        if (existing) return existing;

        const key = `data:${nextDataKey++}`;
        const loading: TypeGpuModelCacheEntry = { status: 'loading' };
        data.set(request.data, loading);
        void loadData(request.data, key)
          .then((model) => settleData(request.data as ArrayBuffer, { status: 'ready', model, revision: revision++ }))
          .catch((error: unknown) => settleData(request.data as ArrayBuffer, { status: 'failed', error, revision: revision++ }));
        return loading;
      }

      if (typeof request.src === 'string' && request.src.length > 0) {
        const existing = urls.get(request.src);
        if (existing) return existing;

        const loading: TypeGpuModelCacheEntry = { status: 'loading' };
        urls.set(request.src, loading);
        void loadUrl(request.src)
          .then((model) => settleUrl(request.src as string, { status: 'ready', model, revision: revision++ }))
          .catch((error: unknown) => settleUrl(request.src as string, { status: 'failed', error, revision: revision++ }));
        return loading;
      }

      return { status: 'idle' };
    }
  };
}

async function loadUrlModel(src: string): Promise<TypeGpuLoadedModel> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`Failed to load GLB model ${src}: ${response.status}`);
  }

  return loadGlbModel(await response.arrayBuffer(), `url:${src}`);
}

async function loadDataModel(data: ArrayBuffer, key: string): Promise<TypeGpuLoadedModel> {
  return loadGlbModel(data, key);
}
```

- [ ] **Step 4: Verify cache tests**

Run: `npm run test -- src/lib/typegpu-renderer/model-cache.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/typegpu-renderer/model-cache.ts src/lib/typegpu-renderer/model-cache.test.ts
git commit -m "Add async GLB model cache"
```

## Task 6: Model Scene Reading And Draw Batching

**Files:**
- Create: `src/lib/typegpu-renderer/component-helpers/model.ts`
- Create: `src/lib/typegpu-renderer/component-helpers/draw-items.ts`
- Modify: `src/lib/typegpu-renderer/draw-batch-cache.ts`
- Modify: `src/lib/typegpu-renderer/scene-state.ts`
- Modify: `src/lib/typegpu-renderer/scene-dirtiness.ts`
- Modify: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing scene and batching tests**

Add tests to `src/lib/typegpu-renderer/core.test.ts`:

```ts
import { createModelCache } from './model-cache';
import type { TypeGpuLoadedModel } from './glb-loader';

function readyModelCache(model: TypeGpuLoadedModel) {
  return createModelCache({
    loadUrl: async () => model,
    loadData: async () => model,
    onSettled: () => {}
  });
}

it('renders ready model cache entries as imported draw batches', async () => {
  const root = createFragment();
  const scene = createElement('scene');
  const modelNode = createElement('model');
  const model: TypeGpuLoadedModel = {
    key: 'url:/models/triangle.glb',
    meshes: [
      {
        geometry: {
          key: 'url:/models/triangle.glb:primitive:0',
          vertexData: new Float32Array([0, 0, 0, 0, 0, 1, 0, 0]),
          vertexCount: 1,
          vertexFloats: 8
        },
        material: {
          kind: 'standard',
          color: [0.2, 0.3, 0.4, 1],
          roughness: 0.6,
          metalness: 0.1,
          opacity: 1,
          map: null
        },
        transform: {
          position: [0, 0, 0],
          rotation: [0, 0, 0],
          scale: [1, 1, 1]
        }
      }
    ]
  };
  const cache = createTypeGpuSceneCache({
    modelCache: readyModelCache(model)
  });

  setAttribute(modelNode, 'src', '/models/triangle.glb');
  setAttribute(modelNode, 'position', [3, 4, 5]);
  insert(scene, modelNode, null);
  insert(root, scene, null);

  createSceneState(root, cache);
  await Promise.resolve();
  const state = createSceneState(root, cache);
  const batch = drawBatch(state, 'mesh:url:/models/triangle.glb:primitive:0:standard:solid:white');

  expect(batch.geometry.key).toBe('url:/models/triangle.glb:primitive:0');
  expect(batch.instanceCount).toBe(1);
  expect(Array.from(batch.instances.slice(0, 4))).toEqual([3, 4, 5, 0]);
});

it('marks draw batches dirty for model node changes', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const modelNode = createElement('model');

  insert(scene, modelNode, null);
  insert(root, scene, null);

  expect(draw-batch invalidation helper(root, modelNode, root.treeRevision)).toBe(true);
  expect(light invalidation helper(root, modelNode, root.treeRevision)).toBe(false);
});
```

- [ ] **Step 2: Run the failing scene and batching tests**

Run: `npm run test -- src/lib/typegpu-renderer/core.test.ts`

Expected: FAIL because `createTypeGpuSceneCache` does not accept a model cache and imported geometry is not batched.

- [ ] **Step 3: Add model draw item collection**

Add `src/lib/typegpu-renderer/component-helpers/model.ts`:

```ts
import { numberArg } from '../attributes';
import { composeTransforms, readLocalTransform } from '../transform';
import type { TypeGpuNode } from '../core';
import type { TypeGpuMeshDrawItem, TypeGpuTransform } from '../types';
import type { TypeGpuModelCache } from '../model-cache';

export function readModelDrawItems(
  modelNode: TypeGpuNode,
  parentTransform: TypeGpuTransform,
  parentRevision: number,
  modelCache: TypeGpuModelCache
): TypeGpuMeshDrawItem[] {
  const entry = modelCache.read({
    src: modelNode.attributes.src,
    data: modelNode.attributes.data
  });

  if (entry.status !== 'ready') return [];

  const modelTransform = composeTransforms(parentTransform, readLocalTransform(modelNode));
  const phase = numberArg(modelNode.attributes.phase, 0);
  const spinSpeed = numberArg(modelNode.attributes.spinSpeed, 0);
  const modelRevision = (parentRevision * 31 + modelNode.uid) * 31 + modelNode.revision;
  const loadedRevision = modelRevision * 31 + entry.revision;

  return entry.model.meshes.map((mesh, index) => ({
    id: modelNode.uid * 1_000_000 + index,
    revision: loadedRevision * 31 + index,
    geometry: {
      kind: 'imported',
      key: mesh.geometry.key,
      size: [1, 1, 1],
      data: mesh.geometry
    },
    material: mesh.material,
    transform: composeTransforms(modelTransform, mesh.transform),
    phase,
    spinSpeed
  }));
}

export function subtreeHasModelNode(node: TypeGpuNode | undefined): boolean {
  if (!node) return false;
  if (node.name === 'model') return true;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (subtreeHasModelNode(child)) return true;
  }

  return false;
}
```

Add `src/lib/typegpu-renderer/component-helpers/draw-items.ts`:

```ts
import { collectMeshDrawItems } from './mesh';
import { readModelDrawItems } from './model';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from '../transform';
import type { TypeGpuNode } from '../core';
import type { TypeGpuMeshDrawItem, TypeGpuTransform } from '../types';
import type { TypeGpuModelCache } from '../model-cache';

interface DrawItemWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function collectDrawItems(
  root: TypeGpuNode,
  modelCache: TypeGpuModelCache
): TypeGpuMeshDrawItem[] {
  const items = [...collectMeshDrawItems(root)];
  collectModelItems(root, { transform: IDENTITY_TRANSFORM, revision: root.treeRevision }, modelCache, items);
  return items;
}

function collectModelItems(
  node: TypeGpuNode,
  context: DrawItemWalkContext,
  modelCache: TypeGpuModelCache,
  items: TypeGpuMeshDrawItem[]
): void {
  let childContext = context;

  if (node.name === 'group') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: (context.revision * 31 + node.uid) * 31 + node.revision
    };
  } else if (node.name === 'model') {
    items.push(...readModelDrawItems(node, context.transform, context.revision, modelCache));
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: (context.revision * 31 + node.uid) * 31 + node.revision
    };
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectModelItems(child, childContext, modelCache, items);
  }
}
```

- [ ] **Step 4: Wire imported geometry into batching and scene cache**

In `src/lib/typegpu-renderer/draw-batch-cache.ts`:

- Import `collectDrawItems` instead of `collectMeshDrawItems`.
- Change `TypeGpuDrawBatchCache.read(root)` to `read(root, modelCache)`.
- Change `DrawBatchKey` to `type DrawBatchKey = \`mesh:${string}:${TypeGpuMaterialKind}:${string}\`;`.
- Add:

```ts
function geometryKeyForDescriptor(geometry: TypeGpuMeshDrawItem['geometry']): string {
  return geometry.kind === 'imported' ? geometry.key : geometry.kind;
}

function geometryDataForDescriptor(
  geometry: TypeGpuMeshDrawItem['geometry'],
  geometries: Record<TypeGpuProceduralGeometryKind, TypeGpuGeometryData>
): TypeGpuGeometryData {
  return geometry.kind === 'imported' ? geometry.data : geometries[geometry.kind];
}
```

- Use `geometryKeyForDescriptor(item.geometry)` in the batch key.
- Use `geometryDataForDescriptor(items[0].geometry, geometries)` when creating each batch.

In `src/lib/typegpu-renderer/scene-state.ts`:

- Add `modelCache: TypeGpuModelCache` to `TypeGpuSceneCache`.
- Add `CreateTypeGpuSceneCacheOptions` with `modelCache?: TypeGpuModelCache` and `onModelSettled?: () => void`.
- Build `modelCache` with `createModelCache({ onSettled: options.onModelSettled })` when one is not injected.
- Call `cache.drawBatchCache.read(root, cache.modelCache)`.

In `src/lib/typegpu-renderer/scene-dirtiness.ts`:

- Import `subtreeHasModelNode`.
- Treat `dirtyNode.name === 'model'` as draw-batch dirty.
- Treat structural scene/group/camera-control/light subtrees containing a model as draw-batch dirty.

- [ ] **Step 5: Verify scene and batching tests**

Run: `npm run test -- src/lib/typegpu-renderer/core.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/component-helpers/model.ts src/lib/typegpu-renderer/component-helpers/draw-items.ts src/lib/typegpu-renderer/draw-batch-cache.ts src/lib/typegpu-renderer/scene-state.ts src/lib/typegpu-renderer/scene-dirtiness.ts src/lib/typegpu-renderer/core.test.ts
git commit -m "Read GLB models into draw batches"
```

## Task 7: Runtime Resync And Embedded Texture Uploads

**Files:**
- Modify: `src/lib/typegpu-renderer/svelte-renderer.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Modify: `src/lib/typegpu-renderer/svelte-renderer.test.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.test.ts`

- [ ] **Step 1: Add failing runtime and texture tests**

In `src/lib/typegpu-renderer/svelte-renderer.test.ts`, add imports:

```ts
import type { TypeGpuLoadedModel } from './glb-loader';
```

Then add a runtime test that proves model-cache settlement schedules a second sync:

```ts
it('resyncs the scene when async model loading settles', async () => {
  const root = createFragment();
  const scene = createElement('scene');
  const modelNode = createElement('model');
  const renderer = fakeRenderer();
  const canvas = new FakeCanvas();
  const loadedModel: TypeGpuLoadedModel = { key: 'url:/models/empty.glb', meshes: [] };
  const loadUrl = vi.fn(async () => loadedModel);
  const runtime = createTypeGpuRuntimeForTest(
    root,
    canvas as unknown as HTMLCanvasElement,
    renderer,
    undefined,
    {
      modelLoaders: { loadUrl }
    }
  );

  setAttribute(modelNode, 'src', '/models/empty.glb');
  insert(scene, modelNode, null);
  insert(root, scene, null);

  runtime.scheduleSync(root);
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();

  expect(loadUrl).toHaveBeenCalledOnce();
  expect(renderer.setScene).toHaveBeenCalledTimes(2);
});
```

In `src/lib/typegpu-renderer/gpu-renderer.test.ts`, add unit tests around exported texture loader helpers rather than constructing WebGPU:

```ts
import { describe, expect, it, vi } from 'vitest';
import { loadMaterialTextureImageSource } from './gpu-renderer';
import type { TypeGpuEmbeddedTextureSource } from './types';

it('decodes embedded texture sources without calling fetch', async () => {
  const originalFetch = globalThis.fetch;
  const fetchSpy = vi.fn();
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  const source: TypeGpuEmbeddedTextureSource = {
    kind: 'embedded',
    key: 'model:image:0',
    mimeType: 'image/png',
    data: new Uint8Array([137, 80, 78, 71])
  };

  await expect(loadMaterialTextureImageSource(source)).rejects.toBeTruthy();
  expect(fetchSpy).not.toHaveBeenCalled();
  globalThis.fetch = originalFetch;
});
```

The embedded decode test uses invalid PNG bytes, so it should reject during image decode. The assertion that matters is that `fetch` is not called.

- [ ] **Step 2: Run the failing runtime and texture tests**

Run: `npm run test -- src/lib/typegpu-renderer/svelte-renderer.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts`

Expected: FAIL because embedded texture source loading is URL-only and runtime model-settle resync is not wired.

- [ ] **Step 3: Wire runtime model-settle resync**

In `src/lib/typegpu-renderer/svelte-renderer.ts`, import cache option types:

```ts
import { createModelCache, type TypeGpuModelCacheOptions } from './model-cache';
```

Extend `RuntimeOptions`:

```ts
interface RuntimeOptions {
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
  modelLoaders?: Pick<TypeGpuModelCacheOptions, 'loadUrl' | 'loadData'>;
}
```

Create the scene cache inside `createRuntime` with a callback:

```ts
const sceneCache = createTypeGpuSceneCache({
  modelCache: options.modelLoaders
    ? createModelCache({
        ...options.modelLoaders,
        onSettled: () => scheduleSync(root)
      })
    : undefined,
  onModelSettled: () => scheduleSync(root)
});
```

Keep the callback in the runtime layer because it has access to the current mutable `root` variable and the existing sync scheduler.

Extend the test helper without breaking existing tests:

```ts
export function createTypeGpuRuntimeForTest(
  root: TypeGpuNode,
  canvas: HTMLCanvasElement,
  gpu: TypeGpuRenderer,
  windowTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'>,
  options: Omit<RuntimeOptions, 'windowTarget'> = {}
): RuntimeState {
  return createRuntime(root, canvas, gpu, { ...options, windowTarget });
}
```

- [ ] **Step 4: Add embedded texture source loading**

In `src/lib/typegpu-renderer/gpu-renderer.ts`:

- Import `TypeGpuTextureSource`.
- Rename `loadTextureImageSource(src: string)` to `loadMaterialTextureImageSource(source: TypeGpuTextureSource)`.
- Keep a URL helper:

```ts
async function loadUrlTextureImageSource(src: string): Promise<LoadedTextureImage> {
  const response = await fetch(src);

  if (!response.ok) {
    throw new Error(`Failed to load material texture ${src}: ${response.status}`);
  }

  return loadBlobTextureImage(await response.blob());
}
```

- Add an embedded helper:

```ts
function loadEmbeddedTextureImageSource(source: TypeGpuEmbeddedTextureSource): Promise<LoadedTextureImage> {
  return loadBlobTextureImage(new Blob([source.data], { type: source.mimeType }));
}
```

- Move the existing blob decode body into `loadBlobTextureImage(blob: Blob)`.
- Change `#loadMaterialTexture(key, src)` to `#loadMaterialTexture(key, source)`.
- Call `void this.#loadMaterialTexture(key, batch.material.map);`.
- In `#loadMaterialTexture`, return early only when `source` is `null`.

- [ ] **Step 5: Verify runtime and texture tests**

Run: `npm run test -- src/lib/typegpu-renderer/svelte-renderer.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/svelte-renderer.ts src/lib/typegpu-renderer/gpu-renderer.ts src/lib/typegpu-renderer/svelte-renderer.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
git commit -m "Resync loaded models and decode embedded textures"
```

## Task 8: Svelte `<model>` API Verification And Full Regression

**Files:**
- Modify: `src/lib/typegpu-renderer/component-renderer.test.ts`
- Modify: `src/lib/typegpu-renderer/core.test.ts`
- Modify: `docs/superpowers/specs/2026-05-23-typegpu-glb-model-import-design.md` only if implementation discovers a spec mismatch that the user approves.

- [ ] **Step 1: Add failing custom-renderer API test**

Add this test to `src/lib/typegpu-renderer/component-renderer.test.ts`:

```ts
it('renders a model node with src and transform attributes', () => {
  const ModelScene = compileTypeGpuSource(`
    <script>
      const data = new ArrayBuffer(8);
    </script>

    <scene>
      <model src="/models/chair.glb" position={[1, 2, 3]} rotation={[0.1, 0.2, 0.3]} scale={2}></model>
      <model data={data} position={[4, 5, 6]}></model>
    </scene>
  `);
  const root = createFragment();

  renderer.render(ModelScene, { target: root });

  const scene = onlyElement(root);
  const [srcModel, dataModel] = scene.children;

  expect(srcModel.name).toBe('model');
  expect(srcModel.attributes).toMatchObject({
    src: '/models/chair.glb',
    position: [1, 2, 3],
    rotation: [0.1, 0.2, 0.3],
    scale: 2
  });
  expect(dataModel.name).toBe('model');
  expect(dataModel.attributes.data).toBeInstanceOf(ArrayBuffer);
});
```

Add this helper near `loadTypeGpuComponent` in the same test file:

```ts
function compileTypeGpuSource(source: string) {
  const filename = 'InlineModelScene.typegpu.svelte';
  const result = compile(source, {
    filename,
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: '/src/lib/typegpu-renderer/svelte-renderer.ts'
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error(`Unable to find compiled component name for ${filename}`);

  const executableCode = result.js.code
    .replace("import $renderer from '/src/lib/typegpu-renderer/svelte-renderer.ts';", '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);
  const createComponent = new Function(
    '$',
    '$renderer',
    `${executableCode}\nreturn ${componentName};`
  );

  return createComponent(svelteClient, renderer) as Parameters<typeof renderer.render>[0];
}
```

- [ ] **Step 2: Run the custom-renderer API test**

Run: `npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts`

Expected: PASS if the generic custom renderer already preserves unknown element names and attributes. If it fails, fix only the custom-renderer behavior needed for `<model>` nodes and rerun this command.

- [ ] **Step 3: Run focused GLB/model regression**

Run:

```bash
npm run test -- \
  src/lib/typegpu-renderer/materials.test.ts \
  src/lib/typegpu-renderer/glb-loader.test.ts \
  src/lib/typegpu-renderer/model-cache.test.ts \
  src/lib/typegpu-renderer/core.test.ts \
  src/lib/typegpu-renderer/svelte-renderer.test.ts \
  src/lib/typegpu-renderer/gpu-renderer.test.ts \
  src/lib/typegpu-renderer/component-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 4: Run full verification**

Run:

```bash
npm run test
npm run build
```

Expected: both commands exit with code 0.

- [ ] **Step 5: Commit final integration**

```bash
git add src/lib/typegpu-renderer/component-renderer.test.ts src/lib/typegpu-renderer/core.test.ts
git commit -m "Verify public GLB model API"
```

If Step 2 required source changes, include those exact source files in the `git add` command.

## Self-Review Checklist

- Spec coverage: Tasks 1 and 7 cover embedded textures. Tasks 2 through 4 cover GLB parsing, accessors, primitives, transforms, materials, and unsupported feature skipping. Task 5 covers async model caching for `src` and `data`. Task 6 covers scene reading, imported draw items, batching, and dirtiness. Task 8 covers public Svelte API and full regression.
- Red-flag scan: This plan contains no open-ended markers and no unspecified validation steps.
- Type consistency: `TypeGpuLoadedModel`, `TypeGpuLoadedModelMesh`, `TypeGpuModelCache`, `TypeGpuEmbeddedTextureSource`, and imported geometry descriptor names are introduced before downstream tasks reference them.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-05-23-typegpu-glb-model-import.md`. Two execution options:

**1. Subagent-Driven (recommended)** - Dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints.
