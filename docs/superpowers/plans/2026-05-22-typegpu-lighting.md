# TypeGPU Lighting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add broad, transformable Svelte light nodes backed by TypeGPU lighting buffers and shader evaluation.

**Architecture:** Light nodes are ordinary custom-renderer scene nodes. The CPU scene reader resolves their transforms into normalized `TypeGpuLight` records, runtime dirtiness tracks light updates separately from mesh batches, and the GPU renderer uploads a fixed TypeGPU lighting uniform consumed by the mesh fragment shader.

**Tech Stack:** Svelte custom renderer, TypeScript, Vitest, TypeGPU 0.11.x, WebGPU render pass submission through the existing renderer pattern.

---

## File Structure

- `src/lib/typegpu-renderer/types.ts`
  - Add public internal light types, `MAX_TYPEGPU_LIGHTS`, and scene-state lighting fields.
- `src/lib/typegpu-renderer/attributes.ts`
  - Add RGB tuple and clamp helpers for light prop parsing.
- `src/lib/typegpu-renderer/vector-math.ts`
  - New focused CPU vector helpers for light direction math.
- `src/lib/typegpu-renderer/component-helpers/lights.ts`
  - New scene-reader module for supported light nodes, transform inheritance, defaults, clamping, revision calculation, and subtree queries.
- `src/lib/typegpu-renderer/scene-dirtiness.ts`
  - New runtime invalidation module for draw-batch dirtiness and lighting dirtiness.
- `src/lib/typegpu-renderer/scene-state.ts`
  - Include `lights` and `lightsChanged`, with cache reuse for light-only and scene-only updates.
- `src/lib/typegpu-renderer/typegpu-layouts.ts`
  - Add TypeGPU lighting schemas and `lightingBindGroupLayout.$idx(1)`.
- `src/lib/typegpu-renderer/lighting-data.ts`
  - New packer that writes `TypeGpuLight[]` into the TypeGPU lighting buffer `ArrayBuffer`.
- `src/lib/typegpu-renderer/gpu-renderer.ts`
  - Own and update the lighting buffer and bind group. Bind group 1 is set before drawing.
- `src/lib/typegpu-renderer/typegpu-pipeline.ts`
  - Replace the hard-coded light with TypeGPU shader functions reading `lightingBindGroupLayout`.
- `src/Scene.typegpu.svelte`
  - Add authored ambient, hemisphere, directional, grouped point, and spot lights.
- Tests:
  - `src/lib/typegpu-renderer/core.test.ts`
  - `src/lib/typegpu-renderer/typegpu-layouts.test.ts`
  - `src/lib/typegpu-renderer/lighting-data.test.ts`
  - `src/lib/typegpu-renderer/gpu-renderer.test.ts`
  - `src/lib/typegpu-renderer/typegpu-pipeline.test.ts`
  - `src/Scene.typegpu.test.ts`

Do not touch the unrelated untracked `docs/superpowers/plans/2026-05-22-typegpu-material-textures.md` file while executing this plan.

---

### Task 1: Light Scene Reader

**Files:**
- Modify: `src/lib/typegpu-renderer/types.ts`
- Modify: `src/lib/typegpu-renderer/attributes.ts`
- Create: `src/lib/typegpu-renderer/vector-math.ts`
- Create: `src/lib/typegpu-renderer/component-helpers/lights.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing tests for light collection**

Append these tests to `src/lib/typegpu-renderer/core.test.ts` inside the existing `describe('TypeGPU renderer core', () => { ... })` block:

```ts
  it('reads supported light nodes into normalized light records', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const ambient = createElement('ambientLight');
    const hemi = createElement('hemisphereLight');
    const directional = createElement('directionalLight');
    const point = createElement('pointLight');
    const spot = createElement('spotLight');

    setAttribute(ambient, 'color', [0.2, 0.3, 0.4]);
    setAttribute(ambient, 'intensity', 0.15);
    setAttribute(hemi, 'skyColor', [0.5, 0.6, 0.7]);
    setAttribute(hemi, 'groundColor', [0.1, 0.08, 0.04]);
    setAttribute(hemi, 'intensity', 0.5);
    setAttribute(directional, 'lookAt', [0, 0, 0]);
    setAttribute(directional, 'position', [0, 3, 4]);
    setAttribute(directional, 'intensity', 2);
    setAttribute(point, 'position', [2, 3, 1]);
    setAttribute(point, 'range', 12);
    setAttribute(point, 'decay', 2);
    setAttribute(spot, 'position', [0, 5, 4]);
    setAttribute(spot, 'lookAt', [0, 0, 0]);
    setAttribute(spot, 'angle', 0.45);
    setAttribute(spot, 'penumbra', 0.35);

    insert(scene, ambient, null);
    insert(scene, hemi, null);
    insert(scene, directional, null);
    insert(scene, point, null);
    insert(scene, spot, null);
    insert(root, scene, null);

    const lights = collectLights(root);

    expect(lights.map((light) => light.kind)).toEqual([
      'ambient',
      'hemisphere',
      'directional',
      'point',
      'spot'
    ]);
    expect(lights[0]).toMatchObject({
      color: [0.2, 0.3, 0.4],
      intensity: 0.15,
      castsShadow: false,
      shadowIndex: -1
    });
    expect(lights[1]).toMatchObject({
      color: [0.5, 0.6, 0.7],
      groundColor: [0.1, 0.08, 0.04],
      intensity: 0.5
    });
    expect(lights[2].direction[0]).toBeCloseTo(0);
    expect(lights[2].direction[1]).toBeCloseTo(-0.6);
    expect(lights[2].direction[2]).toBeCloseTo(-0.8);
    expect(lights[3]).toMatchObject({
      position: [2, 3, 1],
      range: 12,
      decay: 2
    });
    expect(lights[4]).toMatchObject({
      angle: 0.45,
      penumbra: 0.35
    });
  });

  it('applies group transforms to descendant point and spot lights', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const point = createElement('pointLight');
    const spot = createElement('spotLight');

    setAttribute(group, 'position', [10, 0, 0]);
    setAttribute(group, 'scale', [2, 3, 4]);
    setAttribute(point, 'position', [1, 2, 3]);
    setAttribute(spot, 'position', [2, 0, 0]);
    setAttribute(spot, 'lookAt', [10, 0, 0]);

    insert(group, point, null);
    insert(group, spot, null);
    insert(scene, group, null);
    insert(root, scene, null);

    const [pointLight, spotLight] = collectLights(root);

    expect(pointLight.position[0]).toBeCloseTo(12);
    expect(pointLight.position[1]).toBeCloseTo(6);
    expect(pointLight.position[2]).toBeCloseTo(12);
    expect(spotLight.position).toEqual([14, 0, 0]);
    expect(spotLight.direction).toEqual([-1, 0, 0]);
  });

  it('clamps malformed light props and limits the scene to MAX_TYPEGPU_LIGHTS', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const point = createElement('pointLight');

    setAttribute(point, 'intensity', -3);
    setAttribute(point, 'range', -5);
    setAttribute(point, 'angle', Math.PI);
    setAttribute(point, 'penumbra', 2);
    insert(scene, point, null);

    for (let index = 0; index < MAX_TYPEGPU_LIGHTS + 4; index += 1) {
      insert(scene, createElement('ambientLight'), null);
    }

    insert(root, scene, null);

    const lights = collectLights(root);

    expect(lights).toHaveLength(MAX_TYPEGPU_LIGHTS);
    expect(lights[0]).toMatchObject({
      intensity: 0,
      range: 0,
      penumbra: 1
    });
    expect(lights[0].angle).toBeLessThan(Math.PI / 2);
  });
```

Add these imports to the top of `core.test.ts`:

```ts
import { collectLights } from './component-helpers/lights';
import { MAX_TYPEGPU_LIGHTS } from './types';
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: fails because `./component-helpers/lights` does not exist.

- [ ] **Step 3: Add light types**

Modify `src/lib/typegpu-renderer/types.ts`:

```ts
export const MAX_TYPEGPU_LIGHTS = 32;

export type TypeGpuLightKind = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot';

export interface TypeGpuLight {
  id: number;
  revision: number;
  kind: TypeGpuLightKind;
  color: Vector3Tuple;
  intensity: number;
  position: Vector3Tuple;
  direction: Vector3Tuple;
  range: number;
  decay: number;
  angle: number;
  penumbra: number;
  groundColor: Vector3Tuple;
  castsShadow: boolean;
  shadowIndex: number;
}
```

Keep the existing exports in the file.

- [ ] **Step 4: Add attribute helpers**

Modify `src/lib/typegpu-renderer/attributes.ts`:

```ts
export function rgbTuple(value: unknown, fallback: Vector3Tuple = [1, 1, 1]): Vector3Tuple {
  if (Array.isArray(value)) {
    return [
      numberArg(value[0], fallback[0]),
      numberArg(value[1], fallback[1]),
      numberArg(value[2], fallback[2])
    ];
  }

  return fallback;
}

export function nonNegativeNumberArg(value: unknown, fallback: number): number {
  return Math.max(0, numberArg(value, fallback));
}

export function clampedNumberArg(
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number {
  return Math.min(max, Math.max(min, numberArg(value, fallback)));
}
```

Place these functions after `colorTuple(...)` and before `scaleTuple(...)`.

- [ ] **Step 5: Add vector math helpers**

Create `src/lib/typegpu-renderer/vector-math.ts`:

```ts
import type { Vector3Tuple } from './types';

export const DEFAULT_LIGHT_DIRECTION: Vector3Tuple = [0, 0, -1];

export function normalizeVector(vector: Vector3Tuple, fallback: Vector3Tuple): Vector3Tuple {
  const length = Math.hypot(vector[0], vector[1], vector[2]);

  if (length <= 1e-6) {
    return [...fallback];
  }

  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

export function subtractVectors(left: Vector3Tuple, right: Vector3Tuple): Vector3Tuple {
  return [left[0] - right[0], left[1] - right[1], left[2] - right[2]];
}

export function rotateVectorXyz(vector: Vector3Tuple, rotation: Vector3Tuple): Vector3Tuple {
  const [sinX, cosX] = [Math.sin(rotation[0]), Math.cos(rotation[0])];
  const [sinY, cosY] = [Math.sin(rotation[1]), Math.cos(rotation[1])];
  const [sinZ, cosZ] = [Math.sin(rotation[2]), Math.cos(rotation[2])];

  const afterX: Vector3Tuple = [
    vector[0],
    vector[1] * cosX - vector[2] * sinX,
    vector[1] * sinX + vector[2] * cosX
  ];
  const afterY: Vector3Tuple = [
    afterX[0] * cosY + afterX[2] * sinY,
    afterX[1],
    -afterX[0] * sinY + afterX[2] * cosY
  ];

  return [
    afterY[0] * cosZ - afterY[1] * sinZ,
    afterY[0] * sinZ + afterY[1] * cosZ,
    afterY[2]
  ];
}
```

- [ ] **Step 6: Add light scene reader**

Create `src/lib/typegpu-renderer/component-helpers/lights.ts`:

```ts
import {
  clampedNumberArg,
  nonNegativeNumberArg,
  rgbTuple,
  vectorTuple
} from '../attributes';
import type { TypeGpuNode } from '../core';
import { composeTransforms, IDENTITY_TRANSFORM, readLocalTransform } from '../transform';
import {
  MAX_TYPEGPU_LIGHTS,
  type TypeGpuLight,
  type TypeGpuLightKind,
  type TypeGpuTransform,
  type Vector3Tuple
} from '../types';
import {
  DEFAULT_LIGHT_DIRECTION,
  normalizeVector,
  rotateVectorXyz,
  subtractVectors
} from '../vector-math';

export { MAX_TYPEGPU_LIGHTS };

const LIGHT_NODE_TO_KIND = new Map<string, TypeGpuLightKind>([
  ['ambientLight', 'ambient'],
  ['hemisphereLight', 'hemisphere'],
  ['directionalLight', 'directional'],
  ['pointLight', 'point'],
  ['spotLight', 'spot']
]);

const MAX_SPOT_ANGLE = Math.PI / 2 - 0.001;
const DEFAULT_SPOT_ANGLE = Math.PI / 6;

interface LightWalkContext {
  transform: TypeGpuTransform;
  revision: number;
}

export function collectLights(root: TypeGpuNode): TypeGpuLight[] {
  const lights: TypeGpuLight[] = [];

  collectFromNode(root, { transform: IDENTITY_TRANSFORM, revision: root.treeRevision }, lights);

  return lights;
}

export function isSupportedLightNode(node: TypeGpuNode | undefined): boolean {
  return Boolean(node?.name && LIGHT_NODE_TO_KIND.has(node.name));
}

export function subtreeHasSupportedLight(node: TypeGpuNode | undefined): boolean {
  if (!node) return false;
  if (isSupportedLightNode(node)) return true;

  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (subtreeHasSupportedLight(child)) return true;
  }

  return false;
}

function collectFromNode(
  node: TypeGpuNode,
  context: LightWalkContext,
  lights: TypeGpuLight[]
): void {
  if (lights.length >= MAX_TYPEGPU_LIGHTS) return;

  let childContext = context;

  if (node.name === 'group') {
    childContext = {
      transform: composeTransforms(context.transform, readLocalTransform(node)),
      revision: combineNodeRevision(context.revision, node)
    };
  } else if (isSupportedLightNode(node)) {
    const light = readLight(node, context);
    lights.push(light);
    childContext = {
      transform: lightTransform(node, context.transform),
      revision: light.revision
    };
  }

  for (let child = node.firstChild; child; child = child.nextSibling) {
    collectFromNode(child, childContext, lights);
    if (lights.length >= MAX_TYPEGPU_LIGHTS) return;
  }
}

function readLight(node: TypeGpuNode, context: LightWalkContext): TypeGpuLight {
  const kind = LIGHT_NODE_TO_KIND.get(node.name ?? '');
  if (!kind) throw new Error(`Unsupported light node: ${node.name ?? '<unknown>'}`);

  const transform = lightTransform(node, context.transform);
  const color =
    kind === 'hemisphere'
      ? rgbTuple(node.attributes.skyColor)
      : rgbTuple(node.attributes.color);
  const groundColor: Vector3Tuple =
    kind === 'hemisphere' ? rgbTuple(node.attributes.groundColor, [0, 0, 0]) : [0, 0, 0];

  return {
    id: node.uid,
    revision: combineNodeRevision(context.revision, node),
    kind,
    color,
    intensity: nonNegativeNumberArg(node.attributes.intensity, 1),
    position: transform.position,
    direction: readLightDirection(node, transform),
    range: nonNegativeNumberArg(node.attributes.range, 0),
    decay: nonNegativeNumberArg(node.attributes.decay, 2),
    angle: clampedNumberArg(node.attributes.angle, DEFAULT_SPOT_ANGLE, 0.001, MAX_SPOT_ANGLE),
    penumbra: clampedNumberArg(node.attributes.penumbra, 0, 0, 1),
    groundColor,
    castsShadow: false,
    shadowIndex: -1
  };
}

function lightTransform(node: TypeGpuNode, parent: TypeGpuTransform): TypeGpuTransform {
  return composeTransforms(parent, readLocalTransform(node));
}

function readLightDirection(node: TypeGpuNode, transform: TypeGpuTransform): Vector3Tuple {
  if ('lookAt' in node.attributes) {
    return normalizeVector(
      subtractVectors(vectorTuple(node.attributes.lookAt), transform.position),
      DEFAULT_LIGHT_DIRECTION
    );
  }

  return normalizeVector(
    rotateVectorXyz(DEFAULT_LIGHT_DIRECTION, transform.rotation),
    DEFAULT_LIGHT_DIRECTION
  );
}

function combineNodeRevision(seed: number, node: TypeGpuNode | null): number {
  return node ? (seed * 31 + node.uid) * 31 + node.revision : seed * 31;
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
npm test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: all `core.test.ts` tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts \
  src/lib/typegpu-renderer/attributes.ts \
  src/lib/typegpu-renderer/vector-math.ts \
  src/lib/typegpu-renderer/component-helpers/lights.ts \
  src/lib/typegpu-renderer/core.test.ts
git commit -m "Add TypeGPU light scene reader"
```

---

### Task 2: Scene State And Runtime Dirtiness

**Files:**
- Create: `src/lib/typegpu-renderer/scene-dirtiness.ts`
- Modify: `src/lib/typegpu-renderer/scene-state.ts`
- Modify: `src/lib/typegpu-renderer/svelte-renderer.ts`
- Modify: `src/lib/typegpu-renderer/types.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing tests for light state and dirtiness**

Append these tests to `src/lib/typegpu-renderer/core.test.ts`:

```ts
  it('includes lighting state and reuses it for scene-only updates', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const light = createElement('pointLight');

    setAttribute(light, 'position', [1, 2, 3]);
    insert(scene, light, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    setAttribute(scene, 'colorShift', 45);
    const secondState = createSceneState(root, cache, {
      reuseDrawBatches: true,
      reuseLights: true
    });

    expect(firstState.lightsChanged).toBe(true);
    expect(secondState.lights).toBe(firstState.lights);
    expect(secondState.lightsChanged).toBe(false);
  });

  it('marks lighting dirty for light changes and parent group transforms', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const group = createElement('group');
    const light = createElement('pointLight');
    const mesh = createElement('mesh');

    insert(group, light, null);
    insert(scene, group, null);
    insert(scene, mesh, null);
    insert(root, scene, null);

    expect(light invalidation helper(root, light, root.treeRevision)).toBe(true);
    expect(light invalidation helper(root, group, root.treeRevision)).toBe(true);
    expect(light invalidation helper(root, mesh, root.treeRevision)).toBe(false);
    expect(draw-batch invalidation helper(root, light, root.treeRevision)).toBe(false);
  });
```

Add these imports:

```ts
import {
  draw-batch invalidation helper,
  light invalidation helper
} from './scene-dirtiness';
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: fails because `reuseLights`, `lightsChanged`, and `scene-dirtiness.ts` do not exist.

- [ ] **Step 3: Add scene-state lighting fields**

Modify `src/lib/typegpu-renderer/types.ts`:

```ts
export interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
}
```

- [ ] **Step 4: Add runtime dirtiness helpers**

Create `src/lib/typegpu-renderer/scene-dirtiness.ts`:

```ts
import { isSupportedLightNode, subtreeHasSupportedLight } from './component-helpers/lights';
import type { TypeGpuNode } from './core';

export function draw-batch invalidation helper(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) return true;

  return (
    dirtyNode.name !== 'scene' &&
    dirtyNode.name !== 'perspectiveCamera' &&
    !isSupportedLightNode(dirtyNode)
  );
}

export function light invalidation helper(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) return true;
  if (isSupportedLightNode(dirtyNode)) return true;

  return dirtyNode.name === 'group' && subtreeHasSupportedLight(dirtyNode);
}
```

- [ ] **Step 5: Update scene state cache**

Modify `src/lib/typegpu-renderer/scene-state.ts`:

```ts
import { collectLights } from './component-helpers/lights';
```

Update the interfaces and cache factory:

```ts
export interface TypeGpuSceneCache {
  drawBatchCache: TypeGpuDrawBatchCache;
  cleanDrawBatches: TypeGpuDrawBatch[];
  cleanLights: TypeGpuLight[];
}

export interface TypeGpuSceneStateOptions {
  reuseDrawBatches?: boolean;
  reuseLights?: boolean;
}

export function createTypeGpuSceneCache(): TypeGpuSceneCache {
  return {
    drawBatchCache: createDrawBatchCache(),
    cleanDrawBatches: [],
    cleanLights: []
  };
}
```

Update `createSceneState(...)`:

```ts
  const drawBatches = options.reuseDrawBatches
    ? cache.cleanDrawBatches
    : cache.drawBatchCache.read(root);
  const lights = options.reuseLights ? cache.cleanLights : collectLights(root);

  if (!options.reuseDrawBatches) {
    cache.cleanDrawBatches = cleanDrawBatches(drawBatches);
  }

  if (!options.reuseLights) {
    cache.cleanLights = lights;
  }

  return {
    camera: readPerspectiveCamera(root),
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    colorShift: scene.colorShift,
    lights,
    lightsChanged: !options.reuseLights,
    drawBatches
  };
```

Add `TypeGpuLight` to the type imports.

- [ ] **Step 6: Update runtime scheduling**

Modify `src/lib/typegpu-renderer/svelte-renderer.ts`:

```ts
import {
  draw-batch invalidation helper,
  light invalidation helper
} from './scene-dirtiness';
```

Inside `createRuntime(...)`, add a `lightsDirty` flag beside `drawBatchesDirty`:

```ts
  let drawBatchesDirty = true;
  let lightsDirty = true;
```

Update `scheduleSync(...)`:

```ts
  function scheduleSync(nextRoot: TypeGpuNode, dirtyNode?: TypeGpuNode) {
    root = nextRoot;
    drawBatchesDirty ||= draw-batch invalidation helper(root, dirtyNode, syncedTreeRevision);
    lightsDirty ||= light invalidation helper(root, dirtyNode, syncedTreeRevision);

    if (queued) return;

    queued = true;
    queueMicrotask(() => {
      queued = false;
      gpu.setScene(
        createSceneState(root, sceneCache, {
          reuseDrawBatches: !drawBatchesDirty,
          reuseLights: !lightsDirty
        })
      );
      syncedTreeRevision = root.treeRevision;
      drawBatchesDirty = false;
      lightsDirty = false;
    });
  }
```

Remove the old local `draw-batch invalidation helper(...)` function from `svelte-renderer.ts`.

- [ ] **Step 7: Run tests to verify they pass**

Run:

```bash
npm test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: all `core.test.ts` tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/lib/typegpu-renderer/types.ts \
  src/lib/typegpu-renderer/scene-state.ts \
  src/lib/typegpu-renderer/scene-dirtiness.ts \
  src/lib/typegpu-renderer/svelte-renderer.ts \
  src/lib/typegpu-renderer/core.test.ts
git commit -m "Track TypeGPU lighting scene state"
```

---

### Task 3: TypeGPU Lighting Schemas And Buffer Packing

**Files:**
- Modify: `src/lib/typegpu-renderer/typegpu-layouts.ts`
- Create: `src/lib/typegpu-renderer/lighting-data.ts`
- Test: `src/lib/typegpu-renderer/typegpu-layouts.test.ts`
- Test: `src/lib/typegpu-renderer/lighting-data.test.ts`

- [ ] **Step 1: Write failing TypeGPU layout tests**

Append to `src/lib/typegpu-renderer/typegpu-layouts.test.ts`:

```ts
  it('describes lighting uniforms with a TypeGPU bind group layout', () => {
    expect(MAX_TYPEGPU_LIGHTS).toBe(32);
    expect(TYPEGPU_LIGHT_RECORD_BYTES).toBe(96);
    expect(d.sizeOf(typegpuLightSchema)).toBe(TYPEGPU_LIGHT_RECORD_BYTES);
    expect(d.sizeOf(typegpuLightingSchema)).toBe(TYPEGPU_LIGHTING_BYTES);
    expect(lightingBindGroupLayout.index).toBe(1);
    expect(lightingBindGroupLayout.entries.lighting?.uniform).toBe(typegpuLightingSchema);
  });
```

Update imports:

```ts
  lightingBindGroupLayout,
  MAX_TYPEGPU_LIGHTS,
  TYPEGPU_LIGHT_RECORD_BYTES,
  TYPEGPU_LIGHTING_BYTES,
  typegpuLightSchema,
  typegpuLightingSchema,
```

- [ ] **Step 2: Write failing lighting buffer packer tests**

Create `src/lib/typegpu-renderer/lighting-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { TYPEGPU_LIGHT_RECORD_BYTES } from './typegpu-layouts';
import {
  packLightingState,
  TYPEGPU_LIGHT_KIND
} from './lighting-data';
import type { TypeGpuLight } from './types';

describe('TypeGPU lighting data packing', () => {
  it('packs light count and light records into a mixed u32/f32 ArrayBuffer', () => {
    const buffer = packLightingState([
      light({
        kind: 'point',
        position: [2, 3, 4],
        color: [1, 0.5, 0.25],
        intensity: 6,
        range: 12,
        decay: 2
      }),
      light({
        kind: 'hemisphere',
        color: [0.5, 0.6, 0.7],
        groundColor: [0.1, 0.08, 0.04],
        intensity: 0.5
      })
    ]);
    const view = new DataView(buffer);
    const firstOffset = 16;
    const secondOffset = firstOffset + TYPEGPU_LIGHT_RECORD_BYTES;

    expect(view.getUint32(0, true)).toBe(2);
    expect(view.getUint32(firstOffset, true)).toBe(TYPEGPU_LIGHT_KIND.point);
    expect(view.getFloat32(firstOffset + 16, true)).toBeCloseTo(2);
    expect(view.getFloat32(firstOffset + 20, true)).toBeCloseTo(3);
    expect(view.getFloat32(firstOffset + 24, true)).toBeCloseTo(4);
    expect(view.getFloat32(firstOffset + 28, true)).toBeCloseTo(12);
    expect(view.getFloat32(firstOffset + 48, true)).toBeCloseTo(1);
    expect(view.getFloat32(firstOffset + 52, true)).toBeCloseTo(0.5);
    expect(view.getFloat32(firstOffset + 56, true)).toBeCloseTo(0.25);
    expect(view.getFloat32(firstOffset + 60, true)).toBeCloseTo(6);
    expect(view.getFloat32(firstOffset + 84, true)).toBeCloseTo(2);

    expect(view.getUint32(secondOffset, true)).toBe(TYPEGPU_LIGHT_KIND.hemisphere);
    expect(view.getFloat32(secondOffset + 64, true)).toBeCloseTo(0.1);
    expect(view.getFloat32(secondOffset + 68, true)).toBeCloseTo(0.08);
    expect(view.getFloat32(secondOffset + 72, true)).toBeCloseTo(0.04);
  });
});

function light(overrides: Partial<TypeGpuLight>): TypeGpuLight {
  return {
    id: 1,
    revision: 1,
    kind: 'ambient',
    color: [1, 1, 1],
    intensity: 1,
    position: [0, 0, 0],
    direction: [0, 0, -1],
    range: 0,
    decay: 2,
    angle: Math.PI / 6,
    penumbra: 0,
    groundColor: [0, 0, 0],
    castsShadow: false,
    shadowIndex: -1,
    ...overrides
  };
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npm test -- src/lib/typegpu-renderer/typegpu-layouts.test.ts src/lib/typegpu-renderer/lighting-data.test.ts
```

Expected: fails because lighting layout and packer exports are missing.

- [ ] **Step 4: Add TypeGPU lighting schemas**

Modify `src/lib/typegpu-renderer/typegpu-layouts.ts`:

```ts
import { MAX_TYPEGPU_LIGHTS } from './types';

export { MAX_TYPEGPU_LIGHTS };

export const TYPEGPU_LIGHT_RECORD_BYTES = 96;
export const TYPEGPU_LIGHTING_BYTES = 16 + MAX_TYPEGPU_LIGHTS * TYPEGPU_LIGHT_RECORD_BYTES;

export const typegpuLightSchema = d
  .struct({
    kind: d.u32,
    flags: d.u32,
    shadowIndex: d.u32,
    reserved0: d.u32,
    position_range: d.vec4f,
    direction_angle: d.vec4f,
    color_intensity: d.vec4f,
    secondary_color: d.vec4f,
    params: d.vec4f
  })
  .$name('TypeGpuLight');

export const typegpuLightingSchema = d
  .struct({
    count: d.u32,
    reserved0: d.u32,
    reserved1: d.u32,
    reserved2: d.u32,
    lights: d.arrayOf(typegpuLightSchema, MAX_TYPEGPU_LIGHTS)
  })
  .$name('TypeGpuLighting');

export const lightingBindGroupLayout = tgpu
  .bindGroupLayout({
    lighting: { uniform: typegpuLightingSchema }
  })
  .$idx(1)
  .$name('TypeGPU lighting bind group layout');
```

Place this after `sceneBindGroupLayout` or after the scene schema definitions. Keep `sceneBindGroupLayout.$idx(0)` unchanged.

- [ ] **Step 5: Add lighting buffer packer**

Create `src/lib/typegpu-renderer/lighting-data.ts`:

```ts
import type { TypeGpuLight, TypeGpuLightKind } from './types';
import {
  MAX_TYPEGPU_LIGHTS,
  TYPEGPU_LIGHTING_BYTES,
  TYPEGPU_LIGHT_RECORD_BYTES
} from './typegpu-layouts';

export const TYPEGPU_LIGHT_KIND: Record<TypeGpuLightKind, number> = {
  ambient: 1,
  hemisphere: 2,
  directional: 3,
  point: 4,
  spot: 5
};

const HEADER_BYTES = 16;

export function packLightingState(lights: TypeGpuLight[]): ArrayBuffer {
  const buffer = new ArrayBuffer(TYPEGPU_LIGHTING_BYTES);
  const view = new DataView(buffer);
  const count = Math.min(MAX_TYPEGPU_LIGHTS, lights.length);

  view.setUint32(0, count, true);

  for (let index = 0; index < count; index += 1) {
    writeLight(view, HEADER_BYTES + index * TYPEGPU_LIGHT_RECORD_BYTES, lights[index]);
  }

  return buffer;
}

function writeLight(view: DataView, offset: number, light: TypeGpuLight): void {
  view.setUint32(offset, TYPEGPU_LIGHT_KIND[light.kind], true);
  view.setUint32(offset + 4, light.castsShadow ? 1 : 0, true);
  view.setUint32(offset + 8, Math.max(0, light.shadowIndex), true);
  view.setUint32(offset + 12, 0, true);

  writeVec4(view, offset + 16, light.position[0], light.position[1], light.position[2], light.range);
  writeVec4(view, offset + 32, light.direction[0], light.direction[1], light.direction[2], light.angle);
  writeVec4(view, offset + 48, light.color[0], light.color[1], light.color[2], light.intensity);
  writeVec4(
    view,
    offset + 64,
    light.groundColor[0],
    light.groundColor[1],
    light.groundColor[2],
    0
  );
  writeVec4(view, offset + 80, light.decay, light.penumbra, 0, 0);
}

function writeVec4(
  view: DataView,
  offset: number,
  x: number,
  y: number,
  z: number,
  w: number
): void {
  view.setFloat32(offset, x, true);
  view.setFloat32(offset + 4, y, true);
  view.setFloat32(offset + 8, z, true);
  view.setFloat32(offset + 12, w, true);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:

```bash
npm test -- src/lib/typegpu-renderer/typegpu-layouts.test.ts src/lib/typegpu-renderer/lighting-data.test.ts
```

Expected: both test files pass.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/typegpu-layouts.ts \
  src/lib/typegpu-renderer/typegpu-layouts.test.ts \
  src/lib/typegpu-renderer/lighting-data.ts \
  src/lib/typegpu-renderer/lighting-data.test.ts
git commit -m "Add TypeGPU lighting buffer layout"
```

---

### Task 4: GPU Renderer Lighting Resource

**Files:**
- Modify: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.test.ts`

- [ ] **Step 1: Write failing source-level tests for TypeGPU lighting resources**

Append to `src/lib/typegpu-renderer/gpu-renderer.test.ts`:

```ts
  it('uses a TypeGPU lighting bind group without raw lighting resource creation', () => {
    expect(layoutsSource).toContain('lightingBindGroupLayout');
    expect(rendererSource).toContain('root.createBindGroup(lightingBindGroupLayout');
    expect(rendererSource).toContain('root.createBuffer(typegpuLightingSchema)');
    expect(rendererSource).toContain(".$usage('uniform')");
    expect(rendererSource).toContain('packLightingState(scene.lights)');
    expect(rendererSource).toContain('pass.setBindGroup(1, this.#rawLightingBindGroup)');
    expect(source).not.toContain('device.createBindGroup');
    expect(source).not.toContain('device.createRenderPipeline');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: fails because renderer lighting resources do not exist.

- [ ] **Step 3: Add lighting resource fields and constructor setup**

Modify imports in `src/lib/typegpu-renderer/gpu-renderer.ts`:

```ts
import { packLightingState } from './lighting-data';
import {
  lightingBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout,
  TYPEGPU_SCENE_UNIFORM_FLOATS,
  typegpuLightingSchema,
  typegpuSceneUniformSchema
} from './typegpu-layouts';
```

Add type alias:

```ts
type TypeGpuLightingUniformBuffer = TgpuBuffer<typeof typegpuLightingSchema> & UniformFlag;
```

Add private fields:

```ts
  #lightingBindGroup: TgpuBindGroup;
  #lightingBuffer: TypeGpuLightingUniformBuffer;
  #rawLightingBindGroup: GPUBindGroup;
```

In the constructor after scene bind group setup:

```ts
    this.#lightingBuffer = root
      .createBuffer(typegpuLightingSchema)
      .$usage('uniform')
      .$name('TypeGPU lighting uniforms');
    this.#lightingBindGroup = root.createBindGroup(lightingBindGroupLayout, {
      lighting: this.#lightingBuffer
    });
```

After raw scene resources are unwrapped:

```ts
    this.#rawLightingBindGroup = root.unwrap(this.#lightingBindGroup);
```

Update the initial `setScene(...)` call to include empty lights:

```ts
      lights: [],
      lightsChanged: true,
```

- [ ] **Step 4: Upload lighting in setScene and bind group 1 while drawing**

In `setScene(scene: TypeGpuSceneState)`, after assigning scene-level scalar fields:

```ts
    if (scene.lightsChanged) {
      this.#lightingBuffer.write(packLightingState(scene.lights));
    }
```

In `#render(...)`, after binding group 0:

```ts
      pass.setBindGroup(1, this.#rawLightingBindGroup);
```

In `dispose()`, destroy the lighting buffer:

```ts
    this.#lightingBuffer.destroy();
```

- [ ] **Step 5: Run test to verify it passes**

Run:

```bash
npm test -- src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: `gpu-renderer.test.ts` passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/typegpu-renderer/gpu-renderer.ts \
  src/lib/typegpu-renderer/gpu-renderer.test.ts
git commit -m "Upload TypeGPU lighting uniforms"
```

---

### Task 5: TypeGPU Shader Lighting

**Files:**
- Modify: `src/lib/typegpu-renderer/typegpu-pipeline.ts`
- Modify: `src/lib/typegpu-renderer/typegpu-pipeline.test.ts`

- [ ] **Step 1: Write failing shader resolution test**

Update `src/lib/typegpu-renderer/typegpu-pipeline.test.ts`:

```ts
  it('resolves the fragment shader with TypeGPU lighting inputs attached', () => {
    const wgsl = tgpu.resolve([meshFragmentMain], { names: 'strict' });

    expect(wgsl).toContain('@fragment fn meshFragmentMain(in:');
    expect(wgsl).toContain('lightingBindGroupLayout');
    expect(wgsl).toContain('evaluate_light');
    expect(wgsl).toContain('evaluate_lighting');
    expect(wgsl).toContain('in.world_position');
    expect(wgsl).toContain('in.normal');
    expect(wgsl).toContain('in.material');
    expect(wgsl).toContain('rotate_hue');
  });
```

Keep the existing test assertions that still apply.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/lib/typegpu-renderer/typegpu-pipeline.test.ts
```

Expected: fails because shader code does not use lighting bind group or world position.

- [ ] **Step 3: Add world position as a vertex output**

Modify `meshVertexMain` output in `src/lib/typegpu-renderer/typegpu-pipeline.ts`:

```ts
    out: {
      position: d.builtin.position,
      color: d.location(0, d.vec4f),
      normal: d.location(1, d.vec3f),
      material: d.location(2, d.vec2f),
      world_position: d.location(3, d.vec3f)
    }
```

Set it before returning:

```wgsl
    output.world_position = world_position;
```

Modify `meshFragmentMain` input to include:

```ts
      world_position: d.location(3, d.vec3f)
```

- [ ] **Step 4: Add TypeGPU lighting shader functions**

Import the lighting layout:

```ts
import {
  lightingBindGroupLayout,
  meshInstanceLayout,
  meshVertexLayout,
  sceneBindGroupLayout
} from './typegpu-layouts';
```

Add these functions before `meshFragmentMain`:

```ts
const evaluateLight = tgpu
  .fn([d.u32, d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32], d.vec3f)/* wgsl */ `(
    index,
    world_position,
    normal,
    base_color,
    roughness,
    metalness
  ) {
    let light = lightingBindGroupLayout.$.lighting.lights[index];
    let kind = light.kind;
    let color = light.color_intensity.rgb;
    let intensity = max(light.color_intensity.a, 0.0);
    let n = normalize(normal);
    var light_dir = vec3(0.0, 1.0, 0.0);
    var attenuation = 1.0;
    var ambient = vec3(0.0);

    if (kind == 1u) {
      ambient = color * intensity;
      return base_color * ambient;
    }

    if (kind == 2u) {
      let sky = max(n.y * 0.5 + 0.5, 0.0);
      let hemi = mix(light.secondary_color.rgb, color, sky) * intensity;
      return base_color * hemi;
    }

    if (kind == 3u) {
      light_dir = normalize(-light.direction_angle.xyz);
    } else {
      let to_light = light.position_range.xyz - world_position;
      let distance_to_light = length(to_light);
      light_dir = normalize(to_light);

      if (light.position_range.w > 0.0) {
        let range_factor = clamp(1.0 - distance_to_light / light.position_range.w, 0.0, 1.0);
        attenuation = pow(range_factor, max(light.params.x, 0.0001));
      } else {
        attenuation = 1.0 / max(1.0, distance_to_light * distance_to_light);
      }

      if (kind == 5u) {
        let spot_direction = normalize(light.direction_angle.xyz);
        let spot_cos = dot(normalize(world_position - light.position_range.xyz), spot_direction);
        let inner_cos = cos(light.direction_angle.w * (1.0 - clamp(light.params.y, 0.0, 1.0)));
        let outer_cos = cos(light.direction_angle.w);
        attenuation = attenuation * smoothstep(outer_cos, inner_cos, spot_cos);
      }
    }

    let diffuse = max(dot(n, light_dir), 0.0);
    let view_dir = normalize(vec3(0.0, 0.0, 1.0));
    let half_dir = normalize(light_dir + view_dir);
    let spec_power = mix(96.0, 12.0, roughness);
    let specular = pow(max(dot(n, half_dir), 0.0), spec_power) * mix(0.08, 0.35, metalness);

    return (base_color * diffuse + specular) * color * intensity * attenuation;
  }`
  .$uses({ lightingBindGroupLayout })
  .$name('evaluate_light');

const evaluateLighting = tgpu
  .fn([d.vec3f, d.vec3f, d.vec3f, d.f32, d.f32], d.vec3f)/* wgsl */ `(
    world_position,
    normal,
    base_color,
    roughness,
    metalness
  ) {
    var lit = vec3(0.0);
    let count = min(lightingBindGroupLayout.$.lighting.count, 32u);

    for (var index = 0u; index < count; index = index + 1u) {
      lit += evaluate_light(index, world_position, normal, base_color, roughness, metalness);
    }

    if (count == 0u) {
      let fallback_light = normalize(vec3(0.45, 0.78, 0.6));
      let fallback_diffuse = max(dot(normalize(normal), fallback_light), 0.0);
      lit = base_color * (0.24 + fallback_diffuse * 0.78);
    }

    return clamp(lit, vec3(0.0), vec3(4.0));
  }`
  .$uses({ evaluate_light: evaluateLight, lightingBindGroupLayout })
  .$name('evaluate_lighting');
```

- [ ] **Step 5: Replace hard-coded fragment lighting**

Update the fragment WGSL body:

```wgsl
    let roughness = clamp(in.material.x, 0.0, 1.0);
    let metalness = clamp(in.material.y, 0.0, 1.0);
    let shifted_color = rotate_hue(
      in.color.rgb,
      sceneBindGroupLayout.$.scene.color_transform.x
    );
    let lit_color = evaluate_lighting(
      in.world_position,
      in.normal,
      shifted_color,
      roughness,
      metalness
    );

    return vec4(lit_color, in.color.a);
```

Update `.$uses(...)` on `meshFragmentMain`:

```ts
  .$uses({
    evaluate_lighting: evaluateLighting,
    rotate_hue: rotateHue,
    sceneBindGroupLayout
  })
```

- [ ] **Step 6: Run shader test**

Run:

```bash
npm test -- src/lib/typegpu-renderer/typegpu-pipeline.test.ts
```

Expected: shader resolution test passes.

- [ ] **Step 7: Commit**

```bash
git add src/lib/typegpu-renderer/typegpu-pipeline.ts \
  src/lib/typegpu-renderer/typegpu-pipeline.test.ts
git commit -m "Evaluate scene lights in TypeGPU shader"
```

---

### Task 6: Svelte Demo Light Authoring

**Files:**
- Modify: `src/Scene.typegpu.svelte`
- Modify: `src/Scene.typegpu.test.ts`

- [ ] **Step 1: Write failing demo authoring test**

Add to `src/Scene.typegpu.test.ts`:

```ts
  it('authors broad light nodes in the demo scene', () => {
    expect(source).toContain('<ambientLight');
    expect(source).toContain('<hemisphereLight');
    expect(source).toContain('<directionalLight');
    expect(source).toContain('<pointLight');
    expect(source).toContain('<spotLight');
    expect(source).toContain('lookAt={[0, 0, 0]}');
  });
```

In the existing `renders the direct mesh API into TypeGPU scene nodes` test, add after camera lookup:

```ts
    const ambientLight = onlyNamed(scene, 'ambientLight');
    const hemisphereLight = onlyNamed(scene, 'hemisphereLight');
    const directionalLight = onlyNamed(scene, 'directionalLight');
    const pointLight = onlyNamed(scene, 'pointLight');
    const spotLight = onlyNamed(scene, 'spotLight');
```

Add assertions before mesh assertions:

```ts
    expect(ambientLight.attributes).toMatchObject({
      intensity: 0.18
    });
    expect(hemisphereLight.attributes).toMatchObject({
      intensity: 0.38
    });
    expect(directionalLight.attributes).toMatchObject({
      intensity: 1.45
    });
    expect(pointLight.attributes).toMatchObject({
      intensity: 5.5,
      range: 16,
      decay: 2
    });
    expect(spotLight.attributes).toMatchObject({
      lookAt: [0, 0, 0],
      intensity: 7,
      range: 22,
      angle: 0.42,
      penumbra: 0.35
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npm test -- src/Scene.typegpu.test.ts
```

Expected: fails because light nodes are not authored in the demo scene.

- [ ] **Step 3: Add demo light nodes**

Modify `src/Scene.typegpu.svelte` immediately after `<perspectiveCamera ...>`:

```svelte
  <ambientLight color={[1, 1, 1]} intensity={0.18}></ambientLight>

  <hemisphereLight
    skyColor={[0.48, 0.62, 1]}
    groundColor={[0.18, 0.12, 0.08]}
    intensity={0.38}
  ></hemisphereLight>

  <directionalLight
    rotation={[-0.82, 0.35, 0]}
    color={[1, 0.96, 0.88]}
    intensity={1.45}
  ></directionalLight>

  <group rotation={[0, (controls.hue * Math.PI) / 180, 0]}>
    <pointLight
      position={[frame.floorSize * 0.35, frame.floorSize * 0.28, frame.floorSize * 0.2]}
      color={[1, 0.52, 0.28]}
      intensity={5.5}
      range={16}
      decay={2}
    ></pointLight>
  </group>

  <spotLight
    position={[0, frame.floorSize * 0.65, frame.floorSize * 0.55]}
    lookAt={[0, 0, 0]}
    color={[0.58, 0.76, 1]}
    intensity={7}
    range={22}
    angle={0.42}
    penumbra={0.35}
  ></spotLight>
```

- [ ] **Step 4: Run demo test**

Run:

```bash
npm test -- src/Scene.typegpu.test.ts
```

Expected: `Scene.typegpu.test.ts` passes.

- [ ] **Step 5: Commit**

```bash
git add src/Scene.typegpu.svelte src/Scene.typegpu.test.ts
git commit -m "Author demo TypeGPU lights"
```

---

### Task 7: Svelte Reactivity Coverage

**Files:**
- Modify: `src/lib/typegpu-renderer/core.test.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.test.ts`

- [ ] **Step 1: Add tests for Svelte-to-scene propagation**

Append to `src/lib/typegpu-renderer/core.test.ts`:

```ts
  it('propagates light attribute updates through scene state without repacking meshes', () => {
    const cache = createTypeGpuSceneCache();
    const root = createFragment();
    const scene = createElement('scene');
    const light = createElement('pointLight');
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');

    setAttribute(light, 'intensity', 1);
    insert(mesh, geometry, null);
    insert(scene, mesh, null);
    insert(scene, light, null);
    insert(root, scene, null);

    const firstState = createSceneState(root, cache);
    const firstBoxBatch = drawBatch(firstState, 'mesh:box:standard');
    setAttribute(light, 'intensity', 4);
    const secondState = createSceneState(root, cache, { reuseDrawBatches: true });
    const secondBoxBatch = drawBatch(secondState, 'mesh:box:standard');

    expect(secondState.lightsChanged).toBe(true);
    expect(secondState.lights[0].intensity).toBe(4);
    expect(secondBoxBatch.instances).toBe(firstBoxBatch.instances);
    expect(secondBoxBatch.instancesChanged).toBe(false);
  });

  it('passes updated light nodes to runtime sync scheduling', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const light = createElement('pointLight');
    const scheduleSync = vi.fn();

    root.runtime = { scheduleSync };
    insert(scene, light, null);
    insert(root, scene, null);
    scheduleSync.mockClear();

    setAttribute(light, 'position', [2, 3, 4]);

    expect(scheduleSync).toHaveBeenLastCalledWith(root, light);
  });
```

Append to `src/lib/typegpu-renderer/gpu-renderer.test.ts`:

```ts
  it('loads renderer runtime source for lighting dirtiness assertions', () => {
    expect(svelteRendererSource).toContain('reuseLights: !lightsDirty');
  });

  it('treats lighting changes as buffer writes separate from mesh uploads', () => {
    expect(rendererSource).toContain('if (scene.lightsChanged)');
    expect(rendererSource).toContain('this.#lightingBuffer.write(packLightingState(scene.lights))');
    expect(rendererSource).not.toContain('packMeshInstance(scene.lights');
  });
```

At the top of the same `describe(...)` block, add the source read next to the existing source reads:

```ts
  const svelteRendererSource = readFileSync(
    'src/lib/typegpu-renderer/svelte-renderer.ts',
    'utf8'
  );
```

- [ ] **Step 2: Run tests**

Run:

```bash
npm test -- src/lib/typegpu-renderer/core.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: tests pass if Tasks 1 through 4 are complete.

- [ ] **Step 3: Commit**

```bash
git add src/lib/typegpu-renderer/core.test.ts \
  src/lib/typegpu-renderer/gpu-renderer.test.ts
git commit -m "Cover Svelte light reactivity"
```

---

### Task 8: Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run the full test suite**

Run:

```bash
npm test
```

Expected: all test files and tests pass.

- [ ] **Step 2: Run the production build**

Run:

```bash
npm run build
```

Expected: Vite production build exits 0.

- [ ] **Step 3: Inspect git status**

Run:

```bash
git status --short
```

Expected: only unrelated pre-existing files remain untracked or modified. The unrelated `docs/superpowers/plans/2026-05-22-typegpu-material-textures.md` file may still appear untracked.

- [ ] **Step 4: Create final verification commit only if earlier tasks left staged changes**

If `git status --short` shows tracked lighting files modified after Task 7, commit them:

```bash
git add src docs/superpowers/specs/2026-05-22-typegpu-lighting-design.md
git commit -m "Verify TypeGPU lighting implementation"
```

Expected: commit succeeds only when there are remaining tracked lighting changes. If there are no tracked changes, do not create an empty commit.
