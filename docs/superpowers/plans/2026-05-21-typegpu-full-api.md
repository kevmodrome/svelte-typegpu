# TypeGPU Full Renderer API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the full TypeGPU Svelte renderer API with nested groups, meshes, geometry child nodes, material child nodes, and internal automatic batching.

**Architecture:** Add a scene-graph reader that resolves transform inheritance into generic mesh draw items. Replace primitive-node-specific caches with a generic draw-batch cache that groups mesh items by geometry pipeline compatibility and packs per-instance transform/material data. Rewrite the public demo and convenience components to author `<mesh><geometry/><material/></mesh>` while keeping the GPU renderer’s single-pipeline batching path.

**Tech Stack:** Svelte 5 custom renderer, TypeScript, TypeGPU/WebGPU, Vitest, Vite.

---

## File Structure

- Create `src/lib/typegpu-renderer/transform.ts`: parse and compose local/world transforms.
- Create `src/lib/typegpu-renderer/components/geometry.ts`: read mesh geometry children into descriptors.
- Create `src/lib/typegpu-renderer/components/material.ts`: read mesh material children into descriptors.
- Create `src/lib/typegpu-renderer/components/mesh.ts`: collect mesh draw items and find interactive meshes.
- Create `src/lib/typegpu-renderer/draw-batch-cache.ts`: group mesh draw items into reusable draw batches with dirty ranges.
- Modify `src/lib/typegpu-renderer/types.ts`: add geometry/material/transform/draw-item types and `floatsPerInstance` on batches.
- Modify `src/lib/typegpu-renderer/attributes.ts`: add scalar-or-vector scale parsing.
- Modify `src/lib/typegpu-renderer/instance-data.ts`: replace primitive-only packing with generic mesh-instance packing.
- Modify `src/lib/typegpu-renderer/scene-state.ts`: use the draw-batch cache instead of primitive caches.
- Modify `src/lib/typegpu-renderer/gpu-renderer.ts`: use the new instance layout and shader attributes.
- Modify `src/lib/typegpu-renderer/svelte-renderer.ts`: dispatch clicks to interactive meshes.
- Modify `src/Box.typegpu.svelte` and `src/Sphere.typegpu.svelte`: compose convenience components from mesh, geometry, and material nodes.
- Modify `src/Scene.typegpu.svelte`: author the generated field with the new full API directly.
- Modify tests under `src/lib/typegpu-renderer/*.test.ts`: cover mesh composition, nested transforms, batching, invalid composition, component rendering, and new instance layout.

## Task 1: Scene Graph Readers

**Files:**
- Create: `src/lib/typegpu-renderer/transform.ts`
- Create: `src/lib/typegpu-renderer/components/geometry.ts`
- Create: `src/lib/typegpu-renderer/components/material.ts`
- Create: `src/lib/typegpu-renderer/components/mesh.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Modify: `src/lib/typegpu-renderer/attributes.ts`
- Modify: `src/lib/typegpu-renderer/primitive-cache.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing scene-graph tests**

Add these imports to `src/lib/typegpu-renderer/core.test.ts`:

```ts
import { collectMeshDrawItems, findFirstInteractiveMesh } from './components/mesh';
```

Append these tests inside the `describe('TypeGPU renderer core', () => { ... })` block:

```ts
  it('reads a mesh with box geometry and standard material into a draw item', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');

    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(mesh, 'phase', 0.25);
    setAttribute(mesh, 'spinSpeed', 1.4);
    setAttribute(geometry, 'width', 20);
    setAttribute(geometry, 'height', 5);
    setAttribute(geometry, 'depth', 10);
    setAttribute(material, 'color', [0.1, 0.2, 0.3, 1]);
    setAttribute(material, 'roughness', 0.62);
    setAttribute(material, 'metalness', 0.18);

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item).toMatchObject({
      id: mesh.uid,
      phase: 0.25,
      spinSpeed: 1.4,
      geometry: {
        kind: 'box',
        size: [20, 5, 10]
      },
      material: {
        kind: 'standard',
        color: [0.1, 0.2, 0.3, 1],
        roughness: 0.62,
        metalness: 0.18
      },
      transform: {
        position: [1, 2, 3],
        rotation: [0, 0, 0],
        scale: [1, 1, 1]
      }
    });
  });

  it('applies nested group transforms to child meshes', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(group, 'position', [10, 0, 0]);
    setAttribute(group, 'scale', [2, 3, 4]);
    setAttribute(mesh, 'position', [1, 2, 3]);
    setAttribute(mesh, 'rotation', [0.1, 0.2, 0.3]);

    insert(mesh, geometry, null);
    insert(group, mesh, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [item] = collectMeshDrawItems(root);

    expect(item.transform.position[0]).toBeCloseTo(12);
    expect(item.transform.position[1]).toBeCloseTo(6);
    expect(item.transform.position[2]).toBeCloseTo(12);
    expect(item.transform.rotation).toEqual([0.1, 0.2, 0.3]);
    expect(item.transform.scale).toEqual([2, 3, 4]);
  });

  it('skips invalid mesh composition without crashing', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const meshWithoutGeometry = createElement('mesh');
    const looseGeometry = createElement('boxGeometry');
    const validMesh = createElement('mesh');
    const validGeometry = createElement('sphereGeometry');

    insert(scene, looseGeometry, null);
    insert(scene, meshWithoutGeometry, null);
    insert(validMesh, validGeometry, null);
    insert(scene, validMesh, null);
    insert(root, scene, null);

    const items = collectMeshDrawItems(root);

    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(validMesh.uid);
    expect(items[0].geometry.kind).toBe('sphere');
    expect(items[0].material.color).toEqual([1, 1, 1, 1]);
  });

  it('finds the first interactive mesh node', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const first = createElement('mesh');
    const second = createElement('mesh');
    const handler = vi.fn();

    addEventListener(second, 'click', handler);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(root, scene, null);

    expect(findFirstInteractiveMesh(root, 'click')).toBe(second);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: FAIL because `./components/mesh` does not exist and `collectMeshDrawItems` is not exported.

- [ ] **Step 3: Extend shared renderer types**

In `src/lib/typegpu-renderer/types.ts`, keep existing exports and add these types:

```ts
export type TypeGpuGeometryKind = 'box' | 'sphere';
export type TypeGpuMaterialKind = 'standard';

export interface TypeGpuTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface TypeGpuGeometryDescriptor {
  kind: TypeGpuGeometryKind;
  size: Vector3Tuple;
}

export interface TypeGpuMaterialDescriptor {
  kind: TypeGpuMaterialKind;
  color: RgbaTuple;
  roughness: number;
  metalness: number;
}

export interface TypeGpuMeshDrawItem {
  id: number;
  revision: number;
  geometry: TypeGpuGeometryDescriptor;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
  phase: number;
  spinSpeed: number;
}
```

Also add `floatsPerInstance: number;` to `TypeGpuDrawBatch`:

```ts
export interface TypeGpuDrawBatch {
  key: string;
  geometry: TypeGpuGeometryData;
  floatsPerInstance: number;
  instances: Float32Array;
  instanceIds: number[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
}
```

In `src/lib/typegpu-renderer/primitive-cache.ts`, add `floatsPerInstance: definition.floatsPerInstance,` to both returned `TypeGpuDrawBatch` objects:

```ts
        return {
          key: definition.key,
          geometry: definition.geometry,
          floatsPerInstance: definition.floatsPerInstance,
          instances,
          instanceIds,
          instanceCount: nodes.length,
          instancesChanged: true,
          dirtyRanges: nodes.length > 0 ? [{ start: 0, count: nodes.length }] : []
        };
```

```ts
      return {
        key: definition.key,
        geometry: definition.geometry,
        floatsPerInstance: definition.floatsPerInstance,
        instances,
        instanceIds,
        instanceCount: nodes.length,
        instancesChanged: dirtyRanges.length > 0,
        dirtyRanges
      };
```

- [ ] **Step 4: Add scale parsing**

In `src/lib/typegpu-renderer/attributes.ts`, add this function after `vectorTuple`:

```ts
export function scaleTuple(value: unknown, fallback: Vector3Tuple = [1, 1, 1]): Vector3Tuple {
  const scalar = numberArg(value, Number.NaN);

  if (Number.isFinite(scalar)) {
    return [scalar, scalar, scalar];
  }

  return vectorTuple(value, fallback);
}
```

- [ ] **Step 5: Add transform composition**

Create `src/lib/typegpu-renderer/transform.ts`:

```ts
import { scaleTuple, vectorTuple } from './attributes';
import type { TypeGpuNode } from './core';
import type { TypeGpuTransform, Vector3Tuple } from './types';

export const IDENTITY_TRANSFORM: TypeGpuTransform = {
  position: [0, 0, 0],
  rotation: [0, 0, 0],
  scale: [1, 1, 1]
};

export function readLocalTransform(node: TypeGpuNode): TypeGpuTransform {
  return {
    position: vectorTuple(node.attributes.position),
    rotation: vectorTuple(node.attributes.rotation),
    scale: scaleTuple(node.attributes.scale)
  };
}

export function composeTransforms(
  parent: TypeGpuTransform,
  local: TypeGpuTransform
): TypeGpuTransform {
  const scaledPosition = multiplyVectors(local.position, parent.scale);
  const rotatedPosition = rotateVector(scaledPosition, parent.rotation);

  return {
    position: addVectors(parent.position, rotatedPosition),
    rotation: addVectors(parent.rotation, local.rotation),
    scale: multiplyVectors(parent.scale, local.scale)
  };
}

function addVectors(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function multiplyVectors(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

function rotateVector(vector: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple {
  return rotateZ(rotateY(rotateX(vector, rotation[0]), rotation[1]), rotation[2]);
}

function rotateX([x, y, z]: Vector3Tuple, angle: number): Vector3Tuple {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [x, y * c - z * s, y * s + z * c];
}

function rotateY([x, y, z]: Vector3Tuple, angle: number): Vector3Tuple {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [x * c + z * s, y, -x * s + z * c];
}

function rotateZ([x, y, z]: Vector3Tuple, angle: number): Vector3Tuple {
  const c = Math.cos(angle);
  const s = Math.sin(angle);

  return [x * c - y * s, x * s + y * c, z];
}
```

- [ ] **Step 6: Add geometry and material readers**

Create `src/lib/typegpu-renderer/components/geometry.ts`:

```ts
import { dimensionArg } from '../attributes';
import type { TypeGpuNode } from '../core';
import type { TypeGpuGeometryDescriptor } from '../types';

export interface TypeGpuGeometryReadResult {
  node: TypeGpuNode;
  geometry: TypeGpuGeometryDescriptor;
}

export function readMeshGeometry(mesh: TypeGpuNode): TypeGpuGeometryReadResult | null {
  const geometryNode = mesh.children.find(isSupportedGeometryNode);

  if (!geometryNode) return null;

  if (geometryNode.name === 'sphereGeometry') {
    const radius = dimensionArg(geometryNode.attributes.radius, 0.5);

    return {
      node: geometryNode,
      geometry: {
        kind: 'sphere',
        size: [
          dimensionArg(geometryNode.attributes.width, radius * 2),
          dimensionArg(geometryNode.attributes.height, radius * 2),
          dimensionArg(geometryNode.attributes.depth, radius * 2)
        ]
      }
    };
  }

  return {
    node: geometryNode,
    geometry: {
      kind: 'box',
      size: [
        dimensionArg(geometryNode.attributes.width, 1),
        dimensionArg(geometryNode.attributes.height, 1),
        dimensionArg(geometryNode.attributes.depth, 1)
      ]
    }
  };
}

function isSupportedGeometryNode(node: TypeGpuNode): boolean {
  return node.name === 'boxGeometry' || node.name === 'sphereGeometry';
}
```

Create `src/lib/typegpu-renderer/components/material.ts`:

```ts
import { colorTuple, numberArg } from '../attributes';
import type { TypeGpuNode } from '../core';
import type { TypeGpuMaterialDescriptor } from '../types';

export interface TypeGpuMaterialReadResult {
  node: TypeGpuNode | null;
  material: TypeGpuMaterialDescriptor;
}

export const DEFAULT_STANDARD_MATERIAL: TypeGpuMaterialDescriptor = {
  kind: 'standard',
  color: [1, 1, 1, 1],
  roughness: 0.45,
  metalness: 0.05
};

export function readMeshMaterial(mesh: TypeGpuNode): TypeGpuMaterialReadResult {
  const materialNode = mesh.children.find((node) => node.name === 'standardMaterial') ?? null;

  if (!materialNode) {
    return {
      node: null,
      material: DEFAULT_STANDARD_MATERIAL
    };
  }

  return {
    node: materialNode,
    material: {
      kind: 'standard',
      color: colorTuple(materialNode.attributes.color),
      roughness: numberArg(materialNode.attributes.roughness, DEFAULT_STANDARD_MATERIAL.roughness),
      metalness: numberArg(materialNode.attributes.metalness, DEFAULT_STANDARD_MATERIAL.metalness)
    }
  };
}
```

- [ ] **Step 7: Add mesh draw-item collection**

Create `src/lib/typegpu-renderer/components/mesh.ts`:

```ts
import { numberArg } from '../attributes';
import { findFirst, type TypeGpuNode } from '../core';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from '../transform';
import type { TypeGpuMeshDrawItem, TypeGpuTransform } from '../types';
import { readMeshGeometry } from './geometry';
import { readMeshMaterial } from './material';

export function collectMeshDrawItems(root: TypeGpuNode): TypeGpuMeshDrawItem[] {
  const items: TypeGpuMeshDrawItem[] = [];

  collectFromNode(root, IDENTITY_TRANSFORM, root.treeRevision, items);

  return items;
}

export function findFirstInteractiveMesh(root: TypeGpuNode, type: string): TypeGpuNode | null {
  return findFirst(root, (node) => node.name === 'mesh' && Boolean(node.listeners.get(type)?.size));
}

function collectFromNode(
  node: TypeGpuNode,
  parentTransform: TypeGpuTransform,
  revisionSeed: number,
  items: TypeGpuMeshDrawItem[]
): void {
  const transformable = node.name === 'group' || node.name === 'mesh';
  const transform = transformable
    ? composeTransforms(parentTransform, readLocalTransform(node))
    : parentTransform;
  const nextRevisionSeed = transformable ? combineRevision(revisionSeed, node.revision) : revisionSeed;

  if (node.name === 'mesh') {
    const geometry = readMeshGeometry(node);

    if (geometry) {
      const material = readMeshMaterial(node);

      items.push({
        id: node.uid,
        revision: combineRevision(
          combineRevision(
            combineRevision(nextRevisionSeed, geometry.node.revision),
            material.node?.revision ?? 0
          ),
          node.revision
        ),
        geometry: geometry.geometry,
        material: material.material,
        transform,
        phase: numberArg(node.attributes.phase, 0),
        spinSpeed: numberArg(node.attributes.spinSpeed, 0)
      });
    }
  }

  for (const child of node.children) {
    collectFromNode(child, transform, nextRevisionSeed, items);
  }
}

function combineRevision(seed: number, revision: number): number {
  return seed * 31 + revision;
}
```

- [ ] **Step 8: Run tests to verify Task 1 passes**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
npx tsc --noEmit
```

Expected: both commands pass. The older primitive draw-batch assertions still pass because old primitive cache code remains in place for this task.

- [ ] **Step 9: Commit Task 1**

Run:

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/attributes.ts src/lib/typegpu-renderer/primitive-cache.ts src/lib/typegpu-renderer/transform.ts src/lib/typegpu-renderer/components/geometry.ts src/lib/typegpu-renderer/components/material.ts src/lib/typegpu-renderer/components/mesh.ts src/lib/typegpu-renderer/core.test.ts
git commit -m "Add TypeGPU mesh scene graph readers"
```

## Task 2: Generic Draw-Batch Cache

**Files:**
- Create: `src/lib/typegpu-renderer/draw-batch-cache.ts`
- Modify: `src/lib/typegpu-renderer/instance-data.ts`
- Modify: `src/lib/typegpu-renderer/scene-state.ts`
- Modify: `src/lib/typegpu-renderer/components/box.ts`
- Modify: `src/lib/typegpu-renderer/components/sphere.ts`
- Modify: `src/lib/typegpu-renderer/svelte-renderer.ts`
- Modify: `src/lib/typegpu-renderer/core.test.ts`
- Modify: `src/lib/typegpu-renderer/box-data.test.ts`

- [ ] **Step 1: Replace primitive-batch tests with mesh-batch tests**

In `src/lib/typegpu-renderer/core.test.ts`, replace the test named `'turns authored primitive nodes into separate draw batches'` with this test:

```ts
  it('turns mesh nodes into geometry draw batches with per-instance material data', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const first = createElement('mesh');
    const firstGeometry = createElement('boxGeometry');
    const firstMaterial = createElement('standardMaterial');
    const second = createElement('mesh');
    const secondGeometry = createElement('boxGeometry');
    const secondMaterial = createElement('standardMaterial');
    const sphere = createElement('mesh');
    const sphereGeometry = createElement('sphereGeometry');
    const sphereMaterial = createElement('standardMaterial');

    setAttribute(camera, 'position', [0, 2, 8]);
    setAttribute(camera, 'lookAt', [0, 0, 0]);
    setAttribute(camera, 'fov', 50);
    setAttribute(first, 'position', [1, 2, 3]);
    setAttribute(first, 'phase', 0.25);
    setAttribute(first, 'spinSpeed', 1.4);
    setAttribute(firstGeometry, 'width', 20);
    setAttribute(firstGeometry, 'height', 5);
    setAttribute(firstGeometry, 'depth', 10);
    setAttribute(firstMaterial, 'color', [0.1, 0.2, 0.3, 1]);
    setAttribute(firstMaterial, 'roughness', 0.7);
    setAttribute(firstMaterial, 'metalness', 0.2);
    setAttribute(second, 'position', [-1, -2, -3]);
    setAttribute(second, 'phase', 0.5);
    setAttribute(secondMaterial, 'color', [0.4, 0.5, 0.6, 1]);
    setAttribute(sphere, 'position', [7, 8, 9]);
    setAttribute(sphere, 'phase', 0.75);
    setAttribute(sphereMaterial, 'color', [0.7, 0.8, 0.9, 1]);

    insert(first, firstGeometry, null);
    insert(first, firstMaterial, null);
    insert(second, secondGeometry, null);
    insert(second, secondMaterial, null);
    insert(sphere, sphereGeometry, null);
    insert(sphere, sphereMaterial, null);
    insert(scene, camera, null);
    insert(scene, first, null);
    insert(scene, second, null);
    insert(scene, sphere, null);
    insert(root, scene, null);

    const state = createSceneState(root);
    const boxBatch = drawBatch(state, 'mesh:box:standard');
    const sphereBatch = drawBatch(state, 'mesh:sphere:standard');

    expect(state.camera).toMatchObject({
      position: [0, 2, 8],
      lookAt: [0, 0, 0],
      fov: 50,
      near: 0.1,
      far: 100
    });
    expect(boxBatch.geometry.key).toBe('box');
    expect(boxBatch.instanceCount).toBe(2);
    expect(boxBatch.instanceIds).toEqual([first.uid, second.uid]);
    expect(Array.from(boxBatch.instances.slice(0, 4))).toEqual([1, 2, 3, 0.25]);
    expect(Array.from(boxBatch.instances.slice(4, 8))).toEqual([0.1, 0.2, 0.3, 1]);
    expect(Array.from(boxBatch.instances.slice(8, 11))).toEqual([20, 5, 10]);
    expect(boxBatch.instances[11]).toBeCloseTo(1.4);
    expect(boxBatch.instances[12]).toBe(0);
    expect(Array.from(boxBatch.instances.slice(13, 16))).toEqual([0, 0, 0]);
    expect(boxBatch.instances[16]).toBeCloseTo(0.7);
    expect(boxBatch.instances[17]).toBeCloseTo(0.2);
    expect(Array.from(boxBatch.instances.slice(20, 24))).toEqual([-1, -2, -3, 0.5]);
    expect(Array.from(boxBatch.instances.slice(24, 28))).toEqual([0.4, 0.5, 0.6, 1]);
    expect(Array.from(boxBatch.instances.slice(28, 31))).toEqual([1, 1, 1]);

    expect(sphereBatch.geometry.key).toBe('sphere');
    expect(sphereBatch.instanceCount).toBe(1);
    expect(sphereBatch.instanceIds).toEqual([sphere.uid]);
    expect(Array.from(sphereBatch.instances.slice(0, 4))).toEqual([7, 8, 9, 0.75]);
    expect(Array.from(sphereBatch.instances.slice(4, 8))).toEqual([0.7, 0.8, 0.9, 1]);
  });
```

In the dirty-packing test, update the authored nodes to use `mesh > boxGeometry + standardMaterial`, change the dirty attribute update to the material node, and use `drawBatch(state, 'mesh:box:standard')`. The final assertions should check color at `MESH_INSTANCE_FLOATS + 4`, `+5`, `+6`, and `+7`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: FAIL because scene state still returns `primitive:box` and `primitive:sphere` batches.

- [ ] **Step 3: Replace instance packing layout**

Replace `src/lib/typegpu-renderer/instance-data.ts` with:

```ts
import type { TypeGpuMeshDrawItem } from './types';

export const MESH_VERTEX_FLOATS = 6;
export const MESH_INSTANCE_FLOATS = 20;
export const MESH_SPIN_SPEED_OFFSET = 11;
export const MESH_SPIN_OFFSET_OFFSET = 12;
export const MESH_ROTATION_OFFSET = 13;
export const MESH_ROUGHNESS_OFFSET = 16;
export const MESH_METALNESS_OFFSET = 17;

export function packMeshInstance(
  item: TypeGpuMeshDrawItem,
  instances: Float32Array,
  offset: number
): void {
  instances[offset] = item.transform.position[0];
  instances[offset + 1] = item.transform.position[1];
  instances[offset + 2] = item.transform.position[2];
  instances[offset + 3] = item.phase;
  instances[offset + 4] = item.material.color[0];
  instances[offset + 5] = item.material.color[1];
  instances[offset + 6] = item.material.color[2];
  instances[offset + 7] = item.material.color[3];
  instances[offset + 8] = item.geometry.size[0] * item.transform.scale[0];
  instances[offset + 9] = item.geometry.size[1] * item.transform.scale[1];
  instances[offset + 10] = item.geometry.size[2] * item.transform.scale[2];
  instances[offset + MESH_SPIN_SPEED_OFFSET] = item.spinSpeed;
  instances[offset + MESH_SPIN_OFFSET_OFFSET] = 0;
  instances[offset + MESH_ROTATION_OFFSET] = item.transform.rotation[0];
  instances[offset + MESH_ROTATION_OFFSET + 1] = item.transform.rotation[1];
  instances[offset + MESH_ROTATION_OFFSET + 2] = item.transform.rotation[2];
  instances[offset + MESH_ROUGHNESS_OFFSET] = item.material.roughness;
  instances[offset + MESH_METALNESS_OFFSET] = item.material.metalness;
  instances[offset + 18] = 0;
  instances[offset + 19] = 0;
}
```

- [ ] **Step 4: Update box-data constants**

In `src/lib/typegpu-renderer/box-data.ts`, replace imports and aliases for primitive constants with mesh constants:

```ts
import {
  MESH_INSTANCE_FLOATS,
  MESH_SPIN_OFFSET_OFFSET,
  MESH_SPIN_SPEED_OFFSET,
  MESH_VERTEX_FLOATS
} from './instance-data';
```

Then update exports:

```ts
export const BOX_VERTEX_FLOATS = 6;
export const BOX_INSTANCE_FLOATS = MESH_INSTANCE_FLOATS;
export const BOX_SPIN_SPEED_OFFSET = MESH_SPIN_SPEED_OFFSET;
export const BOX_SPIN_OFFSET_OFFSET = MESH_SPIN_OFFSET_OFFSET;
```

In `createBoxGeometryData`, set `vertexFloats: MESH_VERTEX_FLOATS`.

In `src/lib/typegpu-renderer/sphere-data.ts`, import `MESH_VERTEX_FLOATS` and set `vertexFloats: MESH_VERTEX_FLOATS`.

In `src/lib/typegpu-renderer/box-data.test.ts`, change the instance layout expectation:

```ts
  it('reserves packed mesh instance fields for shape, continuity, rotation, and material data', () => {
    expect(BOX_INSTANCE_FLOATS).toBe(20);
    expect(BOX_SPIN_SPEED_OFFSET).toBe(11);
    expect(BOX_SPIN_OFFSET_OFFSET).toBe(12);
  });
```

- [ ] **Step 5: Add the generic draw-batch cache**

Create `src/lib/typegpu-renderer/draw-batch-cache.ts`:

```ts
import { createBoxGeometryData } from './box-data';
import { createSphereGeometryData } from './sphere-data';
import { collectMeshDrawItems } from './components/mesh';
import { MESH_INSTANCE_FLOATS, packMeshInstance } from './instance-data';
import type {
  TypeGpuDrawBatch,
  TypeGpuGeometryData,
  TypeGpuGeometryKind,
  TypeGpuInstanceDirtyRange,
  TypeGpuMeshDrawItem
} from './types';

export interface TypeGpuDrawBatchCache {
  read(root: Parameters<typeof collectMeshDrawItems>[0]): TypeGpuDrawBatch[];
}

interface BatchState {
  itemIds: number[];
  itemRevisions: number[];
  instances: Float32Array;
}

interface GroupedItems {
  key: string;
  geometry: TypeGpuGeometryData;
  items: TypeGpuMeshDrawItem[];
}

const GEOMETRY_DATA: Record<TypeGpuGeometryKind, TypeGpuGeometryData> = {
  box: createBoxGeometryData(),
  sphere: createSphereGeometryData()
};

export function createDrawBatchCache(): TypeGpuDrawBatchCache {
  const states = new Map<string, BatchState>();

  return {
    read(root) {
      const groups = groupMeshItems(collectMeshDrawItems(root));
      const liveKeys = new Set(groups.map((group) => group.key));
      const nextStates = new Map<string, BatchState>();
      const batches = groups.map((group) => {
        const batch = readGroup(group, states.get(group.key));

        nextStates.set(batch.key, {
          itemIds: batch.instanceIds,
          itemRevisions: group.items.map((item) => item.revision),
          instances: batch.instances
        });

        return batch;
      });

      states.clear();

      for (const [key, state] of nextStates) {
        if (liveKeys.has(key)) states.set(key, state);
      }

      return batches;
    }
  };
}

function groupMeshItems(items: TypeGpuMeshDrawItem[]): GroupedItems[] {
  const groups = new Map<string, GroupedItems>();

  for (const item of items) {
    const key = batchKey(item);
    const existing = groups.get(key);

    if (existing) {
      existing.items.push(item);
      continue;
    }

    groups.set(key, {
      key,
      geometry: GEOMETRY_DATA[item.geometry.kind],
      items: [item]
    });
  }

  return Array.from(groups.values());
}

function readGroup(group: GroupedItems, previous: BatchState | undefined): TypeGpuDrawBatch {
  const itemIds = group.items.map((item) => item.id);
  const itemRevisions = group.items.map((item) => item.revision);
  const structureChanged = !previous || !sameNumbers(previous.itemIds, itemIds);

  if (structureChanged) {
    const instances = new Float32Array(group.items.length * MESH_INSTANCE_FLOATS);

    group.items.forEach((item, index) => {
      packMeshInstance(item, instances, index * MESH_INSTANCE_FLOATS);
    });

    return {
      key: group.key,
      geometry: group.geometry,
      floatsPerInstance: MESH_INSTANCE_FLOATS,
      instances,
      instanceIds: itemIds,
      instanceCount: group.items.length,
      instancesChanged: true,
      dirtyRanges: group.items.length > 0 ? [{ start: 0, count: group.items.length }] : []
    };
  }

  const instances = previous.instances;
  const dirtyRanges: TypeGpuInstanceDirtyRange[] = [];

  group.items.forEach((item, index) => {
    if (itemRevisions[index] === previous.itemRevisions[index]) return;

    packMeshInstance(item, instances, index * MESH_INSTANCE_FLOATS);
    appendDirtyRange(dirtyRanges, index);
  });

  return {
    key: group.key,
    geometry: group.geometry,
    floatsPerInstance: MESH_INSTANCE_FLOATS,
    instances,
    instanceIds: itemIds,
    instanceCount: group.items.length,
    instancesChanged: dirtyRanges.length > 0,
    dirtyRanges
  };
}

function batchKey(item: TypeGpuMeshDrawItem): string {
  return `mesh:${item.geometry.kind}:${item.material.kind}`;
}

function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function appendDirtyRange(ranges: TypeGpuInstanceDirtyRange[], index: number): void {
  const previous = ranges.at(-1);

  if (previous && previous.start + previous.count === index) {
    previous.count += 1;
    return;
  }

  ranges.push({ start: index, count: 1 });
}
```

- [ ] **Step 6: Wire scene state to draw-batch cache**

Replace `src/lib/typegpu-renderer/scene-state.ts` with:

```ts
import { readPerspectiveCamera } from './components/perspective-camera';
import { readSceneSettings } from './components/scene';
import { createDrawBatchCache, type TypeGpuDrawBatchCache } from './draw-batch-cache';
import type { TypeGpuNode } from './core';
import type { TypeGpuSceneState } from './types';

export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache()
  };
}

export function createSceneState(
  root: TypeGpuNode,
  cache: TypeGpuSceneCache = createTypeGpuSceneCache()
): TypeGpuSceneState {
  const scene = readSceneSettings(root);

  return {
    camera: readPerspectiveCamera(root),
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    drawBatches: cache.drawBatchCache.read(root)
  };
}
```

- [ ] **Step 7: Remove primitive cache component exports**

In `src/lib/typegpu-renderer/components/box.ts`, remove `createBoxInstanceCache`, `createBoxInstanceBuffer`, and primitive matching functions. Leave only compatibility exports if another file still imports them; after this step, this file should either be deleted or contain no used exports.

In `src/lib/typegpu-renderer/components/sphere.ts`, remove `createSphereInstanceCache` and `findFirstInteractiveSphere`. After this step, this file should either be deleted or contain no used exports.

In `src/lib/typegpu-renderer/svelte-renderer.ts`, replace the box-specific click dispatch import:

```ts
import { findFirstInteractiveMesh } from './components/mesh';
```

Then replace `dispatchCanvasClick` with:

```ts
  function dispatchCanvasClick(event: MouseEvent) {
    const mesh = findFirstInteractiveMesh(root, 'click');
    if (!mesh) return;

    dispatchNodeEvent(mesh, 'click', {
      originalEvent: event
    });
  }
```

Run:

```bash
rg "components/(box|sphere)|createBoxInstance|createSphereInstance|primitive:" src/lib/typegpu-renderer src -n
```

Expected: no references except deleted-file paths shown by git are absent from the working tree.

- [ ] **Step 8: Run tests for Task 2**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts src/lib/typegpu-renderer/box-data.test.ts
```

Expected: PASS for mesh batching and updated instance layout tests.

- [ ] **Step 9: Commit Task 2**

Run:

```bash
git add src/lib/typegpu-renderer/draw-batch-cache.ts src/lib/typegpu-renderer/instance-data.ts src/lib/typegpu-renderer/scene-state.ts src/lib/typegpu-renderer/components/box.ts src/lib/typegpu-renderer/components/sphere.ts src/lib/typegpu-renderer/svelte-renderer.ts src/lib/typegpu-renderer/core.test.ts src/lib/typegpu-renderer/box-data.ts src/lib/typegpu-renderer/sphere-data.ts src/lib/typegpu-renderer/box-data.test.ts
git commit -m "Replace primitive batches with mesh draw batches"
```

## Task 3: GPU Renderer Instance Layout

**Files:**
- Modify: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Test: `src/lib/typegpu-renderer/gpu-renderer.test.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Add renderer-layout expectations**

In `src/lib/typegpu-renderer/gpu-renderer.test.ts`, add:

```ts
import { MESH_INSTANCE_FLOATS, MESH_ROTATION_OFFSET } from './instance-data';
```

Then add this test:

```ts
  it('uses the mesh instance layout expected by the render pipeline', () => {
    expect(MESH_INSTANCE_FLOATS).toBe(20);
    expect(MESH_ROTATION_OFFSET).toBe(13);
  });
```

- [ ] **Step 2: Run renderer tests to verify current GPU code fails type checks later**

Run:

```bash
npx tsc --noEmit
```

Expected: FAIL because `gpu-renderer.ts` still imports `PRIMITIVE_*` constants that no longer exist.

- [ ] **Step 3: Update GPU renderer imports and range writes**

In `src/lib/typegpu-renderer/gpu-renderer.ts`, replace the `instance-data` import with:

```ts
import {
  MESH_INSTANCE_FLOATS,
  MESH_ROUGHNESS_OFFSET,
  MESH_ROTATION_OFFSET,
  MESH_SPIN_OFFSET_OFFSET,
  MESH_SPIN_SPEED_OFFSET,
  MESH_VERTEX_FLOATS
} from './instance-data';
```

In `#uploadInstances`, replace range writes that use `PRIMITIVE_INSTANCE_FLOATS` with `batch.floatsPerInstance`:

```ts
        writeFloat32BufferRange(
          device,
          buffers.instanceBuffer,
          instanceData,
          range.start * batch.floatsPerInstance,
          range.count * batch.floatsPerInstance
        );
```

In `#applyContinuity`, replace the offset logic with:

```ts
        const offset = index * batch.floatsPerInstance;
        const animationTime = this.#time * this.#animationSpeed + this.#animationOffset;

        batch.instances[offset + MESH_SPIN_OFFSET_OFFSET] = this.#continuity.offsetFor({
          key: batch.instanceIds[index],
          rate: batch.instances[offset + MESH_SPIN_SPEED_OFFSET],
          time: animationTime
        });
```

- [ ] **Step 4: Update shader input layout**

In the WGSL `VertexInput` struct in `gpu-renderer.ts`, replace the instance fields with:

```wgsl
        @location(2) instance_position: vec3<f32>,
        @location(3) phase: f32,
        @location(4) color: vec4<f32>,
        @location(5) shape: vec4<f32>,
        @location(6) spin_offset: f32,
        @location(7) world_rotation: vec3<f32>,
        @location(8) material: vec2<f32>,
```

Add this WGSL helper after `rotate_y`:

```wgsl
      fn rotate_z(position: vec3<f32>, angle: f32) -> vec3<f32> {
        let c = cos(angle);
        let s = sin(angle);
        return vec3(position.x * c - position.y * s, position.x * s + position.y * c, position.z);
      }
```

In `vertex_main`, replace rotated position and normal calculation with:

```wgsl
        let local_position = input.position * input.shape.xyz * scene.scale * pulse;
        let animated_position = rotate_x(rotate_y(local_position, spin_y), spin_x);
        let animated_normal = normalize(rotate_x(rotate_y(input.normal, spin_y), spin_x));
        let rotated_position = rotate_z(
          rotate_y(rotate_x(animated_position, input.world_rotation.x), input.world_rotation.y),
          input.world_rotation.z
        );
        let rotated_normal = normalize(rotate_z(
          rotate_y(rotate_x(animated_normal, input.world_rotation.x), input.world_rotation.y),
          input.world_rotation.z
        ));
```

In `fragment_main`, use roughness and metalness:

```wgsl
        let roughness = clamp(input.material.x, 0.0, 1.0);
        let metalness = clamp(input.material.y, 0.0, 1.0);
        let light = normalize(vec3(0.45, 0.78, 0.6));
        let diffuse = max(dot(normalize(input.normal), light), 0.0);
        let shade = 0.24 + diffuse * mix(0.78, 0.58, roughness);
        let lift = metalness * 0.08;

        return vec4(input.color.rgb * shade + lift, input.color.a);
```

Also add `@location(2) material: vec2<f32>,` to `VertexOutput`, set `output.material = input.material;`, and read `input.material` in the fragment function.

- [ ] **Step 5: Update vertex buffer descriptors**

In `createPipeline`, replace `PRIMITIVE_VERTEX_FLOATS` with `MESH_VERTEX_FLOATS`, and replace the instance buffer descriptor with:

```ts
        {
          arrayStride: MESH_INSTANCE_FLOATS * Float32Array.BYTES_PER_ELEMENT,
          stepMode: 'instance',
          attributes: [
            { shaderLocation: 2, offset: 0, format: 'float32x3' },
            { shaderLocation: 3, offset: 3 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
            { shaderLocation: 4, offset: 4 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
            { shaderLocation: 5, offset: 8 * Float32Array.BYTES_PER_ELEMENT, format: 'float32x4' },
            { shaderLocation: 6, offset: 12 * Float32Array.BYTES_PER_ELEMENT, format: 'float32' },
            { shaderLocation: 7, offset: MESH_ROTATION_OFFSET * Float32Array.BYTES_PER_ELEMENT, format: 'float32x3' },
            { shaderLocation: 8, offset: MESH_ROUGHNESS_OFFSET * Float32Array.BYTES_PER_ELEMENT, format: 'float32x2' }
          ]
        }
```

- [ ] **Step 6: Run type and renderer tests**

Run:

```bash
npx tsc --noEmit
npm run test -- src/lib/typegpu-renderer/gpu-renderer.test.ts src/lib/typegpu-renderer/core.test.ts
```

Expected: both commands pass.

- [ ] **Step 7: Commit Task 3**

Run:

```bash
git add src/lib/typegpu-renderer/gpu-renderer.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
git commit -m "Update TypeGPU renderer for mesh instance layout"
```

## Task 4: Public Svelte API Migration

**Files:**
- Modify: `src/Box.typegpu.svelte`
- Modify: `src/Sphere.typegpu.svelte`
- Modify: `src/Scene.typegpu.svelte`
- Create: `src/lib/typegpu-renderer/component-renderer.test.ts`

- [ ] **Step 1: Add component-rendering tests**

Create `src/lib/typegpu-renderer/component-renderer.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import Box from '../../Box.typegpu.svelte';
import Sphere from '../../Sphere.typegpu.svelte';
import renderer from './svelte-renderer';
import { createFragment, findFirst } from './core';

describe('TypeGPU public primitive components', () => {
  it('renders Box as a mesh with box geometry and standard material', () => {
    const root = createFragment();
    const instance = renderer.render(Box, {
      target: root,
      props: {
        position: [1, 2, 3] as [number, number, number],
        width: 4,
        height: 5,
        depth: 6,
        color: [0.2, 0.3, 0.4, 1] as [number, number, number, number],
        spinSpeed: 1.25
      }
    });

    const mesh = findFirst(root, (node) => node.name === 'mesh');
    const geometry = findFirst(root, (node) => node.name === 'boxGeometry');
    const material = findFirst(root, (node) => node.name === 'standardMaterial');

    expect(mesh?.attributes.position).toEqual([1, 2, 3]);
    expect(mesh?.attributes.spinSpeed).toBe(1.25);
    expect(geometry?.attributes).toMatchObject({ width: 4, height: 5, depth: 6 });
    expect(material?.attributes.color).toEqual([0.2, 0.3, 0.4, 1]);

    instance.unmount();
  });

  it('renders Sphere as a mesh with sphere geometry and standard material', () => {
    const root = createFragment();
    const instance = renderer.render(Sphere, {
      target: root,
      props: {
        position: [3, 2, 1] as [number, number, number],
        radius: 2,
        color: [0.8, 0.7, 0.6, 1] as [number, number, number, number],
        spinSpeed: 0.5
      }
    });

    const mesh = findFirst(root, (node) => node.name === 'mesh');
    const geometry = findFirst(root, (node) => node.name === 'sphereGeometry');
    const material = findFirst(root, (node) => node.name === 'standardMaterial');

    expect(mesh?.attributes.position).toEqual([3, 2, 1]);
    expect(mesh?.attributes.spinSpeed).toBe(0.5);
    expect(geometry?.attributes.radius).toBe(2);
    expect(material?.attributes.color).toEqual([0.8, 0.7, 0.6, 1]);

    instance.unmount();
  });
});
```

- [ ] **Step 2: Run component test to verify it fails**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts
```

Expected: FAIL because `Box` still renders `<box>` and `Sphere` still renders `<sphere>`.

- [ ] **Step 3: Rewrite `Box.typegpu.svelte`**

Replace the rendered markup in `src/Box.typegpu.svelte` with:

```svelte
<mesh
  role="button"
  tabindex="0"
  aria-label="Change box color"
  {position}
  {phase}
  {spinSpeed}
  onclick={onclick}
  onkeydown={activateFromKeyboard}
>
  <boxGeometry {width} {height} {depth}></boxGeometry>
  <standardMaterial {color}></standardMaterial>
</mesh>
```

- [ ] **Step 4: Rewrite `Sphere.typegpu.svelte`**

Replace the rendered markup in `src/Sphere.typegpu.svelte` with:

```svelte
<mesh
  role="button"
  tabindex="0"
  aria-label="Change sphere color"
  {position}
  {phase}
  {spinSpeed}
  onclick={onclick}
  onkeydown={activateFromKeyboard}
>
  <sphereGeometry {radius} {width} {height} {depth}></sphereGeometry>
  <standardMaterial {color}></standardMaterial>
</mesh>
```

- [ ] **Step 5: Rewrite the demo to use the full API directly**

In `src/Scene.typegpu.svelte`, remove the `Box` and `Sphere` imports. Add this keyboard helper below `spinSpeedForIndex`:

```ts
  function activateShapeFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      onShapeClick();
    }
  }
```

Replace the `{#each}` body with:

```svelte
  {#each boxes as box, index (box.id)}
    <mesh
      role="button"
      tabindex="0"
      aria-label="Change shape color"
      position={box.position}
      phase={box.phase}
      spinSpeed={isSphere(index) ? spinSpeedForIndex(index + 3) : spinSpeedForIndex(index)}
      onclick={onShapeClick}
      onkeydown={activateShapeFromKeyboard}
    >
      {#if isSphere(index)}
        <sphereGeometry
          radius={sphereSize(index) / 2}
          width={sphereSize(index)}
          height={sphereSize(index)}
          depth={sphereSize(index)}
        ></sphereGeometry>
        <standardMaterial
          color={demoColorForIndex(index + 7, controls.hue + 28)}
          roughness={0.52}
          metalness={0.08}
        ></standardMaterial>
      {:else}
        <boxGeometry
          width={boxWidth(index)}
          height={boxHeight(index)}
          depth={boxDepth(index)}
        ></boxGeometry>
        <standardMaterial
          color={demoColorForIndex(index, controls.hue)}
          roughness={index % 5 === 0 ? 0.68 : 0.38}
          metalness={index % 9 === 0 ? 0.22 : 0.08}
        ></standardMaterial>
      {/if}
    </mesh>
  {/each}
```

- [ ] **Step 6: Run Svelte autofixer**

Use the Svelte autofixer on:

- `src/Box.typegpu.svelte`
- `src/Sphere.typegpu.svelte`
- `src/Scene.typegpu.svelte`

Expected: no issues requiring code changes. If it reports concrete syntax issues, apply the exact fixes and run the autofixer again.

- [ ] **Step 7: Run component and core tests**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts src/lib/typegpu-renderer/core.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit Task 4**

Run:

```bash
git add src/Box.typegpu.svelte src/Sphere.typegpu.svelte src/Scene.typegpu.svelte src/lib/typegpu-renderer/component-renderer.test.ts
git commit -m "Expose mesh geometry material TypeGPU API"
```

## Task 5: Full Verification and Cleanup

**Files:**
- Modify only if verification exposes a concrete issue in files touched by Tasks 1-4.

- [ ] **Step 1: Search for obsolete primitive renderer names**

Run:

```bash
rg "primitive:|<box|<sphere|findFirstInteractiveBox|findFirstInteractiveSphere|createPrimitiveInstanceCache|packPrimitiveInstance|PRIMITIVE_" src -n
```

Expected: no matches, except text inside old git history is not searched.

- [ ] **Step 2: Run the full local verification suite**

Run:

```bash
npx tsc --noEmit
npm run test
npm run build
```

Expected:

- `npx tsc --noEmit` exits `0`.
- `npm run test` exits `0`.
- `npm run build` exits `0`.

- [ ] **Step 3: Browser verification**

Use the in-app browser at `http://localhost:5173/`.

Verify:

- The scene renders after reload.
- The TypeGPU-only UI still has FPS, hue, spin, scale, camera, count, pause, slow, and fast controls.
- The `1`, `1k`, and `10k` buttons still change count.
- Hue shifting changes material color without freezing.
- Spin and scale sliders update the scene.
- Console warning/error logs are empty after reload and after selecting `1k`.

- [ ] **Step 4: Commit verification cleanup if files changed**

If Step 1, 2, or 3 required code changes, run:

```bash
git add src/lib/typegpu-renderer src/Box.typegpu.svelte src/Sphere.typegpu.svelte src/Scene.typegpu.svelte src/TypeGpuCanvas.svelte src/App.svelte src/style.css vite.config.ts package.json package-lock.json tsconfig.json
git commit -m "Stabilize TypeGPU full API"
```

If no files changed, skip this commit.

- [ ] **Step 5: Report final state**

Run:

```bash
git status --short
git log --oneline -5
```

Expected: clean worktree, with the latest commits matching Tasks 1-4 and optional Task 5 cleanup.

## Self-Review

- Spec coverage: covered nested groups, mesh composition, geometry/material children, automatic batching, per-instance colors, material fields, invalid composition, interaction mapping, convenience components, demo migration, and browser verification.
- Placeholder scan: no deferred implementation markers or vague test instructions remain.
- Type consistency: all plan tasks use `TypeGpuMeshDrawItem`, `TypeGpuGeometryDescriptor`, `TypeGpuMaterialDescriptor`, `TypeGpuTransform`, `MESH_INSTANCE_FLOATS`, `MESH_SPIN_SPEED_OFFSET`, and batch keys of the form `mesh:<geometry>:standard`.
