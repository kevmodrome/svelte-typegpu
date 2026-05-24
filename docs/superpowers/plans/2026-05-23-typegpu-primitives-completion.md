# TypeGPU Primitives Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Svelte TypeGPU custom renderer around the guide-aligned scene primitive API, complete the MVP primitive set, and replace ad hoc internals with scene IR compilation, dirty descriptors, resource caches, interaction picking, and render-loop modes.

**Architecture:** Treat the existing implementation as reference material, not as a compatibility constraint. Build a clean host-tree -> scene compiler -> draw/resource plan -> TypeGPU backend pipeline, with primitive descriptors driving dirtiness and compilation. Keep only modules that fit this shape without contortions; rewrite or delete the rest.

**Tech Stack:** Svelte 5 custom renderer, TypeScript, TypeGPU/WebGPU, Vite, Vitest.

---

## File Structure

- Create `src/lib/typegpu-renderer/dirty.ts`: dirty bitmask enum and helper predicates.
- Create `src/lib/typegpu-renderer/primitives.ts`: primitive alias registry and descriptor dirtiness.
- Create `src/lib/typegpu-renderer/math3d.ts`: vector, matrix, transform, and ray helpers used by cameras, bounds, and interaction.
- Create `src/lib/typegpu-renderer/bounds.ts`: local bounds, transformed bounds, ray/AABB intersection, and procedural geometry bounds.
- Create `src/lib/typegpu-renderer/camera.ts`: direct `perspectiveCamera`, `orthographicCamera`, and `orbitControls` scene readers.
- Create `src/lib/typegpu-renderer/resources.ts`: reusable geometry, material, texture, and sampler resource collection by `id`.
- Create `src/lib/typegpu-renderer/geometries.ts`: box, plane, sphere, and buffer geometry descriptors and vertex data creation.
- Create `src/lib/typegpu-renderer/material-descriptors.ts`: basic, phong, and standard material normalization and key calculation.
- Create `src/lib/typegpu-renderer/scene-compiler.ts`: full scene IR compiler.
- Create `src/lib/typegpu-renderer/interaction-index.ts`: CPU bounds picking and hover state.
- Create `src/lib/typegpu-renderer/render-plan.ts`: single-main-pass render plan and draw batch ordering helpers.
- Create `src/lib/typegpu-renderer/resource-caches.ts`: GPU resource cache helpers that can be tested without a real GPU where possible.
- Replace `src/lib/typegpu-renderer/types.ts`: public and internal renderer types for the rebuilt architecture.
- Replace `src/lib/typegpu-renderer/core.ts`: host-tree mutation layer using descriptor dirtiness.
- Replace `src/lib/typegpu-renderer/scene-state.ts`: compatibility export that delegates to `scene-compiler.ts`, or delete imports and update callers.
- Replace `src/lib/typegpu-renderer/draw-batch-cache.ts`: draw item grouping keyed by pass, pipeline, material, bind group, geometry, topology, and render order.
- Replace `src/lib/typegpu-renderer/gpu-renderer.ts`: TypeGPU backend with explicit geometry, instance, material, texture, sampler, pipeline, and render target cache ownership.
- Replace `src/lib/typegpu-renderer/svelte-renderer.ts`: root runtime, frame loop modes, dirty scheduling, and canvas event dispatch.
- Update or delete obsolete files under `src/lib/typegpu-renderer/component-helpers/` when `scene-compiler.ts` replaces them.
- Update `src/Scene.typegpu.svelte`: rebuild the demo around target primitives.
- Update `src/TypeGpuCanvas.svelte`: pass root options and call the rebuilt root lifecycle.
- Update or remove `src/Box.typegpu.svelte` and `src/Sphere.typegpu.svelte`: keep only if they remain useful thin examples over the target primitives.
- Update tests under `src/lib/typegpu-renderer/*.test.ts` and `src/*.test.ts`: remove tests that assert obsolete internals and add target-behavior tests described below.

## Task 1: Dirty Bitmask And Primitive Descriptor Registry

**Files:**
- Create: `src/lib/typegpu-renderer/dirty.ts`
- Create: `src/lib/typegpu-renderer/primitives.ts`
- Replace: `src/lib/typegpu-renderer/types.ts`
- Test: `src/lib/typegpu-renderer/primitives.test.ts`

- [ ] **Step 1: Write failing descriptor tests**

Create `src/lib/typegpu-renderer/primitives.test.ts` with:

```ts
import { describe, expect, it } from 'vitest';
import { Dirty, hasDirty } from './dirty';
import {
  dirtyForAttribute,
  dirtyForEventListener,
  dirtyForInsert,
  dirtyForRemove,
  normalizePrimitiveName
} from './primitives';

describe('TypeGPU primitive descriptors', () => {
  it('normalizes public primitive aliases', () => {
    expect(normalizePrimitiveName('perspective-camera')).toBe('perspectiveCamera');
    expect(normalizePrimitiveName('orthographic-camera')).toBe('orthographicCamera');
    expect(normalizePrimitiveName('orbit-controls')).toBe('orbitControls');
    expect(normalizePrimitiveName('box-geometry')).toBe('boxGeometry');
    expect(normalizePrimitiveName('plane-geometry')).toBe('planeGeometry');
    expect(normalizePrimitiveName('sphere-geometry')).toBe('sphereGeometry');
    expect(normalizePrimitiveName('buffer-geometry')).toBe('bufferGeometry');
    expect(normalizePrimitiveName('basic-material')).toBe('basicMaterial');
    expect(normalizePrimitiveName('phong-material')).toBe('phongMaterial');
    expect(normalizePrimitiveName('standard-material')).toBe('standardMaterial');
    expect(normalizePrimitiveName('instanced-mesh')).toBe('instancedMesh');
    expect(normalizePrimitiveName('unknown-node')).toBe('unknown-node');
  });

  it('marks scene render settings without forcing mesh rebuilds', () => {
    const dirty = dirtyForAttribute('scene', 'clearColor', undefined, [0, 0, 0, 1]);

    expect(hasDirty(dirty, Dirty.RenderSettings)).toBe(true);
    expect(hasDirty(dirty, Dirty.DrawBatches)).toBe(false);
  });

  it('marks transform attributes as transform, instance, and interaction dirty', () => {
    const dirty = dirtyForAttribute('mesh', 'position', [0, 0, 0], [1, 2, 3]);

    expect(hasDirty(dirty, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirty, Dirty.InstanceData)).toBe(true);
    expect(hasDirty(dirty, Dirty.Interaction)).toBe(true);
  });

  it('marks geometry, material, texture, and pipeline-affecting attributes distinctly', () => {
    expect(hasDirty(dirtyForAttribute('boxGeometry', 'width', 1, 2), Dirty.Geometry)).toBe(true);
    expect(hasDirty(dirtyForAttribute('boxGeometry', 'width', 1, 2), Dirty.DrawBatches)).toBe(true);
    expect(hasDirty(dirtyForAttribute('phongMaterial', 'color', [1, 1, 1, 1], [1, 0, 0, 1]), Dirty.MaterialUniform)).toBe(true);
    expect(hasDirty(dirtyForAttribute('phongMaterial', 'map', '/a.png', '/b.png'), Dirty.Texture)).toBe(true);
    expect(hasDirty(dirtyForAttribute('phongMaterial', 'map', '/a.png', '/b.png'), Dirty.BindGroup)).toBe(true);
    expect(hasDirty(dirtyForAttribute('standardMaterial', 'transparent', false, true), Dirty.Pipeline)).toBe(true);
  });

  it('marks insert, remove, and interaction listeners', () => {
    expect(hasDirty(dirtyForInsert('mesh'), Dirty.DrawBatches)).toBe(true);
    expect(hasDirty(dirtyForInsert('mesh'), Dirty.Interaction)).toBe(true);
    expect(hasDirty(dirtyForRemove('pointLight'), Dirty.Lights)).toBe(true);
    expect(hasDirty(dirtyForEventListener('mesh', 'click'), Dirty.Interaction)).toBe(true);
    expect(hasDirty(dirtyForEventListener('mesh', 'keydown'), Dirty.Interaction)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the descriptor test to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/primitives.test.ts
```

Expected: FAIL because `dirty.ts` and `primitives.ts` do not exist.

- [ ] **Step 3: Implement dirty helpers**

Create `src/lib/typegpu-renderer/dirty.ts`:

```ts
export const enum Dirty {
  None = 0,
  Tree = 1 << 0,
  Transform = 1 << 1,
  InstanceData = 1 << 2,
  DrawBatches = 1 << 3,
  Geometry = 1 << 4,
  Material = 1 << 5,
  MaterialUniform = 1 << 6,
  Texture = 1 << 7,
  BindGroup = 1 << 8,
  Pipeline = 1 << 9,
  Lights = 1 << 10,
  Camera = 1 << 11,
  Interaction = 1 << 12,
  RenderSettings = 1 << 13,
  Sampler = 1 << 14,
  All = 0xffff_ffff
}

export function hasDirty(mask: Dirty, flag: Dirty): boolean {
  return (mask & flag) !== 0;
}

export function mergeDirty(...masks: Dirty[]): Dirty {
  return masks.reduce((merged, mask) => (merged | mask) as Dirty, Dirty.None);
}
```

- [ ] **Step 4: Implement primitive descriptors**

Create `src/lib/typegpu-renderer/primitives.ts`:

```ts
import { Dirty, mergeDirty } from './dirty';

const aliases = new Map<string, string>([
  ['perspective-camera', 'perspectiveCamera'],
  ['orthographic-camera', 'orthographicCamera'],
  ['orbit-controls', 'orbitControls'],
  ['ambient-light', 'ambientLight'],
  ['hemisphere-light', 'hemisphereLight'],
  ['directional-light', 'directionalLight'],
  ['point-light', 'pointLight'],
  ['spot-light', 'spotLight'],
  ['instanced-mesh', 'instancedMesh'],
  ['box-geometry', 'boxGeometry'],
  ['plane-geometry', 'planeGeometry'],
  ['sphere-geometry', 'sphereGeometry'],
  ['buffer-geometry', 'bufferGeometry'],
  ['basic-material', 'basicMaterial'],
  ['phong-material', 'phongMaterial'],
  ['standard-material', 'standardMaterial']
]);

const transformAttributes = new Set(['position', 'rotation', 'scale', 'matrix']);
const sceneAttributes = new Set(['clearColor', 'background', 'activeCamera']);
const sceneUniformAttributes = new Set(['scale', 'animationSpeed', 'colorShift']);
const cameraAttributes = new Set(['id', 'active', 'position', 'target', 'fov', 'near', 'far', 'zoom']);
const controlAttributes = new Set([
  'camera',
  'enabled',
  'target',
  'minDistance',
  'maxDistance',
  'enablePan',
  'enableZoom',
  'enableRotate',
  'rotateSpeed',
  'zoomSpeed'
]);
const geometryNames = new Set(['boxGeometry', 'planeGeometry', 'sphereGeometry', 'bufferGeometry']);
const materialNames = new Set(['basicMaterial', 'phongMaterial', 'standardMaterial']);
const materialUniformAttributes = new Set(['color', 'opacity', 'roughness', 'metalness']);
const materialBindAttributes = new Set(['map', 'sampler']);
const materialPipelineAttributes = new Set(['transparent', 'blendMode', 'depthWrite', 'depthTest', 'cullMode', 'doubleSided']);
const textureAttributes = new Set(['src', 'data', 'width', 'height', 'format', 'colorSpace']);
const samplerAttributes = new Set(['magFilter', 'minFilter', 'mipmapFilter', 'addressModeU', 'addressModeV', 'addressModeW']);
const lightNames = new Set(['ambientLight', 'hemisphereLight', 'directionalLight', 'pointLight', 'spotLight']);
const pointerEvents = new Set(['click', 'pointermove', 'pointerenter', 'pointerleave', 'pointerdown', 'pointerup']);

export function normalizePrimitiveName(name: string): string {
  return aliases.get(name) ?? name;
}

export function dirtyForAttribute(
  nodeName: string | undefined,
  attribute: string,
  previous: unknown,
  next: unknown
): Dirty {
  if (Object.is(previous, next)) return Dirty.None;

  const name = normalizePrimitiveName(nodeName ?? '');

  if (name === 'scene') {
    if (sceneAttributes.has(attribute)) return Dirty.RenderSettings;
    if (sceneUniformAttributes.has(attribute)) return Dirty.InstanceData;
    return Dirty.None;
  }

  if (transformAttributes.has(attribute)) {
    return mergeDirty(Dirty.Transform, Dirty.InstanceData, Dirty.Interaction);
  }

  if (attribute === 'visible' || attribute === 'renderOrder') {
    return mergeDirty(Dirty.DrawBatches, Dirty.Interaction);
  }

  if (name === 'perspectiveCamera' || name === 'orthographicCamera') {
    return cameraAttributes.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  if (name === 'orbitControls') {
    return controlAttributes.has(attribute) ? Dirty.Camera : Dirty.None;
  }

  if (lightNames.has(name)) {
    return Dirty.Lights;
  }

  if (geometryNames.has(name)) {
    return mergeDirty(Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
  }

  if (materialNames.has(name)) {
    if (materialUniformAttributes.has(attribute)) return Dirty.MaterialUniform;
    if (materialBindAttributes.has(attribute)) return mergeDirty(Dirty.Material, Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches);
    if (materialPipelineAttributes.has(attribute)) return mergeDirty(Dirty.Material, Dirty.Pipeline, Dirty.DrawBatches);
    if (attribute === 'id') return mergeDirty(Dirty.Material, Dirty.DrawBatches);
  }

  if (name === 'texture') {
    return textureAttributes.has(attribute) || attribute === 'id' ? mergeDirty(Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches) : Dirty.None;
  }

  if (name === 'sampler') {
    return samplerAttributes.has(attribute) || attribute === 'id' ? mergeDirty(Dirty.Sampler, Dirty.BindGroup, Dirty.DrawBatches) : Dirty.None;
  }

  if (name === 'mesh' || name === 'instancedMesh' || name === 'model') {
    if (attribute === 'geometry' || attribute === 'material' || attribute === 'instances') return mergeDirty(Dirty.DrawBatches, Dirty.Interaction);
    if (attribute === 'pointerEvents' || attribute === 'hitTest') return Dirty.Interaction;
  }

  return Dirty.None;
}

export function dirtyForInsert(nodeName: string | undefined): Dirty {
  return dirtyForTreeChange(nodeName);
}

export function dirtyForRemove(nodeName: string | undefined): Dirty {
  return dirtyForTreeChange(nodeName);
}

export function dirtyForEventListener(nodeName: string | undefined, eventName: string): Dirty {
  const name = normalizePrimitiveName(nodeName ?? '');

  return (name === 'mesh' || name === 'instancedMesh' || name === 'model') && pointerEvents.has(eventName)
    ? Dirty.Interaction
    : Dirty.None;
}

function dirtyForTreeChange(nodeName: string | undefined): Dirty {
  const name = normalizePrimitiveName(nodeName ?? '');

  if (name === 'scene') return Dirty.All;
  if (name === 'perspectiveCamera' || name === 'orthographicCamera' || name === 'orbitControls') return mergeDirty(Dirty.Tree, Dirty.Camera);
  if (lightNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Lights);
  if (geometryNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Geometry, Dirty.DrawBatches, Dirty.Interaction);
  if (materialNames.has(name)) return mergeDirty(Dirty.Tree, Dirty.Material, Dirty.DrawBatches);
  if (name === 'texture') return mergeDirty(Dirty.Tree, Dirty.Texture, Dirty.BindGroup, Dirty.DrawBatches);
  if (name === 'sampler') return mergeDirty(Dirty.Tree, Dirty.BindGroup, Dirty.DrawBatches);
  if (name === 'mesh' || name === 'instancedMesh' || name === 'model' || name === 'group') {
    return mergeDirty(Dirty.Tree, Dirty.DrawBatches, Dirty.Interaction);
  }

  return Dirty.Tree;
}
```

- [ ] **Step 5: Run descriptor tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/primitives.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/dirty.ts src/lib/typegpu-renderer/primitives.ts src/lib/typegpu-renderer/primitives.test.ts
git commit -m "feat: add typegpu primitive dirty descriptors"
```

## Task 2: Host Tree Runtime Dirty Scheduling

**Files:**
- Replace: `src/lib/typegpu-renderer/core.ts`
- Modify: `src/lib/typegpu-renderer/svelte-renderer.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`
- Test: `src/lib/typegpu-renderer/svelte-renderer.test.ts`

- [ ] **Step 1: Write failing host-tree dirty tests**

Replace obsolete host-tree dirtiness tests in `src/lib/typegpu-renderer/core.test.ts` with this block:

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  addEventListener,
  createElement,
  createFragment,
  insert,
  remove,
  removeAttribute,
  setAttribute,
  type TypeGpuNode,
  type TypeGpuRuntime
} from './core';
import { Dirty, hasDirty } from './dirty';

describe('TypeGPU host tree dirty scheduling', () => {
  function runtimeFor(root: TypeGpuNode) {
    const scheduleSync = vi.fn();
    root.runtime = { scheduleSync } satisfies TypeGpuRuntime;
    return scheduleSync;
  }

  it('schedules attribute changes with descriptor dirty masks', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const scheduleSync = runtimeFor(root);

    insert(root, scene, null);
    insert(scene, mesh, null);
    scheduleSync.mockClear();

    setAttribute(mesh, 'position', [1, 2, 3]);

    const [, dirtyNode, dirtyMask] = scheduleSync.mock.calls.at(-1)!;
    expect(dirtyNode).toBe(mesh);
    expect(hasDirty(dirtyMask, Dirty.Transform)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.InstanceData)).toBe(true);
  });

  it('schedules removeAttribute with previous value awareness', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const material = createElement('phongMaterial');
    const scheduleSync = runtimeFor(root);

    insert(root, scene, null);
    insert(scene, material, null);
    setAttribute(material, 'map', '/textures/a.png');
    scheduleSync.mockClear();

    removeAttribute(material, 'map');

    const [, dirtyNode, dirtyMask] = scheduleSync.mock.calls.at(-1)!;
    expect(dirtyNode).toBe(material);
    expect(hasDirty(dirtyMask, Dirty.Texture)).toBe(true);
    expect(hasDirty(dirtyMask, Dirty.BindGroup)).toBe(true);
  });

  it('schedules tree and interaction changes for insert, remove, and listeners', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const scheduleSync = runtimeFor(root);

    insert(root, scene, null);
    scheduleSync.mockClear();
    insert(scene, mesh, null);
    expect(hasDirty(scheduleSync.mock.calls.at(-1)![2], Dirty.DrawBatches)).toBe(true);

    scheduleSync.mockClear();
    addEventListener(mesh, 'click', vi.fn());
    expect(hasDirty(scheduleSync.mock.calls.at(-1)![2], Dirty.Interaction)).toBe(true);

    scheduleSync.mockClear();
    remove(mesh);
    expect(hasDirty(scheduleSync.mock.calls.at(-1)![2], Dirty.Interaction)).toBe(true);
  });
});
```

- [ ] **Step 2: Run host-tree tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: FAIL because `TypeGpuRuntime.scheduleSync` does not accept a dirty mask and listener changes do not schedule sync.

- [ ] **Step 3: Replace runtime dirty API in `core.ts`**

Change `TypeGpuRuntime` and invalidation calls to this shape:

```ts
import { Dirty } from './dirty';
import {
  dirtyForAttribute,
  dirtyForEventListener,
  dirtyForInsert,
  dirtyForRemove,
  normalizePrimitiveName
} from './primitives';

export interface TypeGpuRuntime {
  scheduleSync(root: TypeGpuNode, dirtyNode?: TypeGpuNode, dirtyMask?: Dirty): void;
}

export function createElement(name: string): TypeGpuNode {
  const node = createStub('element');
  node.name = normalizePrimitiveName(name);
  node.originalName = name;
  return node;
}

export function setAttribute(node: TypeGpuNode, key: string, value: unknown): void {
  const previous = node.attributes[key];
  node.attributes[key] = value;
  node.revision += 1;
  invalidateFrom(node, dirtyForAttribute(node.name, key, previous, value));
}

export function removeAttribute(node: TypeGpuNode, key: string): void {
  const previous = node.attributes[key];
  delete node.attributes[key];
  node.revision += 1;
  invalidateFrom(node, dirtyForAttribute(node.name, key, previous, undefined));
}

export function insert(parent: TypeGpuNode, node: TypeGpuNode, anchor: TypeGpuNode | null): void {
  // Keep the existing linked-list insert behavior, then call:
  const root = markTreeChanged(parent);
  invalidateRoot(root, node, dirtyForInsert(node.name));
}

export function remove(node: TypeGpuNode): void {
  // Keep the existing linked-list remove behavior, then call before clearing the node name:
  const root = markTreeChanged(parent);
  invalidateRoot(root, node, dirtyForRemove(node.name));
}

export function addEventListener(
  node: TypeGpuNode,
  type: string,
  handler: (event: TypeGpuNodeEvent) => void
): void {
  const listeners = node.listeners.get(type) ?? new Set();
  listeners.add(handler);
  node.listeners.set(type, listeners);
  invalidateFrom(node, dirtyForEventListener(node.name, type));
}

export function removeEventListener(
  node: TypeGpuNode,
  type: string,
  handler: (event: TypeGpuNodeEvent) => void
): void {
  const listeners = node.listeners.get(type);
  listeners?.delete(handler);
  if (listeners?.size === 0) node.listeners.delete(type);
  invalidateFrom(node, dirtyForEventListener(node.name, type));
}

function invalidateFrom(node: TypeGpuNode, dirtyMask: Dirty): void {
  const root = findRoot(node);
  invalidateRoot(root, node, dirtyMask);
}

function invalidateRoot(root: TypeGpuNode, dirtyNode: TypeGpuNode, dirtyMask: Dirty): void {
  if (dirtyMask === Dirty.None) return;
  root.runtime?.scheduleSync(root, dirtyNode, dirtyMask);
}
```

Also add `originalName?: string;` to `TypeGpuNode`.

- [ ] **Step 4: Update runtime scheduling test**

In `src/lib/typegpu-renderer/svelte-renderer.test.ts`, add:

```ts
import { Dirty, hasDirty } from './dirty';

it('coalesces dirty masks before compiling the scene', async () => {
  const root = createFragment();
  const scene = createElement('scene');
  const mesh = createElement('mesh');
  const renderer = fakeRenderer();
  const runtime = createTypeGpuRuntimeForTest(
    root,
    new FakeCanvas() as unknown as HTMLCanvasElement,
    renderer
  );

  insert(root, scene, null);
  insert(scene, mesh, null);
  runtime.scheduleSync(root, mesh, Dirty.Transform);
  runtime.scheduleSync(root, mesh, Dirty.Lights);
  await Promise.resolve();

  const setScene = vi.mocked(renderer.setScene);
  const lastScene = setScene.mock.calls.at(-1)?.[0];
  expect(lastScene).toBeTruthy();
  expect(hasDirty(lastScene!.dirty, Dirty.Transform)).toBe(true);
  expect(hasDirty(lastScene!.dirty, Dirty.Lights)).toBe(true);
});
```

- [ ] **Step 5: Run runtime scheduling test to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/svelte-renderer.test.ts
```

Expected: FAIL because `TypeGpuSceneState` does not expose `dirty` and runtime does not merge masks yet.

- [ ] **Step 6: Update runtime mask coalescing**

In `src/lib/typegpu-renderer/svelte-renderer.ts`, replace `drawBatchesDirty` and `lightsDirty` with:

```ts
let dirty = Dirty.All;

function scheduleSync(nextRoot: TypeGpuNode, dirtyNode?: TypeGpuNode, dirtyMask: Dirty = Dirty.All) {
  root = nextRoot;
  dirty = (dirty | dirtyMask) as Dirty;

  if (queued) return;

  queued = true;
  queueMicrotask(() => {
    queued = false;
    const scene = createSceneState(root, sceneCache, { dirty });
    gpu.setScene(scene);
    cameraInteraction.reconcile(scene);
    syncedTreeRevision = root.treeRevision;
    dirty = Dirty.None;
  });
}
```

This step can keep `syncedTreeRevision` only if a compiler cache still uses it. Delete it once no code reads it.

- [ ] **Step 7: Run host-tree and runtime tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts src/lib/typegpu-renderer/svelte-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/typegpu-renderer/core.ts src/lib/typegpu-renderer/svelte-renderer.ts src/lib/typegpu-renderer/core.test.ts src/lib/typegpu-renderer/svelte-renderer.test.ts
git commit -m "feat: route host tree dirtiness through descriptors"
```

## Task 3: Math, Bounds, And Camera State

**Files:**
- Create: `src/lib/typegpu-renderer/math3d.ts`
- Create: `src/lib/typegpu-renderer/bounds.ts`
- Create: `src/lib/typegpu-renderer/camera.ts`
- Replace: `src/lib/typegpu-renderer/camera-math.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Test: `src/lib/typegpu-renderer/camera-math.test.ts`
- Test: `src/lib/typegpu-renderer/bounds.test.ts`

- [ ] **Step 1: Write failing camera and bounds tests**

Create `src/lib/typegpu-renderer/bounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { boxBounds, planeBounds, rayIntersectsBounds, sphereBounds, transformBounds } from './bounds';

describe('TypeGPU bounds', () => {
  it('creates procedural bounds and transforms them', () => {
    expect(boxBounds([2, 4, 6])).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
    expect(planeBounds([4, 6, 0])).toEqual({ min: [-2, 0, -3], max: [2, 0, 3] });
    expect(sphereBounds([2, 2, 2])).toEqual({ min: [-1, -1, -1], max: [1, 1, 1] });

    expect(transformBounds(boxBounds([2, 2, 2]), {
      position: [5, 0, 0],
      rotation: [0, 0, 0],
      scale: [2, 1, 1]
    })).toEqual({ min: [3, -1, -1], max: [7, 1, 1] });
  });

  it('picks the nearest positive ray intersection', () => {
    const hit = rayIntersectsBounds(
      { origin: [0, 0, 5], direction: [0, 0, -1] },
      { min: [-1, -1, -1], max: [1, 1, 1] }
    );

    expect(hit?.distance).toBeCloseTo(4);
    expect(hit?.point).toEqual([0, 0, 1]);
    expect(rayIntersectsBounds({ origin: [0, 0, 5], direction: [0, 1, 0] }, { min: [-1, -1, -1], max: [1, 1, 1] })).toBeNull();
  });
});
```

Create `src/lib/typegpu-renderer/camera-math.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cameraRayFromViewport,
  createViewProjectionMatrix,
  readCameraState
} from './camera';
import { createElement, createFragment, insert, setAttribute } from './core';

describe('TypeGPU cameras', () => {
  it('reads direct perspective camera props', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');

    setAttribute(camera, 'position', [1, 2, 3]);
    setAttribute(camera, 'target', [0, 1, 0]);
    setAttribute(camera, 'fov', 50);
    setAttribute(camera, 'near', 0.5);
    setAttribute(camera, 'far', 250);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readCameraState(root).settings).toEqual({
      projection: 'perspective',
      position: [1, 2, 3],
      target: [0, 1, 0],
      fov: 50,
      near: 0.5,
      far: 250
    });
  });

  it('reads orthographic camera props and creates a stable matrix', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('orthographicCamera');

    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(camera, 'zoom', 2);
    insert(scene, camera, null);
    insert(root, scene, null);

    const state = readCameraState(root).settings;
    const matrix = createViewProjectionMatrix(1, state);

    expect(state.projection).toBe('orthographic');
    expect(matrix).toHaveLength(16);
    expect(Number.isFinite(matrix[0])).toBe(true);
  });

  it('creates camera rays from viewport coordinates', () => {
    const ray = cameraRayFromViewport({
      x: 50,
      y: 50,
      viewport: { width: 100, height: 100 },
      camera: {
        projection: 'perspective',
        position: [0, 0, 10],
        target: [0, 0, 0],
        fov: 45,
        near: 0.1,
        far: 100
      }
    });

    expect(ray.origin).toEqual([0, 0, 10]);
    expect(ray.direction[2]).toBeLessThan(-0.99);
  });
});
```

- [ ] **Step 2: Run camera and bounds tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-math.test.ts src/lib/typegpu-renderer/bounds.test.ts
```

Expected: FAIL because the new camera and bounds modules do not exist.

- [ ] **Step 3: Add shared math types**

Replace `src/lib/typegpu-renderer/types.ts` with types that include:

```ts
import type { TypeGpuNode } from './core';

export type Vector2Tuple = [number, number];
export type Vector3Tuple = [number, number, number];
export type Vector4Tuple = [number, number, number, number];
export type RgbaTuple = Vector4Tuple;
export type TypeGpuInstanceId = number | string;

export interface TypeGpuTransform {
  position: Vector3Tuple;
  rotation: Vector3Tuple;
  scale: Vector3Tuple;
}

export interface TypeGpuBounds {
  min: Vector3Tuple;
  max: Vector3Tuple;
}

export interface TypeGpuRay {
  origin: Vector3Tuple;
  direction: Vector3Tuple;
}

export type TypeGpuCameraSettings =
  | {
      projection: 'perspective';
      position: Vector3Tuple;
      target: Vector3Tuple;
      fov: number;
      near: number;
      far: number;
    }
  | {
      projection: 'orthographic';
      position: Vector3Tuple;
      target: Vector3Tuple;
      zoom: number;
      near: number;
      far: number;
    };

export interface TypeGpuCameraState {
  node: TypeGpuNode | null;
  settings: TypeGpuCameraSettings;
  controllerNode: TypeGpuNode | null;
  controller: TypeGpuCameraController | null;
}

export interface TypeGpuCameraController {
  kind: 'orbit';
  camera: string | null;
  enabled: boolean;
  target: Vector3Tuple;
  minDistance: number;
  maxDistance: number;
  enablePan: boolean;
  enableZoom: boolean;
  enableRotate: boolean;
  rotateSpeed: number;
  zoomSpeed: number;
}
```

Then preserve other shared types needed by existing imports temporarily by moving them into this new file as the compiler demands. Do not preserve obsolete shape for compatibility; update imports to the new types as tasks progress.

- [ ] **Step 4: Implement math, bounds, and camera modules**

Implement `math3d.ts` with exported vector helpers: `add3`, `subtract3`, `multiply3`, `scale3`, `dot3`, `cross3`, `length3`, `normalize3`, `rotateVectorXyz`, `composeTransforms`, `readTransformAttributes`, `lookAtMatrix`, `perspectiveMatrix`, `orthographicMatrix`, `multiply4`, `invert4`, `transformPoint4`, and `transformDirection4`.

Implement `bounds.ts` with `boxBounds`, `planeBounds`, `sphereBounds`, `transformBounds`, and `rayIntersectsBounds` using slab intersection.

Implement `camera.ts` with:

```ts
export const DEFAULT_CAMERA: TypeGpuCameraSettings = {
  projection: 'perspective',
  position: [9, 7, 13],
  target: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

export function readCameraState(root: TypeGpuNode): TypeGpuCameraState;
export function createViewProjectionMatrix(aspect: number, camera?: TypeGpuCameraSettings): Float32Array;
export function cameraRayFromViewport(input: {
  x: number;
  y: number;
  viewport: { width: number; height: number };
  camera: TypeGpuCameraSettings;
}): TypeGpuRay;
```

`readCameraState` should find the first active camera, prefer `active={true}` when several cameras exist, and read `orbitControls` separately as `controller`.

- [ ] **Step 5: Run camera and bounds tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-math.test.ts src/lib/typegpu-renderer/bounds.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/math3d.ts src/lib/typegpu-renderer/bounds.ts src/lib/typegpu-renderer/camera.ts src/lib/typegpu-renderer/camera-math.ts src/lib/typegpu-renderer/camera-math.test.ts src/lib/typegpu-renderer/bounds.test.ts
git commit -m "feat: rebuild typegpu camera and bounds math"
```

## Task 4: Geometry, Material, Texture, And Sampler Descriptors

**Files:**
- Create: `src/lib/typegpu-renderer/geometries.ts`
- Create: `src/lib/typegpu-renderer/material-descriptors.ts`
- Create: `src/lib/typegpu-renderer/resources.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Test: `src/lib/typegpu-renderer/resources.test.ts`
- Test: `src/lib/typegpu-renderer/typegpu-layouts.test.ts`

- [ ] **Step 1: Write failing resource descriptor tests**

Create `src/lib/typegpu-renderer/resources.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { addEventListener, createElement, createFragment, insert, setAttribute } from './core';
import {
  collectSceneResources,
  readInlineGeometry,
  readInlineMaterial,
  resolveGeometryReference,
  resolveMaterialReference
} from './resources';

describe('TypeGPU scene resources', () => {
  it('reads procedural and buffer geometries with stable keys and bounds', () => {
    const box = createElement('boxGeometry');
    const plane = createElement('planeGeometry');
    const buffer = createElement('bufferGeometry');
    const vertices = new Float32Array([0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0]);

    setAttribute(box, 'width', 2);
    setAttribute(box, 'height', 4);
    setAttribute(box, 'depth', 6);
    setAttribute(plane, 'width', 8);
    setAttribute(plane, 'height', 10);
    setAttribute(buffer, 'vertices', vertices);
    setAttribute(buffer, 'bounds', { min: [0, 0, 0], max: [1, 1, 0] });

    expect(readInlineGeometry(box)?.key).toBe('box:2:4:6');
    expect(readInlineGeometry(box)?.bounds).toEqual({ min: [-1, -2, -3], max: [1, 2, 3] });
    expect(readInlineGeometry(plane)?.key).toBe('plane:8:10:1:1');
    expect(readInlineGeometry(buffer)?.vertexData).toBe(vertices);
  });

  it('normalizes basic, phong, and standard materials', () => {
    const basic = createElement('basicMaterial');
    const phong = createElement('phongMaterial');
    const standard = createElement('standardMaterial');

    setAttribute(basic, 'color', [0.1, 0.2, 0.3, 0.4]);
    setAttribute(phong, 'map', '/textures/phong.png');
    setAttribute(phong, 'sampler', 'repeatLinear');
    setAttribute(standard, 'roughness', 0.7);
    setAttribute(standard, 'metalness', 0.2);

    expect(readInlineMaterial(basic)?.kind).toBe('basic');
    expect(readInlineMaterial(phong)?.textureKey).toBe('url:/textures/phong.png');
    expect(readInlineMaterial(phong)?.samplerKey).toBe('sampler:repeatLinear');
    expect(readInlineMaterial(standard)).toMatchObject({ kind: 'standard', roughness: 0.7, metalness: 0.2 });
  });

  it('collects reusable resources and resolves mesh references by id', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const resources = createElement('resources');
    const geometry = createElement('boxGeometry');
    const texture = createElement('texture');
    const sampler = createElement('sampler');
    const material = createElement('phongMaterial');

    setAttribute(geometry, 'id', 'cube');
    setAttribute(texture, 'id', 'checker');
    setAttribute(texture, 'src', '/textures/checker.svg');
    setAttribute(sampler, 'id', 'repeatLinear');
    setAttribute(sampler, 'addressModeU', 'repeat');
    setAttribute(sampler, 'addressModeV', 'repeat');
    setAttribute(material, 'id', 'crate');
    setAttribute(material, 'map', 'checker');
    setAttribute(material, 'sampler', 'repeatLinear');

    insert(resources, geometry, null);
    insert(resources, texture, null);
    insert(resources, sampler, null);
    insert(resources, material, null);
    insert(scene, resources, null);
    insert(root, scene, null);

    const collected = collectSceneResources(root);

    expect(resolveGeometryReference('cube', collected)?.key).toBe('box:1:1:1');
    expect(resolveMaterialReference('crate', collected)?.textureKey).toBe('texture:checker');
    expect(collected.liveResourceKeys.textures.has('texture:checker')).toBe(true);
    expect(collected.liveResourceKeys.samplers.has('sampler:repeatLinear')).toBe(true);
  });
});
```

- [ ] **Step 2: Run resource tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/resources.test.ts
```

Expected: FAIL because the resource modules do not exist.

- [ ] **Step 3: Extend renderer descriptor types**

Add these types to `types.ts`:

```ts
export type TypeGpuGeometryKind = 'box' | 'plane' | 'sphere' | 'buffer' | 'imported';
export type TypeGpuMaterialKind = 'basic' | 'phong' | 'standard';
export type TypeGpuPrimitiveTopology = 'triangle-list';

export interface TypeGpuGeometryData {
  key: string;
  kind: TypeGpuGeometryKind;
  vertexData: Float32Array;
  vertexCount: number;
  vertexFloats: number;
  bounds: TypeGpuBounds;
  topology: TypeGpuPrimitiveTopology;
  layoutKey: string;
}

export interface TypeGpuTextureSource {
  kind: 'url' | 'embedded' | 'data';
  key: string;
  src?: string;
  mimeType?: string;
  data?: Uint8Array | Uint8ClampedArray | Float32Array;
  width?: number;
  height?: number;
  format?: GPUTextureFormat;
}

export interface TypeGpuSamplerDescriptor {
  key: string;
  magFilter: GPUFilterMode;
  minFilter: GPUFilterMode;
  mipmapFilter: GPUMipmapFilterMode;
  addressModeU: GPUAddressMode;
  addressModeV: GPUAddressMode;
  addressModeW: GPUAddressMode;
}

export interface TypeGpuMaterialDescriptor {
  key: string;
  pipelineKey: string;
  bindGroupKey: string;
  kind: TypeGpuMaterialKind;
  color: RgbaTuple;
  opacity: number;
  roughness: number;
  metalness: number;
  textureKey: string;
  samplerKey: string;
  texture: TypeGpuTextureSource | null;
  sampler: TypeGpuSamplerDescriptor;
  transparent: boolean;
  depthWrite: boolean;
  depthTest: boolean;
  cullMode: GPUCullMode;
  blendMode: 'opaque' | 'alpha' | 'additive';
}
```

- [ ] **Step 4: Implement geometry and material resource readers**

Implement:

```ts
export function createBoxGeometryData(width: number, height: number, depth: number): TypeGpuGeometryData;
export function createPlaneGeometryData(width: number, height: number, widthSegments: number, heightSegments: number): TypeGpuGeometryData;
export function createSphereGeometryData(radius: number, widthSegments: number, heightSegments: number): TypeGpuGeometryData;
export function createBufferGeometryData(input: { key: string; vertices: Float32Array; bounds: TypeGpuBounds; topology?: TypeGpuPrimitiveTopology }): TypeGpuGeometryData | null;
```

For plane geometry, generate vertices in the XZ plane with normal `[0, 1, 0]` and UVs from `[0, 0]` to `[1, 1]`. For buffer geometry, require vertex floats to be a multiple of `8`.

Implement material normalization with:

```ts
export const DEFAULT_SAMPLER: TypeGpuSamplerDescriptor = {
  key: 'sampler:default',
  magFilter: 'linear',
  minFilter: 'linear',
  mipmapFilter: 'linear',
  addressModeU: 'repeat',
  addressModeV: 'repeat',
  addressModeW: 'repeat'
};

export function readInlineMaterial(node: TypeGpuNode, resources?: TypeGpuResourceCollection): TypeGpuMaterialDescriptor | null;
export function materialKeyFor(input: TypeGpuMaterialDescriptor): string;
export function textureKeyFor(value: unknown, resources?: TypeGpuResourceCollection): string;
export function samplerKeyFor(value: unknown, resources?: TypeGpuResourceCollection): string;
```

`basicMaterial` uses `pipelineKey` containing `material:basic`. `phongMaterial` uses `material:phong`. `standardMaterial` uses `material:standard`.

- [ ] **Step 5: Implement reusable resource collection**

Implement `resources.ts` with:

```ts
export interface TypeGpuResourceCollection {
  geometries: Map<string, TypeGpuGeometryData>;
  materials: Map<string, TypeGpuMaterialDescriptor>;
  textures: Map<string, TypeGpuTextureSource>;
  samplers: Map<string, TypeGpuSamplerDescriptor>;
  liveResourceKeys: TypeGpuLiveResourceKeys;
}

export function collectSceneResources(root: TypeGpuNode): TypeGpuResourceCollection;
export function readInlineGeometry(node: TypeGpuNode): TypeGpuGeometryData | null;
export function readInlineMaterial(node: TypeGpuNode, resources?: TypeGpuResourceCollection): TypeGpuMaterialDescriptor | null;
export function resolveGeometryReference(value: unknown, resources: TypeGpuResourceCollection): TypeGpuGeometryData | null;
export function resolveMaterialReference(value: unknown, resources: TypeGpuResourceCollection): TypeGpuMaterialDescriptor | null;
```

`collectSceneResources` walks all descendants and records nodes with an `id` and supported resource type. It should ignore unsupported nodes without throwing.

- [ ] **Step 6: Run resource tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/resources.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/geometries.ts src/lib/typegpu-renderer/material-descriptors.ts src/lib/typegpu-renderer/resources.ts src/lib/typegpu-renderer/resources.test.ts
git commit -m "feat: add typegpu geometry and material descriptors"
```

## Task 5: Scene Compiler And Draw Batch IR

**Files:**
- Create: `src/lib/typegpu-renderer/scene-compiler.ts`
- Replace: `src/lib/typegpu-renderer/scene-state.ts`
- Replace: `src/lib/typegpu-renderer/draw-batch-cache.ts`
- Create: `src/lib/typegpu-renderer/render-plan.ts`
- Modify: `src/lib/typegpu-renderer/instance-data.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Test: `src/lib/typegpu-renderer/scene-compiler.test.ts`
- Test: `src/lib/typegpu-renderer/draw-batch-cache.test.ts`

- [ ] **Step 1: Write failing scene compiler tests**

Create `src/lib/typegpu-renderer/scene-compiler.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createElement, createFragment, insert, setAttribute } from './core';
import { Dirty, hasDirty } from './dirty';
import { createSceneState, createTypeGpuSceneCache } from './scene-compiler';

describe('TypeGPU scene compiler', () => {
  it('compiles render settings, camera, lights, draw batches, interaction, and live keys', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const controls = createElement('orbitControls');
    const light = createElement('directionalLight');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('phongMaterial');

    setAttribute(scene, 'clearColor', [0.2, 0.3, 0.4, 1]);
    setAttribute(camera, 'id', 'main');
    setAttribute(camera, 'active', true);
    setAttribute(camera, 'position', [0, 0, 10]);
    setAttribute(camera, 'target', [0, 0, 0]);
    setAttribute(controls, 'camera', 'main');
    setAttribute(light, 'position', [3, 4, 5]);
    setAttribute(mesh, 'position', [1, 2, 3]);
    addEventListener(mesh, 'click', () => {});
    setAttribute(material, 'color', [1, 0.5, 0.25, 1]);

    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, camera, null);
    insert(scene, controls, null);
    insert(scene, light, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

    expect(state.renderSettings.clearColor).toEqual([0.2, 0.3, 0.4, 1]);
    expect(state.camera.projection).toBe('perspective');
    expect(state.cameraController?.kind).toBe('orbit');
    expect(state.lights).toHaveLength(1);
    expect(state.drawBatches).toHaveLength(1);
    expect(state.drawBatches[0]).toMatchObject({
      passKey: 'pass:main',
      geometryKey: 'box:1:1:1',
      materialKey: expect.stringContaining('phong')
    });
    expect(state.interaction.targets).toHaveLength(1);
    expect(state.liveResourceKeys.geometries.has('box:1:1:1')).toBe(true);
    expect(hasDirty(state.dirty, Dirty.DrawBatches)).toBe(true);
  });

  it('reuses clean draw batches, lights, and interaction indexes by dirty mask', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const cache = createTypeGpuSceneCache();

    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    const first = createSceneState(root, cache, { dirty: Dirty.All });
    const second = createSceneState(root, cache, { dirty: Dirty.RenderSettings });

    expect(second.drawBatches).toBe(first.drawBatches);
    expect(second.lights).toBe(first.lights);
    expect(second.interaction).toBe(first.interaction);
    expect(second.drawBatchesChanged).toBe(false);
    expect(second.lightsChanged).toBe(false);
    expect(second.interactionChanged).toBe(false);
  });
});
```

- [ ] **Step 2: Run scene compiler tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/scene-compiler.test.ts
```

Expected: FAIL because the scene compiler does not exist.

- [ ] **Step 3: Add scene IR types**

Add these types to `types.ts`:

```ts
export interface TypeGpuRenderSettings {
  clearColor: RgbaTuple;
  depth: boolean;
  alphaMode: GPUCanvasAlphaMode;
}

export interface TypeGpuMeshDrawItem {
  id: TypeGpuInstanceId;
  node: TypeGpuNode;
  revision: number;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
  bounds: TypeGpuBounds;
  color: RgbaTuple;
  phase: number;
  spinSpeed: number;
  renderOrder: number;
  hitTest: 'none' | 'bounds' | 'mesh';
  pointerEvents: 'auto' | 'none';
}

export interface TypeGpuInstanceDirtyRange {
  start: number;
  count: number;
}

export interface TypeGpuDrawBatch {
  key: string;
  passKey: string;
  pipelineKey: string;
  materialKey: string;
  bindGroupKey: string;
  geometryKey: string;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  floatsPerInstance: number;
  instances: Float32Array;
  instanceIds: TypeGpuInstanceId[];
  instanceCount: number;
  instancesChanged: boolean;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
  sortKey: number;
}

export interface TypeGpuLiveResourceKeys {
  geometries: Set<string>;
  materials: Set<string>;
  textures: Set<string>;
  samplers: Set<string>;
  pipelines: Set<string>;
}

export interface TypeGpuSceneState {
  dirty: Dirty;
  camera: TypeGpuCameraSettings;
  cameraNode: TypeGpuNode | null;
  cameraControllerNode: TypeGpuNode | null;
  cameraController: TypeGpuCameraController | null;
  renderSettings: TypeGpuRenderSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
  drawBatchesChanged: boolean;
  interaction: TypeGpuInteractionIndex;
  interactionChanged: boolean;
  liveResourceKeys: TypeGpuLiveResourceKeys;
}
```

- [ ] **Step 4: Implement draw batch packing**

In `instance-data.ts`, keep `MESH_INSTANCE_FLOATS = 20` unless shader work in Task 7 intentionally changes it. Export:

```ts
export function packMeshInstance(item: TypeGpuMeshDrawItem, target: Float32Array, offset: number): void;
```

Pack in this order:

1. position xyz + phase.
2. color rgba.
3. geometry shape xyz + spinSpeed.
4. spinOffset + rotation xyz.
5. roughness, metalness, opacity, material flags.

In `draw-batch-cache.ts`, implement:

```ts
export interface TypeGpuDrawBatchCache {
  read(items: TypeGpuMeshDrawItem[]): TypeGpuDrawBatch[];
}

export function createDrawBatchCache(): TypeGpuDrawBatchCache;
```

The batch key must be:

```ts
`${passKey}|${pipelineKey}|${materialKey}|${bindGroupKey}|${geometryKey}|order:${renderOrder}`
```

Reuse previous `instances` arrays when instance ids and revisions match, and emit dirty ranges when individual revisions change.

- [ ] **Step 5: Implement scene compiler**

Create `scene-compiler.ts` with:

```ts
export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  modelCache: TypeGpuModelCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
  cleanInteraction: TypeGpuInteractionIndex;
}

export interface TypeGpuSceneStateOptions {
  dirty?: Dirty;
}

export function createTypeGpuSceneCache(options: CreateTypeGpuSceneCacheOptions = {}): TypeGpuSceneCache;
export function createSceneState(root: TypeGpuNode, cache = createTypeGpuSceneCache(), options: TypeGpuSceneStateOptions = {}): TypeGpuSceneState;
```

`createSceneState` should:

1. Read scene settings.
2. Collect resources.
3. Read camera and controls.
4. Collect lights if `Dirty.Lights` is present.
5. Collect draw items and batches if `Dirty.DrawBatches`, `Dirty.Geometry`, `Dirty.Material`, or `Dirty.InstanceData` is present.
6. Build interaction if `Dirty.Interaction`, `Dirty.DrawBatches`, or `Dirty.Transform` is present.
7. Return changed flags based on whether each section was recomputed.

Replace `scene-state.ts` with:

```ts
export {
  createSceneState,
  createTypeGpuSceneCache,
  type TypeGpuSceneCache,
  type TypeGpuSceneStateOptions
} from './scene-compiler';
```

- [ ] **Step 6: Run scene compiler tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/scene-compiler.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/instance-data.ts src/lib/typegpu-renderer/draw-batch-cache.ts src/lib/typegpu-renderer/scene-compiler.ts src/lib/typegpu-renderer/scene-state.ts src/lib/typegpu-renderer/render-plan.ts src/lib/typegpu-renderer/scene-compiler.test.ts
git commit -m "feat: compile typegpu scene ir and draw batches"
```

## Task 6: Models And Instanced Meshes

**Files:**
- Modify: `src/lib/typegpu-renderer/scene-compiler.ts`
- Modify: `src/lib/typegpu-renderer/model-cache.ts`
- Modify: `src/lib/typegpu-renderer/glb-loader.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Test: `src/lib/typegpu-renderer/model-cache.test.ts`
- Test: `src/lib/typegpu-renderer/glb-loader.test.ts`
- Test: `src/lib/typegpu-renderer/scene-compiler.test.ts`

- [ ] **Step 1: Write failing instanced mesh scene tests**

Append to `scene-compiler.test.ts`:

```ts
it('compiles instancedMesh array data into one draw batch', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const resources = createElement('resources');
  const geometry = createElement('boxGeometry');
  const material = createElement('phongMaterial');
  const instanced = createElement('instancedMesh');
  const instances = [
    { id: 'a', position: [0, 0, 0] as const, color: [1, 0, 0, 1] as const },
    { id: 'b', position: [2, 0, 0] as const, color: [0, 1, 0, 1] as const }
  ];

  setAttribute(geometry, 'id', 'cube');
  setAttribute(material, 'id', 'mat');
  setAttribute(instanced, 'geometry', 'cube');
  setAttribute(instanced, 'material', 'mat');
  setAttribute(instanced, 'instances', instances);
  setAttribute(instanced, 'getKey', (item: (typeof instances)[number]) => item.id);
  setAttribute(instanced, 'getTransform', (item: (typeof instances)[number]) => ({ position: item.position }));
  setAttribute(instanced, 'getColor', (item: (typeof instances)[number]) => item.color);

  insert(resources, geometry, null);
  insert(resources, material, null);
  insert(scene, resources, null);
  insert(scene, instanced, null);
  insert(root, scene, null);

  const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

  expect(state.drawBatches).toHaveLength(1);
  expect(state.drawBatches[0].instanceCount).toBe(2);
  expect(state.drawBatches[0].instanceIds).toEqual(['a', 'b']);
});
```

- [ ] **Step 2: Write target model compiler test**

Append:

```ts
it('compiles ready model cache entries into imported draw batches', async () => {
  const root = createFragment();
  const scene = createElement('scene');
  const model = createElement('model');
  const cache = createTypeGpuSceneCache({
    modelCache: readyModelCache({
      key: 'url:/models/column.glb',
      meshes: [
        {
          geometry: {
            key: 'url:/models/column.glb:primitive:0',
            kind: 'imported',
            vertexData: new Float32Array([0, 0, 0, 0, 1, 0, 0, 0]),
            vertexCount: 1,
            vertexFloats: 8,
            bounds: { min: [0, 0, 0], max: [1, 1, 0] },
            topology: 'triangle-list',
            layoutKey: 'pnu8'
          },
          material: defaultPhongMaterial(),
          transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }
        }
      ]
    })
  });

  setAttribute(model, 'src', '/models/column.glb');
  setAttribute(model, 'position', [3, 4, 5]);
  insert(scene, model, null);
  insert(root, scene, null);

  createSceneState(root, cache, { dirty: Dirty.All });
  await Promise.resolve();
  const state = createSceneState(root, cache, { dirty: Dirty.All });

  expect(state.drawBatches[0].geometryKey).toBe('url:/models/column.glb:primitive:0');
  expect(state.drawBatches[0].instanceCount).toBe(1);
});
```

Use local helper functions in the test file:

```ts
function defaultPhongMaterial() {
  return readInlineMaterial(createElement('phongMaterial'))!;
}
```

Keep the existing generated GLB fixture tests, but update expected geometry descriptors to include `kind`, `bounds`, `topology`, and `layoutKey`.

- [ ] **Step 3: Run model and instanced tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/scene-compiler.test.ts src/lib/typegpu-renderer/glb-loader.test.ts src/lib/typegpu-renderer/model-cache.test.ts
```

Expected: FAIL because `instancedMesh` is not compiled and loaded model shapes still use older descriptors.

- [ ] **Step 4: Implement `instancedMesh` compilation**

In `scene-compiler.ts`, add an `instancedMesh` branch that:

1. Resolves `geometry` and `material` references.
2. Reads `instances` as an array.
3. Reads optional callbacks `getKey`, `getTransform`, `getColor`, `getSpinSpeed`.
4. Emits one `TypeGpuMeshDrawItem` per item using the callback results.
5. Uses `node.uid:index` if `getKey` is absent.
6. Uses `pointerEvents` and `hitTest` from the instanced mesh node for all generated targets.

- [ ] **Step 5: Update model shapes to target descriptors**

Update `TypeGpuLoadedModelMesh` to:

```ts
export interface TypeGpuLoadedModelMesh {
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
}
```

Update `glb-loader.ts` so imported geometry has:

- `kind: 'imported'`.
- `bounds` computed from positions before index expansion or from expanded vertices.
- `topology: 'triangle-list'`.
- `layoutKey: 'pnu8'`.

Update material conversion to use `createStandardMaterialDescriptor` from `material-descriptors.ts` rather than the old material shape.

- [ ] **Step 6: Run model and instanced tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/scene-compiler.test.ts src/lib/typegpu-renderer/glb-loader.test.ts src/lib/typegpu-renderer/model-cache.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/scene-compiler.ts src/lib/typegpu-renderer/model-cache.ts src/lib/typegpu-renderer/glb-loader.ts src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/scene-compiler.test.ts src/lib/typegpu-renderer/glb-loader.test.ts src/lib/typegpu-renderer/model-cache.test.ts
git commit -m "feat: compile models and instanced meshes"
```

## Task 7: GPU Renderer Resource Caches And Render Loop Modes

**Files:**
- Create: `src/lib/typegpu-renderer/resource-caches.ts`
- Replace: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Modify: `src/lib/typegpu-renderer/typegpu-pipeline.ts`
- Modify: `src/lib/typegpu-renderer/typegpu-layouts.ts`
- Modify: `src/lib/typegpu-renderer/render-constants.ts`
- Test: `src/lib/typegpu-renderer/gpu-renderer.test.ts`
- Test: `src/lib/typegpu-renderer/typegpu-pipeline.test.ts`

- [ ] **Step 1: Write failing renderer source tests**

Replace brittle old source tests in `gpu-renderer.test.ts` with target-boundary tests:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('TypeGPU GPU renderer architecture', () => {
  const rendererSource = readFileSync('src/lib/typegpu-renderer/gpu-renderer.ts', 'utf8');
  const cacheSource = readFileSync('src/lib/typegpu-renderer/resource-caches.ts', 'utf8');
  const pipelineSource = readFileSync('src/lib/typegpu-renderer/typegpu-pipeline.ts', 'utf8');

  it('owns explicit GPU resource caches', () => {
    expect(cacheSource).toContain('GeometryResourceCache');
    expect(cacheSource).toContain('InstanceBufferCache');
    expect(cacheSource).toContain('MaterialResourceCache');
    expect(cacheSource).toContain('TextureResourceCache');
    expect(cacheSource).toContain('SamplerResourceCache');
    expect(cacheSource).toContain('PipelineResourceCache');
    expect(rendererSource).toContain('#geometryResources');
    expect(rendererSource).toContain('#instanceBuffers');
    expect(rendererSource).toContain('#materialResources');
    expect(rendererSource).toContain('#textureResources');
    expect(rendererSource).toContain('#samplerResources');
    expect(rendererSource).toContain('#pipelines');
  });

  it('prunes GPU resources from scene live keys', () => {
    expect(rendererSource).toContain('scene.liveResourceKeys.geometries');
    expect(rendererSource).toContain('scene.liveResourceKeys.materials');
    expect(rendererSource).toContain('scene.liveResourceKeys.textures');
    expect(rendererSource).toContain('scene.liveResourceKeys.samplers');
    expect(rendererSource).toContain('scene.liveResourceKeys.pipelines');
  });

  it('looks up pipelines by draw batch pipeline key', () => {
    expect(rendererSource).toContain('batch.pipelineKey');
    expect(pipelineSource).toContain('createMeshPipeline');
  });

  it('implements always, demand, and manual frame loops truthfully', () => {
    expect(rendererSource).toContain("frameloop: 'always'");
    expect(rendererSource).toContain("frameloop: 'demand'");
    expect(rendererSource).toContain("frameloop: 'manual'");
    expect(rendererSource).toContain('invalidate(): void');
    expect(rendererSource).toContain('renderFrame(timestamp?: number): void');
  });
});
```

- [ ] **Step 2: Run renderer tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: FAIL because `resource-caches.ts` and frame-loop APIs do not exist.

- [ ] **Step 3: Implement cache classes**

Create `resource-caches.ts` with classes:

```ts
export class GeometryResourceCache {
  getOrCreate(batch: TypeGpuDrawBatch): TypeGpuVertexBufferResource;
  prune(liveKeys: Set<string>): void;
  dispose(): void;
}

export class InstanceBufferCache {
  getOrCreate(batch: TypeGpuDrawBatch): TypeGpuInstanceBufferResource;
  upload(batch: TypeGpuDrawBatch, dirtyRanges: TypeGpuInstanceDirtyRange[]): void;
  prune(liveBatchKeys: Set<string>): void;
  dispose(): void;
}

export class TextureResourceCache {
  getOrLoad(source: TypeGpuTextureSource | null): TypeGpuTextureResource;
  prune(liveKeys: Set<string>): void;
  dispose(): void;
}

export class SamplerResourceCache {
  getOrCreate(descriptor: TypeGpuSamplerDescriptor): TgpuFixedSampler;
  prune(liveKeys: Set<string>): void;
}

export class MaterialResourceCache {
  getOrCreate(material: TypeGpuMaterialDescriptor): TypeGpuMaterialResource;
  prune(liveKeys: Set<string>): void;
  dispose(): void;
}

export class PipelineResourceCache {
  getOrCreate(batch: TypeGpuDrawBatch): TypeGpuMeshPipeline;
  prune(liveKeys: Set<string>): void;
}
```

Construct these classes with the TypeGPU root and layout objects they need. Keep WebGPU raw resource creation limited to command encoding and canvas/depth texture handling; material resources should use TypeGPU APIs.

- [ ] **Step 4: Rebuild `gpu-renderer.ts` around caches**

Implement the public renderer interface:

```ts
export interface TypeGpuRenderer {
  setScene(scene: TypeGpuSceneState): void;
  setCamera(camera: TypeGpuCameraSettings): void;
  invalidate(): void;
  renderFrame(timestamp?: number): void;
  getRenderSize(): { width: number; height: number };
  dispose(): void;
}

export interface TypeGpuRendererOptions {
  canvas: HTMLCanvasElement;
  onFps?: (fps: number) => void;
  frameloop?: 'always' | 'demand' | 'manual';
  maxDevicePixelRatio?: number;
  clearColor?: RgbaTuple;
  depth?: boolean;
  alphaMode?: GPUCanvasAlphaMode;
}
```

Behavior:

- `always`: schedule requestAnimationFrame continuously.
- `demand`: schedule one frame when `setScene`, `setCamera`, texture settlement, model settlement, resize, or `invalidate()` happens.
- `manual`: never request animation frames; `renderFrame()` draws one frame.
- `setScene` updates render settings, lighting buffer if changed, resource caches, and instance buffers.
- `renderFrame` resizes, writes uniforms, begins the main pass with `scene.renderSettings.clearColor`, draws sorted batches, and submits commands.

- [ ] **Step 5: Run renderer tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/gpu-renderer.test.ts src/lib/typegpu-renderer/typegpu-pipeline.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/resource-caches.ts src/lib/typegpu-renderer/gpu-renderer.ts src/lib/typegpu-renderer/typegpu-pipeline.ts src/lib/typegpu-renderer/typegpu-layouts.ts src/lib/typegpu-renderer/render-constants.ts src/lib/typegpu-renderer/gpu-renderer.test.ts src/lib/typegpu-renderer/typegpu-pipeline.test.ts
git commit -m "feat: rebuild typegpu gpu resource backend"
```

## Task 8: Texture And Sampler Loading, Pruning, And Generation Tokens

**Files:**
- Modify: `src/lib/typegpu-renderer/resource-caches.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Modify: `src/lib/typegpu-renderer/material-descriptors.ts`
- Test: `src/lib/typegpu-renderer/materials.test.ts`
- Test: `src/lib/typegpu-renderer/gpu-renderer.test.ts`

- [ ] **Step 1: Write failing texture generation tests**

Add to `gpu-renderer.test.ts`:

```ts
it('uses generation tokens for async texture loading', () => {
  const cacheSource = readFileSync('src/lib/typegpu-renderer/resource-caches.ts', 'utf8');

  expect(cacheSource).toMatch(/generation\s*\+=\s*1/);
  expect(cacheSource).toContain('resource.generation !== generation');
  expect(cacheSource).toContain('image.close()');
});

it('prunes texture and sampler resources separately from material resources', () => {
  const cacheSource = readFileSync('src/lib/typegpu-renderer/resource-caches.ts', 'utf8');

  expect(cacheSource).toContain('TextureResourceCache');
  expect(cacheSource).toContain('SamplerResourceCache');
  expect(cacheSource).toMatch(/prune\(liveKeys: Set<string>\)/);
});
```

Add to `materials.test.ts`:

```ts
it('keeps texture, sampler, material, bind group, and pipeline keys separate', () => {
  const material = createMaterialDescriptor('phong', {
    color: [1, 1, 1, 1],
    map: '/textures/a.png',
    sampler: 'repeatLinear',
    transparent: true
  });

  expect(material.textureKey).toBe('url:/textures/a.png');
  expect(material.samplerKey).toBe('sampler:repeatLinear');
  expect(material.key).toContain('material:phong');
  expect(material.bindGroupKey).toContain('url:/textures/a.png');
  expect(material.pipelineKey).toContain('blend:alpha');
});
```

- [ ] **Step 2: Run texture tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/materials.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: FAIL until cache source includes generation token logic and material key helper exists.

- [ ] **Step 3: Implement generation token resource loading**

In `TextureResourceCache`, each resource should have:

```ts
interface TextureResource {
  key: string;
  status: 'loading' | 'ready' | 'failed' | 'fallback';
  texture: TypeGpuMaterialTexture;
  width: number;
  height: number;
  generation: number;
}
```

When loading:

```ts
const generation = (resource.generation += 1);
const image = await loadMaterialTextureImageSource(source);

if (this.disposed || resource.generation !== generation) {
  image.close();
  return;
}
```

On stale load, close decoded image and destroy any created texture. On failed load, keep fallback texture for that resource key and do not fail the material or scene.

- [ ] **Step 4: Run texture tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/materials.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/typegpu-renderer/resource-caches.ts src/lib/typegpu-renderer/gpu-renderer.ts src/lib/typegpu-renderer/material-descriptors.ts src/lib/typegpu-renderer/materials.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
git commit -m "feat: manage typegpu texture and sampler resources"
```

## Task 9: Interaction Index And Canvas Event Dispatch

**Files:**
- Create: `src/lib/typegpu-renderer/interaction-index.ts`
- Modify: `src/lib/typegpu-renderer/scene-compiler.ts`
- Modify: `src/lib/typegpu-renderer/svelte-renderer.ts`
- Modify: `src/lib/typegpu-renderer/camera.ts`
- Test: `src/lib/typegpu-renderer/interaction-index.test.ts`
- Test: `src/lib/typegpu-renderer/svelte-renderer.test.ts`

- [ ] **Step 1: Write failing interaction index tests**

Create `src/lib/typegpu-renderer/interaction-index.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { createElement } from './core';
import { createInteractionIndex } from './interaction-index';

describe('TypeGPU interaction index', () => {
  it('picks the nearest bounds hit instead of the first target', () => {
    const far = createElement('mesh');
    const near = createElement('mesh');
    const index = createInteractionIndex([
      {
        node: far,
        instanceId: 'far',
        bounds: { min: [-1, -1, -6], max: [1, 1, -4] },
        hitTest: 'bounds',
        handlers: new Set(['click'])
      },
      {
        node: near,
        instanceId: 'near',
        bounds: { min: [-1, -1, -3], max: [1, 1, -2] },
        hitTest: 'bounds',
        handlers: new Set(['click'])
      }
    ]);

    const hit = index.pick({
      x: 50,
      y: 50,
      viewport: { width: 100, height: 100 },
      camera: {
        projection: 'perspective',
        position: [0, 0, 0],
        target: [0, 0, -1],
        fov: 45,
        near: 0.1,
        far: 100
      }
    });

    expect(hit?.node).toBe(near);
    expect(hit?.instanceId).toBe('near');
  });

  it('excludes pointerEvents none and hitTest none targets during creation', () => {
    const interactive = createElement('mesh');
    const ignored = createElement('mesh');
    const index = createInteractionIndex([
      {
        node: ignored,
        instanceId: 'ignored',
        bounds: { min: [-1, -1, -1], max: [1, 1, 1] },
        hitTest: 'none',
        handlers: new Set(['click'])
      },
      {
        node: interactive,
        instanceId: 'interactive',
        bounds: { min: [-1, -1, -2], max: [1, 1, -1] },
        hitTest: 'bounds',
        handlers: new Set(['click'])
      }
    ]);

    expect(index.targets.map((target) => target.instanceId)).toEqual(['interactive']);
  });
});
```

- [ ] **Step 2: Write failing canvas event dispatch test**

In `svelte-renderer.test.ts`, replace first-interactive click expectations with:

```ts
it('routes canvas clicks to the nearest picked mesh', async () => {
  const root = createFragment();
  const scene = createElement('scene');
  const camera = createElement('perspectiveCamera');
  const far = createElement('mesh');
  const near = createElement('mesh');
  const farGeometry = createElement('boxGeometry');
  const nearGeometry = createElement('boxGeometry');
  const onFarClick = vi.fn();
  const onNearClick = vi.fn();
  const canvas = new FakeCanvas();
  const runtime = createTypeGpuRuntimeForTest(root, canvas as unknown as HTMLCanvasElement, fakeRenderer());

  canvas.clientWidth = 100;
  canvas.clientHeight = 100;
  setAttribute(camera, 'position', [0, 0, 10]);
  setAttribute(camera, 'target', [0, 0, 0]);
  setAttribute(far, 'position', [0, 0, 0]);
  setAttribute(near, 'position', [0, 0, 5]);
  addEventListener(far, 'click', onFarClick);
  addEventListener(near, 'click', onNearClick);
  insert(far, farGeometry, null);
  insert(near, nearGeometry, null);
  insert(scene, camera, null);
  insert(scene, far, null);
  insert(scene, near, null);
  insert(root, scene, null);

  runtime.scheduleSync(root, scene, Dirty.All);
  await Promise.resolve();
  canvas.dispatch<MouseEvent>('click', { offsetX: 50, offsetY: 50 } as Partial<MouseEvent>);

  expect(onFarClick).not.toHaveBeenCalled();
  expect(onNearClick).toHaveBeenCalledOnce();
});
```

- [ ] **Step 3: Run interaction tests to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/interaction-index.test.ts src/lib/typegpu-renderer/svelte-renderer.test.ts
```

Expected: FAIL because interaction index is not implemented and canvas clicks still use old routing.

- [ ] **Step 4: Implement interaction index**

Create `interaction-index.ts`:

```ts
export interface TypeGpuInteractionTarget {
  node: TypeGpuNode;
  instanceId: TypeGpuInstanceId;
  bounds: TypeGpuBounds;
  hitTest: 'none' | 'bounds' | 'mesh';
  handlers: Set<string>;
}

export interface TypeGpuInteractionHit {
  node: TypeGpuNode;
  instanceId: TypeGpuInstanceId;
  distance: number;
  point: Vector3Tuple;
}

export interface TypeGpuInteractionIndex {
  targets: TypeGpuInteractionTarget[];
  pick(input: {
    x: number;
    y: number;
    viewport: { width: number; height: number };
    camera: TypeGpuCameraSettings;
  }): TypeGpuInteractionHit | null;
}

export function createInteractionIndex(targets: TypeGpuInteractionTarget[]): TypeGpuInteractionIndex;
```

Filter out `hitTest: 'none'`, sort hits by distance, and treat `hitTest: 'mesh'` as bounds for this branch.

- [ ] **Step 5: Wire canvas click and hover events**

In `svelte-renderer.ts`:

- Keep `currentScene: TypeGpuSceneState | null`.
- Update it after each successful scene sync.
- On click, call `currentScene.interaction.pick`.
- Dispatch `click` to `hit.node` with `originalEvent`, `instanceId`, and `point`.
- On pointer move, compute the current hit and dispatch `pointerenter`/`pointerleave` when the target changes.
- Keep camera drag click suppression before picking.

- [ ] **Step 6: Run interaction tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/interaction-index.test.ts src/lib/typegpu-renderer/svelte-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/interaction-index.ts src/lib/typegpu-renderer/scene-compiler.ts src/lib/typegpu-renderer/svelte-renderer.ts src/lib/typegpu-renderer/camera.ts src/lib/typegpu-renderer/interaction-index.test.ts src/lib/typegpu-renderer/svelte-renderer.test.ts
git commit -m "feat: add bounds-based typegpu picking"
```

## Task 10: Public Demo Rebuild And Component Renderer Coverage

**Files:**
- Replace: `src/Scene.typegpu.svelte`
- Modify: `src/TypeGpuCanvas.svelte`
- Modify or delete: `src/Box.typegpu.svelte`
- Modify or delete: `src/Sphere.typegpu.svelte`
- Modify: `src/lib/cube-field.ts`
- Modify: `src/App.test.ts`
- Replace: `src/lib/typegpu-renderer/component-renderer.test.ts`

- [ ] **Step 1: Write failing component renderer tests for target primitives**

Replace `component-renderer.test.ts` with:

```ts
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import * as svelteClient from 'svelte/internal/client';
import { describe, expect, it, vi } from 'vitest';
import { createFragment, type TypeGpuNode } from './core';
import renderer from './svelte-renderer';

describe('TypeGPU target primitive component rendering', () => {
  it('renders guide-level scene primitives into normalized host nodes', () => {
    const Scene = compileTypeGpuSource(`
      <scene clearColor={[0, 0, 0, 1]}>
        <perspectiveCamera id="main" active position={[0, 0, 10]} target={[0, 0, 0]} />
        <orbitControls camera="main" />
        <ambientLight intensity={0.2} />
        <directionalLight position={[1, 2, 3]} />
        <resources>
          <boxGeometry id="cube" />
          <texture id="checker" src="/textures/checker.svg" />
          <sampler id="repeatLinear" addressModeU="repeat" addressModeV="repeat" />
          <phongMaterial id="crate" map="checker" sampler="repeatLinear" />
        </resources>
        <mesh geometry="cube" material="crate" position={[1, 2, 3]} onclick={() => {}} />
        <instancedMesh
          geometry="cube"
          material="crate"
          instances={[{ id: 'a' }]}
          getKey={(item) => item.id}
        />
      </scene>
    `);
    const root = createFragment();

    renderer.render(Scene, { target: root });

    const scene = onlyElement(root);
    expect(scene.name).toBe('scene');
    expect(findChild(scene, 'perspectiveCamera')).toBeTruthy();
    expect(findChild(scene, 'orbitControls')).toBeTruthy();
    expect(findChild(scene, 'resources')).toBeTruthy();
    expect(findChild(scene, 'mesh')).toBeTruthy();
    expect(findChild(scene, 'instancedMesh')).toBeTruthy();
  });
});

function onlyElement(root: TypeGpuNode): TypeGpuNode {
  const elements = root.children.filter((node) => node.kind === 'element');
  expect(elements).toHaveLength(1);
  return elements[0];
}

function findChild(root: TypeGpuNode, name: string): TypeGpuNode | null {
  if (root.name === name) return root;
  for (const child of root.children) {
    const match = findChild(child, name);
    if (match) return match;
  }
  return null;
}

function compileTypeGpuSource(source: string) {
  const result = compile(source, {
    filename: 'Inline.typegpu.svelte',
    generate: 'client',
    runes: true,
    experimental: {
      customRenderer: '/src/lib/typegpu-renderer/svelte-renderer.ts'
    }
  });
  const componentName = result.js.code.match(/export default function ([^(]+)/)?.[1];
  if (!componentName) throw new Error('Unable to find compiled component name');

  const executableCode = result.js.code
    .replace("import $renderer from '/src/lib/typegpu-renderer/svelte-renderer.ts';", '')
    .replace("import 'svelte/internal/disclose-version';", '')
    .replace("import * as $ from 'svelte/internal/client';", '')
    .replace(`export default function ${componentName}`, `function ${componentName}`);

  return new Function('$', '$renderer', `${executableCode}\nreturn ${componentName};`)(
    svelteClient,
    renderer
  ) as Parameters<typeof renderer.render>[0];
}
```

- [ ] **Step 2: Run component renderer test to verify RED**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts
```

Expected: FAIL until host node normalization and target primitive support are complete.

- [ ] **Step 3: Rebuild `Scene.typegpu.svelte` around target primitives**

Replace the scene with direct usage of:

- `perspectiveCamera`.
- `orbitControls`.
- `resources` with reusable geometries, texture, sampler, and materials.
- `mesh` for a small set of individually clickable feature objects.
- `instancedMesh` for the cube field.
- `model` for `/models/column.glb` if that asset exists; otherwise use an existing generated fixture or add a small GLB asset under `public/models/column.glb`.

The demo should avoid wrapper components unless they are still valuable examples. Keep `Box.typegpu.svelte` and `Sphere.typegpu.svelte` only if they are tiny wrappers over target primitives and their tests prove that.

- [ ] **Step 4: Update TypeGPU root usage**

In `TypeGpuCanvas.svelte`, call:

```ts
createTypeGpuRoot({
  target: host,
  onFps,
  frameloop: 'always',
  maxDevicePixelRatio: 1.5,
  clearColor: [0.067, 0.078, 0.102, 1],
  depth: true,
  alphaMode: 'premultiplied'
})
```

The returned root should still support `dispose()`.

- [ ] **Step 5: Run component and app tests to verify GREEN**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/component-renderer.test.ts src/App.test.ts src/Scene.typegpu.test.ts
```

Expected: PASS after rewriting tests that asserted old wrapper internals.

- [ ] **Step 6: Commit**

```bash
git add src/Scene.typegpu.svelte src/TypeGpuCanvas.svelte src/Box.typegpu.svelte src/Sphere.typegpu.svelte src/lib/cube-field.ts src/App.test.ts src/Scene.typegpu.test.ts src/lib/typegpu-renderer/component-renderer.test.ts
git commit -m "feat: rebuild typegpu demo on target primitives"
```

## Task 11: Remove Obsolete Renderer Code And Verify

**Files:**
- Delete or simplify: `src/lib/typegpu-renderer/component-helpers/*.ts` files that are no longer imported.
- Delete or simplify: obsolete tests under `src/lib/typegpu-renderer/*.test.ts` that assert old internals.
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-05-23-typegpu-primitives-completion-design.md` only if implementation discovers a corrected final behavior.

- [ ] **Step 1: Remove dead imports and files**

Run:

```bash
rg "component-helpers/" src/lib/typegpu-renderer
rg "draw-batch invalidation helper|light invalidation helper|first interactive mesh helper" src
```

Expected before cleanup: any remaining references are obsolete.

Delete obsolete modules only after their replacements are imported everywhere. Do not delete `glb-loader.ts`, `model-cache.ts`, TypeGPU layout files, or generated geometry files that are still used.

- [ ] **Step 2: Update README**

Replace the README title and description with:

```md
# Svelte TypeGPU Renderer

Experimental Svelte custom renderer backed by TypeGPU/WebGPU.

The public renderer API is scene-oriented: Svelte authors declarative primitives such as `scene`, `group`, `mesh`, `boxGeometry`, `phongMaterial`, `texture`, `sampler`, `perspectiveCamera`, `orbitControls`, and lights. The renderer compiles that host tree into scene IR, batches compatible draws, manages TypeGPU resources, and submits WebGPU work.
```

Keep the setup commands.

- [ ] **Step 3: Run full automated verification**

Run:

```bash
npm run test
npm run build
```

Expected: both commands exit 0.

- [ ] **Step 4: Run manual browser verification**

Start the dev server:

```bash
npm run dev -- --port 5173
```

Open `http://127.0.0.1:5173` in the in-app browser. Verify:

- Procedural meshes render.
- At least one GLB model renders.
- Orbit controls move the camera without Svelte per-frame scene mutations.
- Clicking a visible object selects the object under the cursor.
- Changing controls does not produce console errors.
- Text and controls in the app shell remain readable.

Stop the dev server after verification.

- [ ] **Step 5: Inspect final diff**

Run:

```bash
git status --short
git diff --stat
rg "T[O]DO|TB[D]|implement[[:space:]]later|first interactive mesh helper|draw-batch invalidation helper|light invalidation helper" src docs README.md
```

Expected:

- `git status --short` shows only intended source, test, README, and docs changes.
- `git diff --stat` matches the rebuild scope.
- The `rg` command returns no obsolete implementation markers.

- [ ] **Step 6: Commit cleanup**

```bash
git add src README.md docs/superpowers/specs/2026-05-23-typegpu-primitives-completion-design.md
git commit -m "chore: clean up rebuilt typegpu renderer"
```

## Plan Self-Review

Spec coverage:

- Dirty bitmask and primitive descriptors are covered by Tasks 1 and 2.
- Scene IR, live resource keys, and changed flags are covered by Task 5.
- Geometry, material, texture, sampler, and resource references are covered by Tasks 4 and 8.
- Pipeline cache, render settings, resource pruning, and frame-loop modes are covered by Task 7.
- Interaction index and bounds picking are covered by Task 9.
- Instanced mesh and GLB model integration are covered by Task 6.
- Orthographic camera and direct camera props are covered by Task 3.
- Demo rebuild and manual verification are covered by Tasks 10 and 11.

Placeholder scan:

- The plan contains no deferred implementation markers.
- Commands include expected pass/fail outcomes.
- Every task has a RED/GREEN cycle and a commit step.

Type consistency:

- Dirty masks use `Dirty`.
- Camera state uses `projection: 'perspective' | 'orthographic'`.
- Geometry descriptors use `TypeGpuGeometryData`.
- Material descriptors use `TypeGpuMaterialDescriptor`.
- Scene state uses `TypeGpuSceneState`.
- Interaction uses `TypeGpuInteractionIndex`.
