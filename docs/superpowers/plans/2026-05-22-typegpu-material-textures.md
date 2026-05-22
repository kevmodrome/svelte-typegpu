# TypeGPU Material Textures Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add texture-capable standard materials to the Svelte TypeGPU renderer while keeping resources, layouts, bind groups, and drawing TypeGPU-first.

**Architecture:** Keep scene reading CPU-only and normalize material tags/objects into descriptors. Add UV-capable geometry and material-ready instance data, batch by texture identity, then let the renderer resolve URL textures into TypeGPU textures/samplers/bind groups. The standard pipeline always samples a base-color texture, using a TypeGPU-created 1x1 white fallback for untextured/loading/failed maps.

**Tech Stack:** Svelte custom renderer, TypeScript, Vitest, TypeGPU 0.11, WebGPU through TypeGPU-managed resources.

---

## File Map

- Create `src/lib/typegpu-renderer/materials.ts`: reusable material descriptor factory, texture-source normalization, stable texture keys.
- Modify `src/lib/typegpu-renderer/types.ts`: texture source and richer standard material descriptor types.
- Modify `src/lib/typegpu-renderer/components/material.ts`: normalize inline `<standardMaterial>` props and `material={crate}` objects.
- Modify `src/lib/typegpu-renderer/instance-data.ts`: material-ready instance constants and packing.
- Modify `src/lib/typegpu-renderer/draw-batch-cache.ts`: batch keys include texture identity.
- Modify `src/lib/typegpu-renderer/box-data.ts`: add UVs to box vertex data.
- Modify `src/lib/typegpu-renderer/sphere-data.ts`: add UVs to sphere vertex data.
- Modify `src/lib/typegpu-renderer/typegpu-layouts.ts`: add UV vertex attribute and material bind group layout.
- Modify `src/lib/typegpu-renderer/typegpu-pipeline.ts`: pass UVs and sample material texture through TypeGPU bind group layout.
- Modify `src/lib/typegpu-renderer/gpu-renderer.ts`: add TypeGPU texture cache, fallback texture, material bind groups, and TypeGPU pipeline draw flow.
- Modify `src/Scene.typegpu.svelte`: show at least one textured material in the demo.
- Create `public/textures/checker.svg`: deterministic local texture for the demo and manual verification.
- Update existing tests in `src/lib/typegpu-renderer/*.test.ts` and `src/Scene.typegpu.test.ts`.

## TypeGPU Boundary Rules

- Use `tgpu.vertexLayout`, `tgpu.bindGroupLayout`, `root.createBuffer`, `root.createTexture`, `root.createSampler`, `root.createBindGroup`, `TgpuTexture.write`, and `TgpuRenderPipeline.with(bindGroup).draw(vertexCount)`.
- Use `d.texture2d()` for sampled texture layout entries. Do not use deprecated texture strings such as `{ texture: 'float' }`.
- Do not add `device.createTexture`, `device.createSampler`, `device.createBindGroup`, or `device.createRenderPipeline`.
- If a raw WebGPU call is unavoidable, keep it outside material resources and add a code comment explaining the TypeGPU API gap.

---

### Task 1: Material Descriptors And Normalization

**Files:**
- Create: `src/lib/typegpu-renderer/materials.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Modify: `src/lib/typegpu-renderer/components/material.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing material normalization tests**

Add these imports to `src/lib/typegpu-renderer/core.test.ts`:

```ts
import { createStandardMaterial } from './materials';
import { readMeshMaterial } from './components/material';
```

Add these tests inside the existing `describe('TypeGPU renderer core', ...)` block:

```ts
it('normalizes standard material texture props from inline attributes', () => {
  const mesh = createElement('mesh');
  const material = createElement('standardMaterial');

  setAttribute(material, 'color', [0.2, 0.3, 0.4, 0.8]);
  setAttribute(material, 'roughness', 0.7);
  setAttribute(material, 'metalness', 0.25);
  setAttribute(material, 'opacity', 0.6);
  setAttribute(material, 'map', '/textures/crate.png');
  insert(mesh, material, null);

  expect(readMeshMaterial(mesh)).toEqual({
    kind: 'standard',
    color: [0.2, 0.3, 0.4, 0.8],
    roughness: 0.7,
    metalness: 0.25,
    opacity: 0.6,
    map: { kind: 'url', src: '/textures/crate.png' }
  });
});

it('normalizes reusable standard material objects and lets inline props override them', () => {
  const mesh = createElement('mesh');
  const material = createElement('standardMaterial');
  const reusable = createStandardMaterial({
    color: [0.9, 0.8, 0.7, 1],
    roughness: 0.2,
    metalness: 0.35,
    opacity: 0.9,
    map: '/textures/base.png'
  });

  setAttribute(material, 'material', reusable);
  setAttribute(material, 'roughness', 0.65);
  setAttribute(material, 'map', '/textures/override.png');
  insert(mesh, material, null);

  expect(readMeshMaterial(mesh)).toEqual({
    kind: 'standard',
    color: [0.9, 0.8, 0.7, 1],
    roughness: 0.65,
    metalness: 0.35,
    opacity: 0.9,
    map: { kind: 'url', src: '/textures/override.png' }
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: FAIL because `./materials` and the new descriptor fields do not exist yet.

- [ ] **Step 3: Add material descriptor types**

In `src/lib/typegpu-renderer/types.ts`, replace the current material kind/descriptor with:

```ts
export type TypeGpuMaterialKind = 'standard';

export interface TypeGpuUrlTextureSource {
  kind: 'url';
  src: string;
}

export type TypeGpuTextureSource = TypeGpuUrlTextureSource;

export interface TypeGpuStandardMaterialDescriptor {
  kind: 'standard';
  color: RgbaTuple;
  roughness: number;
  metalness: number;
  opacity: number;
  map: TypeGpuTextureSource | null;
}

export type TypeGpuMaterialDescriptor = TypeGpuStandardMaterialDescriptor;
```

- [ ] **Step 4: Create material helpers**

Create `src/lib/typegpu-renderer/materials.ts`:

```ts
import { colorTuple, numberArg } from './attributes';
import type {
  RgbaTuple,
  TypeGpuStandardMaterialDescriptor,
  TypeGpuTextureSource
} from './types';

export const DEFAULT_STANDARD_MATERIAL: TypeGpuStandardMaterialDescriptor = {
  kind: 'standard',
  color: [1, 1, 1, 1],
  roughness: 0.45,
  metalness: 0.05,
  opacity: 1,
  map: null
};

const TYPEGPU_STANDARD_MATERIAL = Symbol('TypeGPU standard material');

export interface TypeGpuStandardMaterialInit {
  color?: unknown;
  roughness?: unknown;
  metalness?: unknown;
  opacity?: unknown;
  map?: unknown;
}

export type TypeGpuStandardMaterialObject = TypeGpuStandardMaterialDescriptor & {
  readonly [TYPEGPU_STANDARD_MATERIAL]: true;
};

export function createStandardMaterial(
  init: TypeGpuStandardMaterialInit = {}
): TypeGpuStandardMaterialObject {
  return {
    ...normalizeStandardMaterial(DEFAULT_STANDARD_MATERIAL, init),
    [TYPEGPU_STANDARD_MATERIAL]: true
  };
}

export function isStandardMaterialObject(value: unknown): value is TypeGpuStandardMaterialObject {
  return Boolean(value && typeof value === 'object' && TYPEGPU_STANDARD_MATERIAL in value);
}

export function normalizeStandardMaterial(
  base: TypeGpuStandardMaterialDescriptor,
  attrs: TypeGpuStandardMaterialInit
): TypeGpuStandardMaterialDescriptor {
  return {
    kind: 'standard',
    color: attrs.color === undefined ? ([...base.color] as RgbaTuple) : colorTuple(attrs.color),
    roughness: numberArg(attrs.roughness, base.roughness),
    metalness: numberArg(attrs.metalness, base.metalness),
    opacity: numberArg(attrs.opacity, base.opacity),
    map: attrs.map === undefined ? base.map : textureSource(attrs.map)
  };
}

export function textureSource(value: unknown): TypeGpuTextureSource | null {
  if (typeof value === 'string' && value.length > 0) {
    return { kind: 'url', src: value };
  }

  if (value && typeof value === 'object') {
    const source = value as Partial<TypeGpuTextureSource>;
    if (source.kind === 'url' && typeof source.src === 'string' && source.src.length > 0) {
      return { kind: 'url', src: source.src };
    }
  }

  return null;
}

export function textureKeyForMaterial(material: TypeGpuStandardMaterialDescriptor): string {
  return material.map ? `url:${material.map.src}` : 'solid:white';
}
```

- [ ] **Step 5: Update material reader**

Replace `src/lib/typegpu-renderer/components/material.ts` with:

```ts
import {
  DEFAULT_STANDARD_MATERIAL,
  isStandardMaterialObject,
  normalizeStandardMaterial
} from '../materials';
import type { TypeGpuNode } from '../core';
import type { TypeGpuMaterialDescriptor } from '../types';

export interface TypeGpuMaterialReadResult {
  node: TypeGpuNode | null;
  descriptor: TypeGpuMaterialDescriptor;
}

export function readMeshMaterial(mesh: TypeGpuNode): TypeGpuMaterialDescriptor {
  return readMeshMaterialWithNode(mesh).descriptor;
}

export function readMeshMaterialWithNode(mesh: TypeGpuNode): TypeGpuMaterialReadResult {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    if (child.name !== 'standardMaterial') continue;

    const materialAttr = child.attributes.material;
    const base = isStandardMaterialObject(materialAttr)
      ? materialAttr
      : DEFAULT_STANDARD_MATERIAL;

    return {
      node: child,
      descriptor: normalizeStandardMaterial(base, child.attributes)
    };
  }

  return {
    node: null,
    descriptor: normalizeStandardMaterial(DEFAULT_STANDARD_MATERIAL, {})
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: PASS for the new material normalization tests.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/materials.ts src/lib/typegpu-renderer/components/material.ts src/lib/typegpu-renderer/core.test.ts
git commit -m "Add TypeGPU standard material descriptors"
```

---

### Task 2: Material-Ready Instance Data And Texture Batch Keys

**Files:**
- Modify: `src/lib/typegpu-renderer/instance-data.ts`
- Modify: `src/lib/typegpu-renderer/draw-batch-cache.ts`
- Modify: `src/lib/typegpu-renderer/core.test.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing batch and packing tests**

Update existing instance assertions in `src/lib/typegpu-renderer/core.test.ts` to expect opacity and reserved material params:

```ts
expect(boxBatch.instances[16]).toBeCloseTo(0.7);
expect(boxBatch.instances[17]).toBeCloseTo(0.2);
expect(boxBatch.instances[18]).toBeCloseTo(1);
expect(boxBatch.instances[19]).toBeCloseTo(0);
```

Add this test:

```ts
it('splits draw batches by texture identity while preserving same-texture batching', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const first = createTexturedBox('/textures/a.png');
  const second = createTexturedBox('/textures/a.png');
  const third = createTexturedBox('/textures/b.png');

  insert(scene, first, null);
  insert(scene, second, null);
  insert(scene, third, null);
  insert(root, scene, null);

  const state = createSceneState(root);
  const firstBatch = drawBatch(state, 'mesh:box:standard:url:/textures/a.png');
  const secondBatch = drawBatch(state, 'mesh:box:standard:url:/textures/b.png');

  expect(firstBatch.instanceCount).toBe(2);
  expect(secondBatch.instanceCount).toBe(1);
  expect(firstBatch.material.map).toEqual({ kind: 'url', src: '/textures/a.png' });
  expect(secondBatch.material.map).toEqual({ kind: 'url', src: '/textures/b.png' });
});
```

Add this helper near the bottom of the test file:

```ts
function createTexturedBox(map: string) {
  const mesh = createElement('mesh');
  const geometry = createElement('boxGeometry');
  const material = createElement('standardMaterial');

  setAttribute(material, 'map', map);
  insert(mesh, geometry, null);
  insert(mesh, material, null);

  return mesh;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: FAIL because batch keys do not include texture identity and `TypeGpuDrawBatch` has no material descriptor.

- [ ] **Step 3: Add material to draw batches**

In `src/lib/typegpu-renderer/types.ts`, add `material` to `TypeGpuDrawBatch`:

```ts
export interface TypeGpuDrawBatch {
  key: string;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  floatsPerInstance: number;
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
}
```

- [ ] **Step 4: Update instance packing**

In `src/lib/typegpu-renderer/instance-data.ts`, use material params explicitly:

```ts
export const MESH_VERTEX_FLOATS = 6;
export const MESH_INSTANCE_FLOATS = 20;
export const MESH_SPIN_SPEED_OFFSET = 11;
export const MESH_SPIN_OFFSET_OFFSET = 12;
export const MESH_ROTATION_OFFSET = 13;
export const MESH_MATERIAL_PARAMS_OFFSET = 16;
export const MESH_ROUGHNESS_OFFSET = MESH_MATERIAL_PARAMS_OFFSET;
export const MESH_METALNESS_OFFSET = MESH_MATERIAL_PARAMS_OFFSET + 1;
export const MESH_OPACITY_OFFSET = MESH_MATERIAL_PARAMS_OFFSET + 2;
```

Update the tail of `packMeshInstance`:

```ts
instances[offset + MESH_ROUGHNESS_OFFSET] = item.material.roughness;
instances[offset + MESH_METALNESS_OFFSET] = item.material.metalness;
instances[offset + MESH_OPACITY_OFFSET] = item.material.opacity;
instances[offset + MESH_MATERIAL_PARAMS_OFFSET + 3] = 0;
```

- [ ] **Step 5: Update draw batch keys**

In `src/lib/typegpu-renderer/draw-batch-cache.ts`, import the material key helper:

```ts
import { textureKeyForMaterial } from './materials';
```

Change the key type:

```ts
type DrawBatchKey = `mesh:${TypeGpuGeometryKind}:${TypeGpuMaterialKind}:${string}`;
```

Update grouping:

```ts
const key: DrawBatchKey = `mesh:${item.geometry.kind}:${item.material.kind}:${textureKeyForMaterial(item.material)}`;
```

Pass the material descriptor into each returned batch:

```ts
const material = items[0].material;
const batch = readDrawBatch(key, geometries[geometryKind], material, items, previousBatches.get(key));
```

Update `readDrawBatch` signature:

```ts
function readDrawBatch(
  key: DrawBatchKey,
  geometry: TypeGpuGeometryData,
  material: TypeGpuMeshDrawItem['material'],
  items: TypeGpuMeshDrawItem[],
  previous: DrawBatchState | undefined
): TypeGpuDrawBatch {
```

Add `material` to both returned object literals in `readDrawBatch`.

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/instance-data.ts src/lib/typegpu-renderer/draw-batch-cache.ts src/lib/typegpu-renderer/core.test.ts
git commit -m "Batch meshes by TypeGPU material texture identity"
```

---

### Task 3: UV Geometry And Vertex Layouts

**Files:**
- Modify: `src/lib/typegpu-renderer/instance-data.ts`
- Modify: `src/lib/typegpu-renderer/box-data.ts`
- Modify: `src/lib/typegpu-renderer/sphere-data.ts`
- Modify: `src/lib/typegpu-renderer/typegpu-layouts.ts`
- Test: `src/lib/typegpu-renderer/box-data.test.ts`
- Test: `src/lib/typegpu-renderer/typegpu-layouts.test.ts`

- [ ] **Step 1: Write failing UV tests**

In `src/lib/typegpu-renderer/box-data.test.ts`, update the first test:

```ts
it('creates indexed box triangle vertices with positions, normals, and UVs', () => {
  const vertices = createBoxVertexData();

  expect(vertices).toBeInstanceOf(Float32Array);
  expect(vertices.length).toBe(36 * BOX_VERTEX_FLOATS);
  expect(Array.from(vertices.slice(0, 8))).toEqual([-0.5, -0.5, 0.5, 0, 0, 1, 0, 0]);
  expect(Array.from(vertices.slice(8, 16))).toEqual([0.5, -0.5, 0.5, 0, 0, 1, 1, 0]);
});
```

In `src/lib/typegpu-renderer/typegpu-layouts.test.ts`, update expected vertex stride and attributes:

```ts
expect(meshVertexLayout.stride).toBe(MESH_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT);
expect(meshVertexLayout.vertexLayout).toMatchObject({
  arrayStride: MESH_VERTEX_FLOATS * Float32Array.BYTES_PER_ELEMENT,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x3' },
    { shaderLocation: 2, offset: 6 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' }
  ]
});
```

Also update instance shader locations in the same test so instance attributes start at location `3`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/box-data.test.ts src/lib/typegpu-renderer/typegpu-layouts.test.ts
```

Expected: FAIL because vertex data and layout still have only position and normal.

- [ ] **Step 3: Add UV vertex float count**

In `src/lib/typegpu-renderer/instance-data.ts`:

```ts
export const MESH_VERTEX_FLOATS = 8;
```

- [ ] **Step 4: Add box UVs**

In `src/lib/typegpu-renderer/box-data.ts`, add UVs to face data:

```ts
const FACE_UVS: Array<[number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [0, 1]
];
```

Update `createBoxVertexData`:

```ts
for (const face of BOX_FACES) {
  const [a, b, c, d] = face.corners;
  const [uvA, uvB, uvC, uvD] = FACE_UVS;

  for (const [vertex, uv] of [
    [a, uvA],
    [b, uvB],
    [c, uvC],
    [a, uvA],
    [c, uvC],
    [d, uvD]
  ] as const) {
    data.push(...vertex, ...face.normal, ...uv);
  }
}
```

- [ ] **Step 5: Add sphere UVs**

In `src/lib/typegpu-renderer/sphere-data.ts`, change calls to pass UVs:

```ts
pushSphereVertex(data, thetaA, phiA, segment / segments, ring / rings);
pushSphereVertex(data, thetaB, phiA, segment / segments, (ring + 1) / rings);
pushSphereVertex(data, thetaA, phiB, (segment + 1) / segments, ring / rings);
```

Apply the same pattern to the lower triangle. Replace `pushSphereVertex` with:

```ts
function pushSphereVertex(data: number[], theta: number, phi: number, u: number, v: number): void {
  const sinTheta = Math.sin(theta);
  const x = sinTheta * Math.cos(phi);
  const y = Math.cos(theta);
  const z = sinTheta * Math.sin(phi);

  data.push(x * 0.5, y * 0.5, z * 0.5, x, y, z, u, v);
}
```

- [ ] **Step 6: Update TypeGPU layouts**

In `src/lib/typegpu-renderer/typegpu-layouts.ts`, update vertex schema and instance locations:

```ts
export const typegpuMeshVertexSchema = d.unstruct({
  position: d.location(0, d.float32x3),
  normal: d.location(1, d.float32x3),
  uv: d.location(2, d.float32x2)
});

export const typegpuMeshInstanceSchema = d.unstruct({
  position: d.location(3, d.float32x3),
  phase: d.location(4, d.float32),
  color: d.location(5, d.float32x4),
  shape: d.location(6, d.float32x4),
  spinOffset: d.location(7, d.float32),
  worldRotation: d.location(8, d.float32x3),
  material: d.location(9, d.float32x4)
});
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/box-data.test.ts src/lib/typegpu-renderer/typegpu-layouts.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/typegpu-renderer/instance-data.ts src/lib/typegpu-renderer/box-data.ts src/lib/typegpu-renderer/sphere-data.ts src/lib/typegpu-renderer/typegpu-layouts.ts src/lib/typegpu-renderer/box-data.test.ts src/lib/typegpu-renderer/typegpu-layouts.test.ts
git commit -m "Add UV vertex data to TypeGPU geometry"
```

---

### Task 4: TypeGPU Material Bind Group And Shader Sampling

**Files:**
- Modify: `src/lib/typegpu-renderer/typegpu-layouts.ts`
- Modify: `src/lib/typegpu-renderer/typegpu-pipeline.ts`
- Test: `src/lib/typegpu-renderer/typegpu-layouts.test.ts`
- Test: `src/lib/typegpu-renderer/typegpu-pipeline.test.ts`

- [ ] **Step 1: Write failing TypeGPU material layout tests**

In `src/lib/typegpu-renderer/typegpu-layouts.test.ts`, import `materialBindGroupLayout` and add:

```ts
it('describes the standard material texture bind group with current TypeGPU texture APIs', () => {
  expect(materialBindGroupLayout.index).toBe(1);
  expect(materialBindGroupLayout.entries.baseColorTexture?.texture.type).toBe('texture_2d');
  expect(materialBindGroupLayout.entries.baseColorSampler?.sampler).toBe('filtering');
});
```

In `src/lib/typegpu-renderer/typegpu-pipeline.test.ts`, update the shader test:

```ts
expect(wgsl).toContain('@group(1)');
expect(wgsl).toContain('baseColorTexture');
expect(wgsl).toContain('baseColorSampler');
expect(wgsl).toContain('textureSample');
expect(wgsl).toContain('in.uv');
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/typegpu-layouts.test.ts src/lib/typegpu-renderer/typegpu-pipeline.test.ts
```

Expected: FAIL because material bind group layout and UV shader IO do not exist.

- [ ] **Step 3: Add material bind group layout**

In `src/lib/typegpu-renderer/typegpu-layouts.ts`, add:

```ts
export const materialBindGroupLayout = tgpu
  .bindGroupLayout({
    baseColorTexture: { texture: d.texture2d(), visibility: ['fragment'] },
    baseColorSampler: { sampler: 'filtering', visibility: ['fragment'] }
  })
  .$idx(1)
  .$name('TypeGPU standard material bind group layout');
```

- [ ] **Step 4: Update pipeline shader IO and attribs**

In `src/lib/typegpu-renderer/typegpu-pipeline.ts`, import `materialBindGroupLayout`:

```ts
import {
  materialBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout
} from './typegpu-layouts';
```

Update `meshVertexMain` input/output:

```ts
uv: d.vec2f,
```

and output:

```ts
uv: d.location(3, d.vec2f)
```

Set output UV:

```wgsl
output.uv = uv;
```

Update fragment input:

```ts
uv: d.location(3, d.vec2f)
```

Replace the color section in the fragment WGSL:

```wgsl
let texel = textureSample(
  materialBindGroupLayout.$.baseColorTexture,
  materialBindGroupLayout.$.baseColorSampler,
  in.uv
);
let shifted_color = rotate_hue(
  (texel * in.color).rgb,
  sceneBindGroupLayout.$.scene.color_transform.x
);

return vec4(shifted_color * shade + lift, texel.a * in.color.a * in.material.z);
```

Update `$uses`:

```ts
.$uses({ rotate_hue: rotateHue, sceneBindGroupLayout, materialBindGroupLayout })
```

Add `uv` to render pipeline attribs:

```ts
uv: meshVertexLayout.attrib.uv,
```

- [ ] **Step 5: Run tests to verify they pass**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/typegpu-layouts.test.ts src/lib/typegpu-renderer/typegpu-pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/typegpu-layouts.ts src/lib/typegpu-renderer/typegpu-pipeline.ts src/lib/typegpu-renderer/typegpu-layouts.test.ts src/lib/typegpu-renderer/typegpu-pipeline.test.ts
git commit -m "Add TypeGPU material texture bind group"
```

---

### Task 5: TypeGPU Material Resource Cache

**Files:**
- Modify: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.test.ts`

- [ ] **Step 1: Write failing TypeGPU boundary tests**

In `src/lib/typegpu-renderer/gpu-renderer.test.ts`, update the source assertions:

```ts
it('creates material resources through TypeGPU APIs', () => {
  expect(rendererSource).toContain('root.createTexture');
  expect(rendererSource).toContain('root.createSampler');
  expect(rendererSource).toContain('root.createBindGroup(materialBindGroupLayout');
  expect(rendererSource).toContain('.write(');
  expect(rendererSource).not.toContain('device.createTexture');
  expect(rendererSource).not.toContain('device.createSampler');
  expect(rendererSource).not.toContain('device.createBindGroup');
});

it('uses TypeGPU pipeline binding for material draws', () => {
  expect(rendererSource).toContain('.with(this.#sceneBindGroup)');
  expect(rendererSource).toContain('.with(material.bindGroup)');
  expect(rendererSource).toContain('.with(meshVertexLayout');
  expect(rendererSource).toContain('.with(meshInstanceLayout');
  expect(rendererSource).toContain('.withColorAttachment');
  expect(rendererSource).toContain('.withDepthStencilAttachment');
  expect(rendererSource).toContain('.draw(');
});
```

Replace old expectations that require `root.unwrap(this.#pipeline)`, `root.unwrap(this.#bindGroup)`, `pass.setPipeline`, `pass.setBindGroup`, or `root.device.createTexture`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: FAIL because renderer still unwraps resources and creates raw depth texture.

- [ ] **Step 3: Update renderer imports and fields**

In `src/lib/typegpu-renderer/gpu-renderer.ts`, import material layout and helpers:

```ts
import { textureKeyForMaterial } from './materials';
import {
  materialBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  typegpuSceneUniformSchema
} from './typegpu-layouts';
```

Add TypeGPU resource types:

```ts
import type { SampledFlag, RenderFlag } from 'typegpu';
```

Add local resource interfaces near `TypeGpuBatchBuffers`:

```ts
type TypeGpuSampledTexture = ReturnType<TgpuRoot['createTexture']> & SampledFlag;
type TypeGpuRenderTexture = ReturnType<TgpuRoot['createTexture']> & RenderFlag;

interface TypeGpuMaterialResource {
  key: string;
  texture: TypeGpuSampledTexture;
  bindGroup: TgpuBindGroup<typeof materialBindGroupLayout.entries>;
  status: 'ready' | 'loading' | 'failed' | 'fallback';
}
```

Replace raw fields:

```ts
#depthTexture: TypeGpuRenderTexture | null = null;
#materialResources = new Map<string, TypeGpuMaterialResource>();
#fallbackMaterial: TypeGpuMaterialResource;
#materialSampler: ReturnType<TgpuRoot['createSampler']>;
#sceneBindGroup: TgpuBindGroup<typeof sceneBindGroupLayout.entries>;
```

Remove `#rawBindGroup` and `#rawPipeline`.

- [ ] **Step 4: Create fallback texture and material resources**

Add these methods to `TypeGpuSceneRenderer`:

```ts
#createFallbackMaterial(): TypeGpuMaterialResource {
  const texture = this.root
    .createTexture({
      size: [1, 1],
      format: 'rgba8unorm',
      dimension: '2d'
    })
    .$usage('sampled')
    .$name('TypeGPU fallback white texture');

  texture.write(new Uint8Array([255, 255, 255, 255]));

  return {
    key: 'solid:white',
    texture,
    bindGroup: this.root.createBindGroup(materialBindGroupLayout, {
      baseColorTexture: texture,
      baseColorSampler: this.#materialSampler
    }),
    status: 'fallback'
  };
}

#materialForBatch(batch: TypeGpuDrawBatch): TypeGpuMaterialResource {
  const key = textureKeyForMaterial(batch.material);
  if (key === 'solid:white') return this.#fallbackMaterial;

  const existing = this.#materialResources.get(key);
  if (existing) {
    return existing.status === 'ready' ? existing : this.#fallbackMaterial;
  }

  const resource: TypeGpuMaterialResource = {
    ...this.#fallbackMaterial,
    key,
    status: 'loading'
  };
  this.#materialResources.set(key, resource);
  void this.#loadMaterialTexture(key, batch.material.map?.src);
  return this.#fallbackMaterial;
}

async #loadMaterialTexture(key: string, src: string | undefined): Promise<void> {
  if (!src) return;

  try {
    const response = await fetch(src);
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);
    const texture = this.root
      .createTexture({
        size: [bitmap.width, bitmap.height],
        format: 'rgba8unorm',
        dimension: '2d'
      })
      .$usage('sampled')
      .$name(`TypeGPU material texture ${src}`);

    texture.write(bitmap);

    this.#materialResources.set(key, {
      key,
      texture,
      bindGroup: this.root.createBindGroup(materialBindGroupLayout, {
        baseColorTexture: texture,
        baseColorSampler: this.#materialSampler
      }),
      status: 'ready'
    });
  } catch {
    this.#materialResources.set(key, {
      ...this.#fallbackMaterial,
      key,
      status: 'failed'
    });
  }
}
```

Initialize the sampler and fallback material in the constructor:

```ts
this.#materialSampler = root.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
  mipmapFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat'
});
this.#sceneBindGroup = root.createBindGroup(sceneBindGroupLayout, { scene: this.#uniformBuffer });
this.#pipeline = createMeshPipeline(root, format);
this.#fallbackMaterial = this.#createFallbackMaterial();
```

- [ ] **Step 5: Replace depth texture and draw flow with TypeGPU APIs**

In `#resize`, replace raw `device.createTexture`:

```ts
this.#depthTexture = this.root
  .createTexture({
    size: [width, height],
    format: DEPTH_FORMAT,
    dimension: '2d'
  })
  .$usage('render')
  .$name('TypeGPU depth texture');
```

In `#render`, replace command encoder/pass usage with TypeGPU pipeline flow. Attach color/depth once per frame so later batches do not clear earlier batches:

```ts
if (this.#depthTexture) {
  const framePipeline = this.#pipeline
    .with(this.#sceneBindGroup)
    .withColorAttachment({
      view: this.#context,
      loadOp: 'clear',
      storeOp: 'store',
      clearValue: { r: 0.067, g: 0.078, b: 0.102, a: 1 }
    })
    .withDepthStencilAttachment({
      view: this.#depthTexture,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store'
    });

  for (const batch of this.#drawBatches) {
    const buffers = this.#batchBuffers.get(batch.key);
    if (!buffers?.instanceBuffer || buffers.instanceCount === 0) continue;

    const material = this.#materialForBatch(batch);

    framePipeline
      .with(material.bindGroup)
      .with(meshVertexLayout, buffers.vertexBuffer.buffer)
      .with(meshInstanceLayout, buffers.instanceBuffer.buffer)
      .draw(batch.geometry.vertexCount, buffers.instanceCount);
  }
}
```

If this exact chain does not type-check, keep TypeGPU for resource creation and bind groups, then isolate any raw render-pass fallback behind one small helper named `drawBatchWithRawPassFallback` with a comment explaining the unsupported TypeGPU call. Do not use raw WebGPU for material resources.

- [ ] **Step 6: Dispose TypeGPU textures**

In `dispose()`:

```ts
this.#depthTexture?.destroy();
this.#fallbackMaterial.texture.destroy();
for (const material of this.#materialResources.values()) {
  if (material.texture !== this.#fallbackMaterial.texture) {
    material.texture.destroy();
  }
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: PASS. If TypeScript exposes TypeGPU texture/sampler types under different import names, adjust imports but keep the tests enforcing TypeGPU resource creation.

- [ ] **Step 8: Commit**

```bash
git add src/lib/typegpu-renderer/gpu-renderer.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
git commit -m "Resolve material textures with TypeGPU resources"
```

---

### Task 6: Demo Texture And Svelte Component Integration

**Files:**
- Create: `public/textures/checker.svg`
- Modify: `src/Scene.typegpu.svelte`
- Modify: `src/Box.typegpu.svelte`
- Modify: `src/Sphere.typegpu.svelte`
- Test: `src/lib/typegpu-renderer/component-renderer.test.ts`
- Test: `src/Scene.typegpu.test.ts`

- [ ] **Step 1: Write failing component-renderer tests**

In `src/lib/typegpu-renderer/component-renderer.test.ts`, update the material assertions for `Box` and `Sphere`:

```ts
expect(material.attributes).toMatchObject({
  color
});
```

Add an assertion for the scene demo in `src/Scene.typegpu.test.ts`:

```ts
expect(material.attributes.map).toBe('/textures/checker.svg');
```

Use the existing scene test traversal helper to target one authored `standardMaterial` that should be textured. If no helper exists, add:

```ts
function findFirstNode(root: TypeGpuNode, name: string): TypeGpuNode {
  if (root.name === name) return root;
  for (const child of root.children) {
    const found = findFirstNode(child, name);
    if (found) return found;
  }
  throw new Error(`Missing ${name}`);
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts src/Scene.typegpu.test.ts
```

Expected: FAIL because demo materials do not set a map yet.

- [ ] **Step 3: Add deterministic texture asset**

Create `public/textures/checker.svg`:

```xml
<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#f8fafc"/>
  <rect width="32" height="32" fill="#0f766e"/>
  <rect x="64" width="32" height="32" fill="#0f766e"/>
  <rect x="32" y="32" width="32" height="32" fill="#0f766e"/>
  <rect x="96" y="32" width="32" height="32" fill="#0f766e"/>
  <rect y="64" width="32" height="32" fill="#0f766e"/>
  <rect x="64" y="64" width="32" height="32" fill="#0f766e"/>
  <rect x="32" y="96" width="32" height="32" fill="#0f766e"/>
  <rect x="96" y="96" width="32" height="32" fill="#0f766e"/>
</svg>
```

- [ ] **Step 4: Update convenience components**

In `src/Box.typegpu.svelte`, add `map?: string` to props, default it to `undefined`, and pass it through:

```svelte
<standardMaterial {color} {map}></standardMaterial>
```

Use the same pattern in `src/Sphere.typegpu.svelte`.

- [ ] **Step 5: Texture a subset of demo materials**

In `src/Scene.typegpu.svelte`, set one stable subset to use the checker texture:

```svelte
<standardMaterial
  color={demoColorForIndex(index, 0)}
  roughness={0.62}
  metalness={0.04}
  map={index % 17 === 0 ? '/textures/checker.svg' : undefined}
></standardMaterial>
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts src/Scene.typegpu.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add public/textures/checker.svg src/Scene.typegpu.svelte src/Box.typegpu.svelte src/Sphere.typegpu.svelte src/lib/typegpu-renderer/component-renderer.test.ts src/Scene.typegpu.test.ts
git commit -m "Show textured TypeGPU standard materials"
```

---

### Task 7: Full Verification

**Files:**
- Test only

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm run test
```

Expected: all Vitest tests pass.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: Vite build exits 0.

- [ ] **Step 3: Run local app**

Run:

```bash
npm run dev
```

Expected: Vite reports a local URL, normally `http://127.0.0.1:5173/`.

- [ ] **Step 4: Browser/manual check**

Open the local URL and verify:

- The canvas renders.
- At least one mesh uses the checker texture.
- Existing controls still change count, hue, spin, scale, and camera.
- No console error mentions bind group layout mismatch, missing texture binding, or WebGPU validation errors.

- [ ] **Step 5: Handle any final fixes**

If verification found a failure, return to the task that owns the failing behavior, apply the focused fix there, rerun that task's verification command, and commit using that task's exact `git add` list. Do not create a catch-all final commit.

If no fixes were required, do not create an empty commit.
