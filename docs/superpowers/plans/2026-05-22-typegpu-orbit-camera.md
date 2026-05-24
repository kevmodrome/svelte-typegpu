# TypeGPU Orbit Camera Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add declarative interactive orbit camera controls to the TypeGPU custom renderer while preserving the existing static `<perspectiveCamera>` behavior.

**Architecture:** Keep `<perspectiveCamera>` as the only camera element and parse optional `<orbitControls>` children with explicit `<pointerControls>` and `<keyboardControls>` input nodes. Put pure orbit math in a focused module, keep DOM listener ownership in the custom renderer runtime, and expose GPU camera updates through a narrow `setCamera(...)` renderer method.

**Tech Stack:** Svelte custom renderer, TypeScript, TypeGPU, Vitest, browser DOM pointer/wheel/touch events.

---

## File Structure

- Modify `src/lib/typegpu-renderer/types.ts`
  - Add camera controller/input types and add `cameraNode` / `cameraController` metadata to `TypeGpuSceneState`.
- Modify `src/lib/typegpu-renderer/component-helpers/perspective-camera.ts`
  - Keep `readPerspectiveCamera(...)` for existing callers.
  - Add `readPerspectiveCameraState(...)` for camera settings plus control metadata.
  - Export `isCameraControlNode(...)` for dirtiness logic.
- Create `src/lib/typegpu-renderer/camera-orbit.ts`
  - Own pure orbit derivation, rotate, zoom, wheel normalization, and camera reconstruction.
- Create `src/lib/typegpu-renderer/camera-orbit.test.ts`
  - Cover pure math independent of DOM/WebGPU.
- Create `src/lib/typegpu-renderer/camera-interaction.ts`
  - Own runtime listener reconciliation and `camerachange` dispatch.
- Create `src/lib/typegpu-renderer/camera-interaction.test.ts`
  - Cover listener lifecycle and event/update behavior with fake targets.
- Modify `src/lib/typegpu-renderer/scene-state.ts`
  - Use `readPerspectiveCameraState(...)` and pass metadata through scene state.
- Modify `src/lib/typegpu-renderer/scene-dirtiness.ts`
  - Treat camera-control nodes like camera nodes for draw-batch and lighting invalidation.
- Modify `src/lib/typegpu-renderer/gpu-renderer.ts`
  - Add `setCamera(camera)` to `TypeGpuRenderer`.
  - Have `setScene(...)` delegate camera updates through `setCamera(...)`.
- Modify `src/lib/typegpu-renderer/svelte-renderer.ts`
  - Create and reconcile the camera interaction controller inside runtime sync.
  - Dispose camera listeners with the root.
- Modify `src/lib/scene-controls.ts`
  - Replace demo camera rotation state with `lookAt`.
  - Add a helper to copy camera-change event detail into demo controls.
- Modify `src/Scene.typegpu.svelte`
  - Render `<orbitControls>`, `<pointerControls>`, and `<keyboardControls>` under the camera.
  - Emit `oncamerachange` through a prop callback.
- Modify `src/TypeGpuCanvas.svelte`
  - Pass the camera-change callback into the custom-rendered scene.
- Modify `src/App.svelte`
  - Capture continuous camera changes and remove the rotation slider UI.
- Modify tests:
  - `src/lib/typegpu-renderer/core.test.ts`
  - `src/lib/typegpu-renderer/gpu-renderer.test.ts`
  - `src/lib/scene-controls.test.ts`
  - `src/Scene.typegpu.test.ts`

## Task 1: Parse Declarative Camera Controls

**Files:**
- Modify: `src/lib/typegpu-renderer/types.ts`
- Modify: `src/lib/typegpu-renderer/component-helpers/perspective-camera.ts`
- Modify: `src/lib/typegpu-renderer/scene-state.ts`
- Modify: `src/lib/typegpu-renderer/scene-dirtiness.ts`
- Test: `src/lib/typegpu-renderer/core.test.ts`

- [ ] **Step 1: Write failing tests for camera-control scene parsing**

Add these imports in `src/lib/typegpu-renderer/core.test.ts`:

```ts
import {
  readPerspectiveCamera,
  readPerspectiveCameraState
} from './component-helpers/perspective-camera';
```

Replace the existing single import of `readPerspectiveCamera` from `./component-helpers/perspective-camera` with the block above.

Add these tests after `reads camera settings from a perspectiveCamera node`:

```ts
  it('reads orbit, pointer, and keyboard controls from a perspectiveCamera node', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const orbit = createElement('orbitControls');
    const pointer = createElement('pointerControls');
    const keyboard = createElement('keyboardControls');

    setAttribute(camera, 'position', [0, 1.4, 5]);
    setAttribute(camera, 'lookAt', [0, 0, 0]);
    setAttribute(orbit, 'minDistance', 2);
    setAttribute(orbit, 'maxDistance', 40);
    setAttribute(orbit, 'invert', true);
    setAttribute(pointer, 'dragButton', 'primary');
    setAttribute(pointer, 'rotateSpeed', 1.5);
    setAttribute(pointer, 'wheel', 'zoom');
    setAttribute(pointer, 'zoomSpeed', 0.75);
    setAttribute(pointer, 'touch', 'orbit-pinch');
    setAttribute(keyboard, 'rotateLeft', 'KeyA');
    setAttribute(keyboard, 'rotateRight', 'KeyD');
    setAttribute(keyboard, 'rotateUp', 'KeyW');
    setAttribute(keyboard, 'rotateDown', 'KeyS');
    setAttribute(keyboard, 'zoomIn', 'Equal');
    setAttribute(keyboard, 'zoomOut', 'Minus');
    setAttribute(keyboard, 'step', 0.12);

    insert(orbit, pointer, null);
    insert(orbit, keyboard, null);
    insert(camera, orbit, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    const state = readPerspectiveCameraState(root);

    expect(state.node).toBe(camera);
    expect(state.settings).toMatchObject({
      position: [0, 1.4, 5],
      lookAt: [0, 0, 0]
    });
    expect(state.controller).toEqual({
      kind: 'orbit',
      minDistance: 2,
      maxDistance: 40,
      invert: true,
      pointer: {
        dragButton: 'primary',
        rotateSpeed: 1.5,
        wheel: 'zoom',
        zoomSpeed: 0.75,
        touch: 'orbit-pinch'
      },
      keyboard: {
        rotateLeft: 'KeyA',
        rotateRight: 'KeyD',
        rotateUp: 'KeyW',
        rotateDown: 'KeyS',
        zoomIn: 'Equal',
        zoomOut: 'Minus',
        step: 0.12
      }
    });
  });

  it('keeps orbitControls inert until it has supported input children', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const orbit = createElement('orbitControls');

    insert(camera, orbit, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(readPerspectiveCameraState(root).controller).toBeNull();
  });

  it('ignores camera-control nodes outside the camera hierarchy', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const orbit = createElement('orbitControls');
    const pointer = createElement('pointerControls');

    insert(orbit, pointer, null);
    insert(scene, camera, null);
    insert(scene, orbit, null);
    insert(root, scene, null);

    expect(readPerspectiveCameraState(root).controller).toBeNull();
  });
```

Add this test near the existing dirtiness tests:

```ts
  it('keeps camera-control changes out of draw-batch and light dirtiness', () => {
    const root = createFragment();
    const scene = createElement('scene');
    const camera = createElement('perspectiveCamera');
    const orbit = createElement('orbitControls');
    const pointer = createElement('pointerControls');

    insert(orbit, pointer, null);
    insert(camera, orbit, null);
    insert(scene, camera, null);
    insert(root, scene, null);

    expect(draw-batch invalidation helper(root, camera, root.treeRevision)).toBe(false);
    expect(draw-batch invalidation helper(root, orbit, root.treeRevision)).toBe(false);
    expect(draw-batch invalidation helper(root, pointer, root.treeRevision)).toBe(false);
    expect(light invalidation helper(root, camera, root.treeRevision)).toBe(false);
    expect(light invalidation helper(root, orbit, root.treeRevision)).toBe(false);
    expect(light invalidation helper(root, pointer, root.treeRevision)).toBe(false);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: FAIL because `readPerspectiveCameraState` and camera-control dirtiness support do not exist yet.

- [ ] **Step 3: Add camera-control types**

In `src/lib/typegpu-renderer/types.ts`, add this type-only import at the top:

```ts
import type { TypeGpuNode } from './core';
```

Add these types after `TypeGpuCameraSettings`:

```ts
export type TypeGpuPointerDragButton = 'primary' | 'middle' | 'secondary';
export type TypeGpuPointerWheelMode = 'zoom' | 'none';
export type TypeGpuTouchMode = 'orbit-pinch' | 'orbit' | 'pinch' | 'none';

export interface TypeGpuPointerControls {
  dragButton: TypeGpuPointerDragButton;
  rotateSpeed: number;
  wheel: TypeGpuPointerWheelMode;
  zoomSpeed: number;
  touch: TypeGpuTouchMode;
}

export interface TypeGpuKeyboardControls {
  rotateLeft: string;
  rotateRight: string;
  rotateUp: string;
  rotateDown: string;
  zoomIn: string;
  zoomOut: string;
  step: number;
}

export interface TypeGpuOrbitController {
  kind: 'orbit';
  minDistance: number;
  maxDistance: number;
  invert: boolean;
  pointer: TypeGpuPointerControls | null;
  keyboard: TypeGpuKeyboardControls | null;
}

export type TypeGpuCameraController = TypeGpuOrbitController;

export interface TypeGpuCameraState {
  node: TypeGpuNode | null;
  settings: TypeGpuCameraSettings;
  controller: TypeGpuCameraController | null;
}
```

Extend `TypeGpuSceneState`:

```ts
export interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  cameraNode: TypeGpuNode | null;
  cameraController: TypeGpuCameraController | null;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
}
```

- [ ] **Step 4: Implement camera-control parsing**

Replace `src/lib/typegpu-renderer/component-helpers/perspective-camera.ts` with:

```ts
import { clampedNumberArg, numberArg, vectorTuple } from '../attributes';
import { findFirst, type TypeGpuNode } from '../core';
import type {
  TypeGpuCameraController,
  TypeGpuCameraSettings,
  TypeGpuCameraState,
  TypeGpuKeyboardControls,
  TypeGpuPointerControls,
  TypeGpuPointerDragButton,
  TypeGpuPointerWheelMode,
  TypeGpuTouchMode
} from '../types';

export const DEFAULT_CAMERA: TypeGpuCameraSettings = {
  position: [9, 7, 13],
  lookAt: [0, 0, 0],
  fov: 45,
  near: 0.1,
  far: 100
};

const DEFAULT_MIN_DISTANCE = 1;
const DEFAULT_MAX_DISTANCE = 100;
const DEFAULT_POINTER_CONTROLS: TypeGpuPointerControls = {
  dragButton: 'primary',
  rotateSpeed: 1,
  wheel: 'zoom',
  zoomSpeed: 1,
  touch: 'orbit-pinch'
};
const DEFAULT_KEYBOARD_CONTROLS: TypeGpuKeyboardControls = {
  rotateLeft: 'ArrowLeft',
  rotateRight: 'ArrowRight',
  rotateUp: 'ArrowUp',
  rotateDown: 'ArrowDown',
  zoomIn: '+',
  zoomOut: '-',
  step: 0.08
};

export function readPerspectiveCamera(root: TypeGpuNode): TypeGpuCameraSettings {
  return readPerspectiveCameraState(root).settings;
}

export function readPerspectiveCameraState(root: TypeGpuNode): TypeGpuCameraState {
  const camera = findFirst(root, (node) => node.name === 'perspectiveCamera');
  const attributes = camera?.attributes ?? {};

  return {
    node: camera,
    settings: {
      position: vectorTuple(attributes.position, DEFAULT_CAMERA.position),
      lookAt: vectorTuple(attributes.lookAt, DEFAULT_CAMERA.lookAt),
      fov: numberArg(attributes.fov, DEFAULT_CAMERA.fov),
      near: numberArg(attributes.near, DEFAULT_CAMERA.near),
      far: numberArg(attributes.far, DEFAULT_CAMERA.far)
    },
    controller: camera ? readCameraController(camera) : null
  };
}

export function isCameraControlNode(node: TypeGpuNode | undefined): boolean {
  return (
    node?.name === 'perspectiveCamera' ||
    node?.name === 'orbitControls' ||
    node?.name === 'pointerControls' ||
    node?.name === 'keyboardControls'
  );
}

function readCameraController(camera: TypeGpuNode): TypeGpuCameraController | null {
  const orbit = firstChildNamed(camera, 'orbitControls');
  if (!orbit) return null;

  const pointer = firstChildNamed(orbit, 'pointerControls');
  const keyboard = firstChildNamed(orbit, 'keyboardControls');

  if (!pointer && !keyboard) return null;

  const minDistance = clampedNumberArg(
    orbit.attributes.minDistance,
    DEFAULT_MIN_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );
  const maxDistance = clampedNumberArg(
    orbit.attributes.maxDistance,
    DEFAULT_MAX_DISTANCE,
    0.0001,
    Number.MAX_SAFE_INTEGER
  );

  return {
    kind: 'orbit',
    minDistance: minDistance <= maxDistance ? minDistance : DEFAULT_MIN_DISTANCE,
    maxDistance: minDistance <= maxDistance ? maxDistance : DEFAULT_MAX_DISTANCE,
    invert: orbit.attributes.invert === true,
    pointer: pointer ? readPointerControls(pointer) : null,
    keyboard: keyboard ? readKeyboardControls(keyboard) : null
  };
}

function readPointerControls(node: TypeGpuNode): TypeGpuPointerControls {
  return {
    dragButton: stringOption(
      node.attributes.dragButton,
      ['primary', 'middle', 'secondary'],
      DEFAULT_POINTER_CONTROLS.dragButton
    ),
    rotateSpeed: clampedNumberArg(node.attributes.rotateSpeed, 1, 0, 100),
    wheel: stringOption(node.attributes.wheel, ['zoom', 'none'], DEFAULT_POINTER_CONTROLS.wheel),
    zoomSpeed: clampedNumberArg(node.attributes.zoomSpeed, 1, 0, 100),
    touch: stringOption(
      node.attributes.touch,
      ['orbit-pinch', 'orbit', 'pinch', 'none'],
      DEFAULT_POINTER_CONTROLS.touch
    )
  };
}

function readKeyboardControls(node: TypeGpuNode): TypeGpuKeyboardControls {
  return {
    rotateLeft: stringArg(node.attributes.rotateLeft, DEFAULT_KEYBOARD_CONTROLS.rotateLeft),
    rotateRight: stringArg(node.attributes.rotateRight, DEFAULT_KEYBOARD_CONTROLS.rotateRight),
    rotateUp: stringArg(node.attributes.rotateUp, DEFAULT_KEYBOARD_CONTROLS.rotateUp),
    rotateDown: stringArg(node.attributes.rotateDown, DEFAULT_KEYBOARD_CONTROLS.rotateDown),
    zoomIn: stringArg(node.attributes.zoomIn, DEFAULT_KEYBOARD_CONTROLS.zoomIn),
    zoomOut: stringArg(node.attributes.zoomOut, DEFAULT_KEYBOARD_CONTROLS.zoomOut),
    step: clampedNumberArg(node.attributes.step, DEFAULT_KEYBOARD_CONTROLS.step, 0, 10)
  };
}

function firstChildNamed(node: TypeGpuNode, name: string): TypeGpuNode | null {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) return child;
  }

  return null;
}

function stringArg(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.length > 0 ? value : fallback;
}

function stringOption<const T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T
): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback;
}
```

- [ ] **Step 5: Pass camera metadata through scene state**

Modify `src/lib/typegpu-renderer/scene-state.ts` imports:

```ts
import { readPerspectiveCameraState } from './component-helpers/perspective-camera';
```

Inside `createSceneState(...)`, before the return, add:

```ts
  const camera = readPerspectiveCameraState(root);
```

Update the return object:

```ts
  return {
    camera: camera.settings,
    cameraNode: camera.node,
    cameraController: camera.controller,
    scale: scene.scale,
    animationSpeed: scene.animationSpeed,
    colorShift: scene.colorShift,
    lights,
    lightsChanged: !options.reuseLights,
    drawBatches
  };
```

- [ ] **Step 6: Keep camera-control dirtiness isolated**

Modify `src/lib/typegpu-renderer/scene-dirtiness.ts` imports:

```ts
import { isCameraControlNode } from './component-helpers/perspective-camera';
```

Update both dirtiness functions:

```ts
export function draw-batch invalidation helper(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) {
    return !isCameraControlNode(dirtyNode);
  }

  if (dirtyNode.name === 'group') {
    return subtreeHasMeshNode(dirtyNode);
  }

  return (
    dirtyNode.name !== 'scene' &&
    !isCameraControlNode(dirtyNode) &&
    !isSupportedLightNode(dirtyNode)
  );
}

export function light invalidation helper(
  root: TypeGpuNode,
  dirtyNode: TypeGpuNode | undefined,
  syncedTreeRevision: number
): boolean {
  if (!dirtyNode) return true;
  if (root.treeRevision !== syncedTreeRevision) {
    return !isCameraControlNode(dirtyNode);
  }
  if (isCameraControlNode(dirtyNode)) return false;
  if (isSupportedLightNode(dirtyNode)) return true;

  return dirtyNode.name === 'group' && subtreeHasSupportedLight(dirtyNode);
}
```

- [ ] **Step 7: Run tests and commit**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/core.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/typegpu-renderer/types.ts src/lib/typegpu-renderer/component-helpers/perspective-camera.ts src/lib/typegpu-renderer/scene-state.ts src/lib/typegpu-renderer/scene-dirtiness.ts src/lib/typegpu-renderer/core.test.ts
git commit -m "Add declarative camera control parsing"
```

## Task 2: Add Pure Orbit Camera Math

**Files:**
- Create: `src/lib/typegpu-renderer/camera-orbit.ts`
- Create: `src/lib/typegpu-renderer/camera-orbit.test.ts`

- [ ] **Step 1: Write failing orbit math tests**

Create `src/lib/typegpu-renderer/camera-orbit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cameraFromOrbit,
  deriveOrbitState,
  normalizeWheelDelta,
  rotateOrbit,
  zoomOrbit
} from './camera-orbit';

describe('TypeGPU orbit camera math', () => {
  const camera = {
    position: [0, 1.4, 5] as [number, number, number],
    lookAt: [0, 0, 0] as [number, number, number],
    fov: 45,
    near: 0.1,
    far: 500
  };

  it('derives orbit state from camera position and lookAt', () => {
    const state = deriveOrbitState(camera, { minDistance: 1, maxDistance: 100 });

    expect(state.lookAt).toEqual([0, 0, 0]);
    expect(state.radius).toBeCloseTo(5.1923);
    expect(state.yaw).toBeCloseTo(0);
    expect(state.pitch).toBeCloseTo(0.2730);
  });

  it('reconstructs camera settings from orbit state', () => {
    const state = deriveOrbitState(camera, { minDistance: 1, maxDistance: 100 });
    const nextCamera = cameraFromOrbit(state, camera);

    expect(nextCamera.position[0]).toBeCloseTo(0);
    expect(nextCamera.position[1]).toBeCloseTo(1.4);
    expect(nextCamera.position[2]).toBeCloseTo(5);
    expect(nextCamera.lookAt).toEqual([0, 0, 0]);
    expect(nextCamera.fov).toBe(45);
    expect(nextCamera.near).toBe(0.1);
    expect(nextCamera.far).toBe(500);
  });

  it('rotates orbit yaw and pitch with clamping', () => {
    const state = deriveOrbitState(camera, { minDistance: 1, maxDistance: 100 });
    const rotated = rotateOrbit(state, 100, -40, {
      invert: false,
      rotateSpeed: 1,
      minDistance: 1,
      maxDistance: 100
    });

    expect(rotated.radius).toBeCloseTo(state.radius);
    expect(rotated.yaw).toBeCloseTo(-0.5);
    expect(rotated.pitch).toBeCloseTo(0.0730);
  });

  it('zooms orbit radius within constraints', () => {
    const state = deriveOrbitState(camera, { minDistance: 4, maxDistance: 6 });

    expect(zoomOrbit(state, 100, { minDistance: 4, maxDistance: 6, zoomSpeed: 1 }).radius).toBe(6);
    expect(zoomOrbit(state, -100, { minDistance: 4, maxDistance: 6, zoomSpeed: 1 }).radius).toBe(4);
  });

  it('normalizes and clamps wheel deltas', () => {
    expect(normalizeWheelDelta(3, 1, 800)).toBe(48);
    expect(normalizeWheelDelta(1, 2, 800)).toBe(60);
    expect(normalizeWheelDelta(500, 0, 800)).toBe(60);
    expect(normalizeWheelDelta(-500, 0, 800)).toBe(-60);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-orbit.test.ts
```

Expected: FAIL because `camera-orbit.ts` does not exist.

- [ ] **Step 3: Implement pure orbit math**

Create `src/lib/typegpu-renderer/camera-orbit.ts`:

```ts
import type { TypeGpuCameraSettings, Vector3Tuple } from './types';

const ORBIT_SENSITIVITY = 0.005;
const ZOOM_SENSITIVITY = 0.05;
const MIN_PITCH = -Math.PI / 2 + 0.01;
const MAX_PITCH = Math.PI / 2 - 0.01;
const WHEEL_DELTA_PIXEL = 0;
const WHEEL_DELTA_LINE = 1;
const WHEEL_DELTA_PAGE = 2;
const MAX_WHEEL_DELTA = 60;

export interface TypeGpuOrbitConstraints {
  minDistance: number;
  maxDistance: number;
}

export interface TypeGpuOrbitState {
  lookAt: Vector3Tuple;
  radius: number;
  yaw: number;
  pitch: number;
}

export interface TypeGpuOrbitRotateOptions extends TypeGpuOrbitConstraints {
  invert: boolean;
  rotateSpeed: number;
}

export interface TypeGpuOrbitZoomOptions extends TypeGpuOrbitConstraints {
  zoomSpeed: number;
}

export function deriveOrbitState(
  camera: TypeGpuCameraSettings,
  constraints: TypeGpuOrbitConstraints
): TypeGpuOrbitState {
  const safeConstraints = normalizeConstraints(constraints);
  const dx = camera.position[0] - camera.lookAt[0];
  const dy = camera.position[1] - camera.lookAt[1];
  const dz = camera.position[2] - camera.lookAt[2];
  const rawRadius = Math.hypot(dx, dy, dz);
  const radius = clamp(rawRadius || safeConstraints.minDistance, safeConstraints.minDistance, safeConstraints.maxDistance);

  if (rawRadius <= 1e-6) {
    return {
      lookAt: [...camera.lookAt],
      radius,
      yaw: 0,
      pitch: 0
    };
  }

  return {
    lookAt: [...camera.lookAt],
    radius,
    yaw: Math.atan2(dx, dz),
    pitch: clamp(Math.asin(dy / rawRadius), MIN_PITCH, MAX_PITCH)
  };
}

export function cameraFromOrbit(
  orbit: TypeGpuOrbitState,
  baseCamera: TypeGpuCameraSettings
): TypeGpuCameraSettings {
  const horizontal = Math.cos(orbit.pitch);
  const position: Vector3Tuple = [
    roundCameraValue(orbit.lookAt[0] + orbit.radius * Math.sin(orbit.yaw) * horizontal),
    roundCameraValue(orbit.lookAt[1] + orbit.radius * Math.sin(orbit.pitch)),
    roundCameraValue(orbit.lookAt[2] + orbit.radius * Math.cos(orbit.yaw) * horizontal)
  ];

  return {
    ...baseCamera,
    position,
    lookAt: [...orbit.lookAt]
  };
}

export function rotateOrbit(
  orbit: TypeGpuOrbitState,
  dx: number,
  dy: number,
  options: TypeGpuOrbitRotateOptions
): TypeGpuOrbitState {
  const direction = options.invert ? -1 : 1;

  return {
    ...orbit,
    yaw: orbit.yaw + -dx * ORBIT_SENSITIVITY * options.rotateSpeed * direction,
    pitch: clamp(
      orbit.pitch + dy * ORBIT_SENSITIVITY * options.rotateSpeed * direction,
      MIN_PITCH,
      MAX_PITCH
    )
  };
}

export function zoomOrbit(
  orbit: TypeGpuOrbitState,
  delta: number,
  options: TypeGpuOrbitZoomOptions
): TypeGpuOrbitState {
  const constraints = normalizeConstraints(options);

  return {
    ...orbit,
    radius: clamp(
      orbit.radius + delta * ZOOM_SENSITIVITY * options.zoomSpeed,
      constraints.minDistance,
      constraints.maxDistance
    )
  };
}

export function normalizeWheelDelta(deltaY: number, deltaMode: number, pageHeight: number): number {
  let delta = deltaY;

  if (deltaMode === WHEEL_DELTA_LINE) {
    delta *= 16;
  } else if (deltaMode === WHEEL_DELTA_PAGE) {
    delta *= pageHeight;
  }

  return Math.sign(delta) * Math.min(Math.abs(delta), MAX_WHEEL_DELTA);
}

function normalizeConstraints(constraints: TypeGpuOrbitConstraints): TypeGpuOrbitConstraints {
  if (constraints.minDistance > 0 && constraints.maxDistance >= constraints.minDistance) {
    return constraints;
  }

  return { minDistance: 1, maxDistance: 100 };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function roundCameraValue(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-orbit.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/typegpu-renderer/camera-orbit.ts src/lib/typegpu-renderer/camera-orbit.test.ts
git commit -m "Add TypeGPU orbit camera math"
```

## Task 3: Add Runtime Camera Interaction Lifecycle

**Files:**
- Create: `src/lib/typegpu-renderer/camera-interaction.ts`
- Create: `src/lib/typegpu-renderer/camera-interaction.test.ts`
- Modify: `src/lib/typegpu-renderer/gpu-renderer.ts`
- Modify: `src/lib/typegpu-renderer/svelte-renderer.ts`
- Test: `src/lib/typegpu-renderer/gpu-renderer.test.ts`

- [ ] **Step 1: Write failing lifecycle tests**

Create `src/lib/typegpu-renderer/camera-interaction.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { addEventListener, createElement, dispatchNodeEvent } from './core';
import { createCameraInteractionController } from './camera-interaction';
import type { TypeGpuSceneState } from './types';

describe('TypeGPU camera interaction controller', () => {
  it('attaches pointer listeners only for active pointer controls', () => {
    const canvas = new FakeEventTarget({ clientHeight: 600 });
    const windowTarget = new FakeEventTarget();
    const renderer = { setCamera: vi.fn() };
    const controller = createCameraInteractionController({
      canvas: canvas.asCanvas(),
      windowTarget: windowTarget.asWindow(),
      renderer,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn()
    });

    controller.reconcile(sceneState({ pointer: true }));

    expect(canvas.listenerCount('wheel')).toBe(1);
    expect(canvas.listenerCount('mousedown')).toBe(1);
    expect(canvas.listenerCount('touchstart')).toBe(1);
    expect(canvas.listenerCount('touchmove')).toBe(1);
    expect(windowTarget.listenerCount('mousemove')).toBe(1);
    expect(windowTarget.listenerCount('mouseup')).toBe(1);
    expect(windowTarget.listenerCount('touchmove')).toBe(1);
    expect(windowTarget.listenerCount('touchend')).toBe(1);

    controller.reconcile(sceneState({ pointer: false }));

    expect(canvas.listenerCount('wheel')).toBe(0);
    expect(canvas.listenerCount('mousedown')).toBe(0);
    expect(canvas.listenerCount('touchstart')).toBe(0);
    expect(canvas.listenerCount('touchmove')).toBe(0);
    expect(windowTarget.listenerCount('mousemove')).toBe(0);
    expect(windowTarget.listenerCount('mouseup')).toBe(0);
    expect(windowTarget.listenerCount('touchmove')).toBe(0);
    expect(windowTarget.listenerCount('touchend')).toBe(0);
  });

  it('removes camera listeners on dispose', () => {
    const canvas = new FakeEventTarget({ clientHeight: 600 });
    const windowTarget = new FakeEventTarget();
    const controller = createCameraInteractionController({
      canvas: canvas.asCanvas(),
      windowTarget: windowTarget.asWindow(),
      renderer: { setCamera: vi.fn() },
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn()
    });

    controller.reconcile(sceneState({ pointer: true }));
    controller.dispose();

    expect(canvas.listenerCount('wheel')).toBe(0);
    expect(windowTarget.listenerCount('mousemove')).toBe(0);
  });
});

class FakeEventTarget {
  clientHeight: number;
  private listeners = new Map<string, Set<EventListener>>();

  constructor(options: { clientHeight?: number } = {}) {
    this.clientHeight = options.clientHeight ?? 0;
  }

  addEventListener(type: string, listener: EventListener): void {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener): void {
    this.listeners.get(type)?.delete(listener);
  }

  dispatch(type: string, event: Event): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }

  asCanvas(): HTMLCanvasElement {
    return this as unknown as HTMLCanvasElement;
  }

  asWindow(): Window {
    return this as unknown as Window;
  }
}

function sceneState({ pointer }: { pointer: boolean }): TypeGpuSceneState {
  const cameraNode = createElement('perspectiveCamera');

  return {
    camera: {
      position: [0, 1.4, 5],
      lookAt: [0, 0, 0],
      fov: 45,
      near: 0.1,
      far: 500
    },
    cameraNode,
    cameraController: pointer
      ? {
          kind: 'orbit',
          minDistance: 1,
          maxDistance: 100,
          invert: false,
          pointer: {
            dragButton: 'primary',
            rotateSpeed: 1,
            wheel: 'zoom',
            zoomSpeed: 1,
            touch: 'orbit-pinch'
          },
          keyboard: null
        }
      : null,
    scale: 1,
    animationSpeed: 1,
    colorShift: 0,
    lights: [],
    lightsChanged: false,
    drawBatches: []
  };
}
```

Add this source assertion to `src/lib/typegpu-renderer/gpu-renderer.test.ts`:

```ts
  it('exposes a narrow camera update method for runtime controls', () => {
    expect(rendererSource).toContain('setCamera(camera: TypeGpuCameraSettings): void');
    expect(rendererSource).toContain('setCamera(camera: TypeGpuCameraSettings): void {');
    expect(rendererSource).toContain('this.setCamera(scene.camera);');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-interaction.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: FAIL because the interaction controller and `setCamera(...)` do not exist yet.

- [ ] **Step 3: Add `setCamera(...)` to the GPU renderer**

In `src/lib/typegpu-renderer/gpu-renderer.ts`, update `TypeGpuRenderer`:

```ts
export interface TypeGpuRenderer {
  setScene(scene: TypeGpuSceneState): void;
  setCamera(camera: TypeGpuCameraSettings): void;
  dispose(): void;
}
```

In `TypeGpuSceneRenderer`, add:

```ts
  setCamera(camera: TypeGpuCameraSettings): void {
    if (this.#disposed) return;

    this.#camera = camera;
    this.#projectionDirty = true;
  }
```

In `setScene(...)`, replace:

```ts
    this.#camera = scene.camera;
    this.#projectionDirty = true;
```

with:

```ts
    this.setCamera(scene.camera);
```

In the constructor's initial `this.setScene(...)` call, add the new scene-state fields:

```ts
      cameraNode: null,
      cameraController: null,
```

- [ ] **Step 4: Implement listener lifecycle without movement behavior**

Create `src/lib/typegpu-renderer/camera-interaction.ts`:

```ts
import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuSceneState } from './types';

type FrameRequest = (callback: FrameRequestCallback) => number;
type FrameCancel = (handle: number) => void;

export interface TypeGpuCameraInteractionOptions {
  canvas: HTMLCanvasElement;
  windowTarget?: Window;
  renderer: Pick<TypeGpuRenderer, 'setCamera'>;
  requestFrame?: FrameRequest;
  cancelFrame?: FrameCancel;
}

export interface TypeGpuCameraInteractionController {
  reconcile(scene: TypeGpuSceneState): void;
  dispose(): void;
}

export function createCameraInteractionController({
  canvas,
  windowTarget = window,
  renderer,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame
}: TypeGpuCameraInteractionOptions): TypeGpuCameraInteractionController {
  let detachPointerControls: (() => void) | null = null;
  let frame = 0;

  function reconcile(scene: TypeGpuSceneState): void {
    const pointer = scene.cameraController?.kind === 'orbit' ? scene.cameraController.pointer : null;

    if (!pointer || !scene.cameraNode) {
      detach();
      return;
    }

    if (detachPointerControls) return;

    const wheel = (event: Event) => {
      event.preventDefault();
      scheduleCameraWrite(scene);
    };
    const mouseDown = () => {};
    const mouseMove = () => {};
    const mouseUp = () => {};
    const touchStart = (event: Event) => {
      event.preventDefault();
    };
    const touchMove = (event: Event) => {
      event.preventDefault();
      scheduleCameraWrite(scene);
    };
    const touchEnd = () => {};

    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('touchstart', touchStart, { passive: false });
    canvas.addEventListener('touchmove', touchMove, { passive: false });
    windowTarget.addEventListener('mousemove', mouseMove);
    windowTarget.addEventListener('mouseup', mouseUp);
    windowTarget.addEventListener('touchmove', touchMove, { passive: false });
    windowTarget.addEventListener('touchend', touchEnd);

    detachPointerControls = () => {
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('mousedown', mouseDown);
      canvas.removeEventListener('touchstart', touchStart);
      canvas.removeEventListener('touchmove', touchMove);
      windowTarget.removeEventListener('mousemove', mouseMove);
      windowTarget.removeEventListener('mouseup', mouseUp);
      windowTarget.removeEventListener('touchmove', touchMove);
      windowTarget.removeEventListener('touchend', touchEnd);
    };
  }

  function scheduleCameraWrite(scene: TypeGpuSceneState): void {
    if (frame) return;

    frame = requestFrame(() => {
      frame = 0;
      renderer.setCamera(scene.camera);
    });
  }

  function detach(): void {
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }

    detachPointerControls?.();
    detachPointerControls = null;
  }

  return {
    reconcile,
    dispose: detach
  };
}
```

- [ ] **Step 5: Wire the interaction controller into the Svelte renderer runtime**

In `src/lib/typegpu-renderer/svelte-renderer.ts`, add:

```ts
import { createCameraInteractionController } from './camera-interaction';
```

Inside `createRuntime(...)`, after `const sceneCache = createTypeGpuSceneCache();`, add:

```ts
  const cameraInteraction = createCameraInteractionController({ canvas, renderer: gpu });
```

In the queued microtask, replace the inline `gpu.setScene(createSceneState(...))` with:

```ts
      const scene = createSceneState(root, sceneCache, {
        reuseDrawBatches: !drawBatchesDirty,
        reuseLights: !lightsDirty
      });

      gpu.setScene(scene);
      cameraInteraction.reconcile(scene);
```

In `dispose()`, add:

```ts
      cameraInteraction.dispose();
```

before `gpu.dispose();`.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-interaction.test.ts src/lib/typegpu-renderer/gpu-renderer.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/typegpu-renderer/camera-interaction.ts src/lib/typegpu-renderer/camera-interaction.test.ts src/lib/typegpu-renderer/gpu-renderer.ts src/lib/typegpu-renderer/gpu-renderer.test.ts src/lib/typegpu-renderer/svelte-renderer.ts
git commit -m "Wire camera interaction lifecycle"
```

## Task 4: Implement Pointer, Wheel, Touch, And Camera Events

**Files:**
- Modify: `src/lib/typegpu-renderer/camera-interaction.ts`
- Modify: `src/lib/typegpu-renderer/camera-interaction.test.ts`

- [ ] **Step 1: Add failing interaction tests**

Extend `src/lib/typegpu-renderer/camera-interaction.test.ts`.

Update the imports:

```ts
import { addEventListener, createElement } from './core';
```

Add these tests inside the existing `describe(...)`:

```ts
  it('zooms the camera with wheel input and dispatches camerachange', () => {
    const canvas = new FakeEventTarget({ clientHeight: 600 });
    const renderer = { setCamera: vi.fn() };
    const controller = createCameraInteractionController({
      canvas: canvas.asCanvas(),
      windowTarget: new FakeEventTarget().asWindow(),
      renderer,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn()
    });
    const state = sceneState({ pointer: true });
    const onCameraChange = vi.fn();
    addEventListener(state.cameraNode!, 'camerachange', onCameraChange);

    controller.reconcile(state);
    canvas.dispatch('wheel', fakeWheelEvent({ deltaY: 60, deltaMode: 0 }));

    expect(renderer.setCamera).toHaveBeenCalledWith(
      expect.objectContaining({
        position: [0, expect.any(Number), expect.any(Number)],
        lookAt: [0, 0, 0],
        fov: 45,
        near: 0.1,
        far: 500
      })
    );
    expect(renderer.setCamera.mock.calls[0][0].position[2]).toBeGreaterThan(5);
    expect(onCameraChange).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'camerachange',
        detail: expect.objectContaining({
          camera: expect.objectContaining({
            lookAt: [0, 0, 0]
          }),
          orbit: expect.objectContaining({
            radius: expect.any(Number),
            yaw: expect.any(Number),
            pitch: expect.any(Number)
          })
        })
      })
    );
  });

  it('rotates the camera with primary mouse drag', () => {
    const canvas = new FakeEventTarget({ clientHeight: 600 });
    const windowTarget = new FakeEventTarget();
    const renderer = { setCamera: vi.fn() };
    const controller = createCameraInteractionController({
      canvas: canvas.asCanvas(),
      windowTarget: windowTarget.asWindow(),
      renderer,
      requestFrame: (callback) => {
        callback(0);
        return 1;
      },
      cancelFrame: vi.fn()
    });

    controller.reconcile(sceneState({ pointer: true }));
    canvas.dispatch('mousedown', fakeMouseEvent({ clientX: 10, clientY: 20, button: 0 }));
    windowTarget.dispatch('mousemove', fakeMouseEvent({ clientX: 110, clientY: 20, button: 0 }));

    expect(renderer.setCamera).toHaveBeenCalledOnce();
    expect(renderer.setCamera.mock.calls[0][0].position[0]).toBeLessThan(0);
  });
```

Add these helpers at the bottom of the test file:

```ts
function fakeWheelEvent({
  deltaY,
  deltaMode
}: {
  deltaY: number;
  deltaMode: number;
}): WheelEvent {
  return {
    deltaY,
    deltaMode,
    preventDefault: vi.fn()
  } as unknown as WheelEvent;
}

function fakeMouseEvent({
  clientX,
  clientY,
  button
}: {
  clientX: number;
  clientY: number;
  button: number;
}): MouseEvent {
  return {
    clientX,
    clientY,
    button,
    preventDefault: vi.fn()
  } as unknown as MouseEvent;
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-interaction.test.ts
```

Expected: FAIL because current handlers attach listeners but do not update orbit state or dispatch camera events.

- [ ] **Step 3: Implement pointer interaction behavior**

Replace `src/lib/typegpu-renderer/camera-interaction.ts` with:

```ts
import { dispatchNodeEvent } from './core';
import {
  cameraFromOrbit,
  deriveOrbitState,
  normalizeWheelDelta,
  rotateOrbit,
  zoomOrbit,
  type TypeGpuOrbitState
} from './camera-orbit';
import type { TypeGpuRenderer } from './gpu-renderer';
import type { TypeGpuCameraSettings, TypeGpuPointerControls, TypeGpuSceneState } from './types';

type FrameRequest = (callback: FrameRequestCallback) => number;
type FrameCancel = (handle: number) => void;

export interface TypeGpuCameraInteractionOptions {
  canvas: HTMLCanvasElement;
  windowTarget?: Window;
  renderer: Pick<TypeGpuRenderer, 'setCamera'>;
  requestFrame?: FrameRequest;
  cancelFrame?: FrameCancel;
}

export interface TypeGpuCameraInteractionController {
  reconcile(scene: TypeGpuSceneState): void;
  dispose(): void;
}

export function createCameraInteractionController({
  canvas,
  windowTarget = window,
  renderer,
  requestFrame = requestAnimationFrame,
  cancelFrame = cancelAnimationFrame
}: TypeGpuCameraInteractionOptions): TypeGpuCameraInteractionController {
  let detachPointerControls: (() => void) | null = null;
  let frame = 0;
  let activeScene: TypeGpuSceneState | null = null;
  let activePointer: TypeGpuPointerControls | null = null;
  let orbit: TypeGpuOrbitState | null = null;
  let nextCamera: TypeGpuCameraSettings | null = null;
  let lastEvent: Event | undefined;
  let isDragging = false;
  let prevX = 0;
  let prevY = 0;
  let lastPinchDistance = 0;

  function reconcile(scene: TypeGpuSceneState): void {
    activeScene = scene;
    activePointer = scene.cameraController?.kind === 'orbit' ? scene.cameraController.pointer : null;

    if (!activePointer || !scene.cameraNode) {
      detach();
      return;
    }

    orbit = deriveOrbitState(scene.camera, {
      minDistance: scene.cameraController!.minDistance,
      maxDistance: scene.cameraController!.maxDistance
    });

    if (detachPointerControls) return;

    const wheel = (event: Event) => handleWheel(event as WheelEvent);
    const mouseDown = (event: Event) => handleMouseDown(event as MouseEvent);
    const mouseMove = (event: Event) => handleMouseMove(event as MouseEvent);
    const mouseUp = () => {
      isDragging = false;
    };
    const touchStart = (event: Event) => handleTouchStart(event as TouchEvent);
    const touchMove = (event: Event) => handleTouchMove(event as TouchEvent);
    const touchEnd = (event: Event) => handleTouchEnd(event as TouchEvent);

    canvas.addEventListener('wheel', wheel, { passive: false });
    canvas.addEventListener('mousedown', mouseDown);
    canvas.addEventListener('touchstart', touchStart, { passive: false });
    canvas.addEventListener('touchmove', touchMove, { passive: false });
    windowTarget.addEventListener('mousemove', mouseMove);
    windowTarget.addEventListener('mouseup', mouseUp);
    windowTarget.addEventListener('touchmove', touchMove, { passive: false });
    windowTarget.addEventListener('touchend', touchEnd);

    detachPointerControls = () => {
      canvas.removeEventListener('wheel', wheel);
      canvas.removeEventListener('mousedown', mouseDown);
      canvas.removeEventListener('touchstart', touchStart);
      canvas.removeEventListener('touchmove', touchMove);
      windowTarget.removeEventListener('mousemove', mouseMove);
      windowTarget.removeEventListener('mouseup', mouseUp);
      windowTarget.removeEventListener('touchmove', touchMove);
      windowTarget.removeEventListener('touchend', touchEnd);
    };
  }

  function handleWheel(event: WheelEvent): void {
    if (!activeScene?.cameraController || !activePointer || !orbit || activePointer.wheel === 'none') {
      return;
    }

    event.preventDefault();
    orbit = zoomOrbit(
      orbit,
      normalizeWheelDelta(event.deltaY, event.deltaMode, canvas.clientHeight),
      {
        minDistance: activeScene.cameraController.minDistance,
        maxDistance: activeScene.cameraController.maxDistance,
        zoomSpeed: activePointer.zoomSpeed
      }
    );
    queueCameraUpdate(event);
  }

  function handleMouseDown(event: MouseEvent): void {
    if (!activePointer || mouseButtonName(event.button) !== activePointer.dragButton) return;

    isDragging = true;
    prevX = event.clientX;
    prevY = event.clientY;
  }

  function handleMouseMove(event: MouseEvent): void {
    if (!isDragging || !activeScene?.cameraController || !activePointer || !orbit) return;

    const dx = event.clientX - prevX;
    const dy = event.clientY - prevY;
    prevX = event.clientX;
    prevY = event.clientY;
    orbit = rotateOrbit(orbit, dx, dy, {
      minDistance: activeScene.cameraController.minDistance,
      maxDistance: activeScene.cameraController.maxDistance,
      invert: activeScene.cameraController.invert,
      rotateSpeed: activePointer.rotateSpeed
    });
    queueCameraUpdate(event);
  }

  function handleTouchStart(event: TouchEvent): void {
    if (!activePointer || activePointer.touch === 'none') return;

    event.preventDefault();

    if (event.touches.length === 1 && activePointer.touch !== 'pinch') {
      isDragging = true;
      prevX = event.touches[0].clientX;
      prevY = event.touches[0].clientY;
    } else if (event.touches.length === 2 && activePointer.touch !== 'orbit') {
      isDragging = false;
      lastPinchDistance = touchDistance(event);
    }
  }

  function handleTouchMove(event: TouchEvent): void {
    if (!activeScene?.cameraController || !activePointer || !orbit || activePointer.touch === 'none') {
      return;
    }

    if (event.touches.length === 1 && isDragging && activePointer.touch !== 'pinch') {
      event.preventDefault();
      const dx = event.touches[0].clientX - prevX;
      const dy = event.touches[0].clientY - prevY;
      prevX = event.touches[0].clientX;
      prevY = event.touches[0].clientY;
      orbit = rotateOrbit(orbit, dx, dy, {
        minDistance: activeScene.cameraController.minDistance,
        maxDistance: activeScene.cameraController.maxDistance,
        invert: activeScene.cameraController.invert,
        rotateSpeed: activePointer.rotateSpeed
      });
      queueCameraUpdate(event);
    } else if (event.touches.length === 2 && activePointer.touch !== 'orbit') {
      event.preventDefault();
      const pinchDistance = touchDistance(event);
      orbit = zoomOrbit(orbit, (lastPinchDistance - pinchDistance) * 0.5, {
        minDistance: activeScene.cameraController.minDistance,
        maxDistance: activeScene.cameraController.maxDistance,
        zoomSpeed: activePointer.zoomSpeed
      });
      lastPinchDistance = pinchDistance;
      queueCameraUpdate(event);
    }
  }

  function handleTouchEnd(event: TouchEvent): void {
    if (event.touches.length === 1) {
      isDragging = true;
      prevX = event.touches[0].clientX;
      prevY = event.touches[0].clientY;
    } else {
      isDragging = false;
    }
  }

  function queueCameraUpdate(event: Event): void {
    if (!activeScene || !orbit) return;

    nextCamera = cameraFromOrbit(orbit, activeScene.camera);
    lastEvent = event;

    if (frame) return;

    frame = requestFrame(() => {
      frame = 0;
      flushCameraUpdate();
    });
  }

  function flushCameraUpdate(): void {
    if (!activeScene?.cameraNode || !nextCamera || !orbit) return;

    renderer.setCamera(nextCamera);
    dispatchNodeEvent(activeScene.cameraNode, 'camerachange', {
      detail: {
        camera: nextCamera,
        orbit: {
          radius: orbit.radius,
          yaw: orbit.yaw,
          pitch: orbit.pitch
        }
      },
      originalEvent: lastEvent
    });
    activeScene = {
      ...activeScene,
      camera: nextCamera
    };
  }

  function detach(): void {
    if (frame) {
      cancelFrame(frame);
      frame = 0;
    }

    detachPointerControls?.();
    detachPointerControls = null;
    activeScene = null;
    activePointer = null;
    orbit = null;
    nextCamera = null;
    lastEvent = undefined;
    isDragging = false;
  }

  return {
    reconcile,
    dispose: detach
  };
}

function mouseButtonName(button: number): TypeGpuPointerControls['dragButton'] {
  if (button === 1) return 'middle';
  if (button === 2) return 'secondary';
  return 'primary';
}

function touchDistance(event: TouchEvent): number {
  const dx = event.touches[0].clientX - event.touches[1].clientX;
  const dy = event.touches[0].clientY - event.touches[1].clientY;
  return Math.hypot(dx, dy);
}
```

- [ ] **Step 4: Run tests and commit**

Run:

```bash
npm run test -- src/lib/typegpu-renderer/camera-interaction.test.ts src/lib/typegpu-renderer/camera-orbit.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/typegpu-renderer/camera-interaction.ts src/lib/typegpu-renderer/camera-interaction.test.ts
git commit -m "Implement pointer orbit camera controls"
```

## Task 5: Migrate Demo Camera State And Scene Authoring

**Files:**
- Modify: `src/lib/scene-controls.ts`
- Modify: `src/lib/scene-controls.test.ts`
- Modify: `src/Scene.typegpu.svelte`
- Modify: `src/Scene.typegpu.test.ts`
- Modify: `src/TypeGpuCanvas.svelte`
- Modify: `src/App.svelte`

- [ ] **Step 1: Write failing demo-state tests**

In `src/lib/scene-controls.test.ts`, update imports to remove `cameraLookAt` and add `applyCameraChange`:

```ts
import {
  applyCameraChange,
  cameraControlsForCount,
  clampSceneControls,
  DEFAULT_SCENE_CONTROLS,
  formatHueColor,
  nextHue,
  type SceneControls
} from './scene-controls';
```

Replace the `derives a look-at point from camera position and rotation` test with:

```ts
  it('stores lookAt directly in camera controls', () => {
    expect(DEFAULT_SCENE_CONTROLS.camera).toMatchObject({
      position: [0, 1.4, 5],
      lookAt: [0, 0, 0],
      fov: 45,
      near: 0.1,
      far: 500
    });
  });
```

Add:

```ts
  it('applies camera change events to scene controls', () => {
    const controls = clampSceneControls(DEFAULT_SCENE_CONTROLS);

    applyCameraChange(controls, {
      camera: {
        position: [1.25, 2.5, 7.75],
        lookAt: [0.5, 0.25, -0.5],
        fov: 55,
        near: 0.2,
        far: 300
      },
      orbit: {
        radius: 8,
        yaw: 0.25,
        pitch: 0.1
      }
    });

    expect(controls.camera).toEqual({
      position: [1.25, 2.5, 7.75],
      lookAt: [0.5, 0.25, -0.5],
      fov: 55,
      near: 0.2,
      far: 300
    });
  });
```

In `src/Scene.typegpu.test.ts`, remove `cameraLookAt` from imports and component loader arguments. Add assertions after the existing camera assertions:

```ts
    const orbit = onlyNamed(camera, 'orbitControls');
    const pointer = onlyNamed(orbit, 'pointerControls');
    const keyboard = onlyNamed(orbit, 'keyboardControls');

    expect(camera.attributes.lookAt).toEqual(controls.camera.lookAt);
    expect(orbit.attributes).toMatchObject({
      minDistance: 1,
      maxDistance: 100
    });
    expect(pointer.name).toBe('pointerControls');
    expect(keyboard.attributes).toMatchObject({
      rotateLeft: 'ArrowLeft',
      rotateRight: 'ArrowRight',
      rotateUp: 'ArrowUp',
      rotateDown: 'ArrowDown',
      zoomIn: '+',
      zoomOut: '-'
    });
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test -- src/lib/scene-controls.test.ts src/Scene.typegpu.test.ts
```

Expected: FAIL because demo camera state still uses rotation and the scene does not author camera controls.

- [ ] **Step 3: Update demo camera control model**

In `src/lib/scene-controls.ts`, replace `CameraRotationControls` and `CameraControls` with:

```ts
export interface CameraControls {
  position: Vector3Tuple;
  lookAt: Vector3Tuple;
  fov: number;
  near: number;
  far: number;
}

export interface CameraChangeDetail {
  camera: CameraControls;
  orbit: {
    radius: number;
    yaw: number;
    pitch: number;
  };
}
```

Update `copySceneControls(...)` camera copying:

```ts
  target.camera.position = next.camera.position;
  target.camera.lookAt = next.camera.lookAt;
  target.camera.fov = next.camera.fov;
  target.camera.near = next.camera.near;
  target.camera.far = next.camera.far;
```

Update `cameraControlsForCount(...)`:

```ts
export function cameraControlsForCount(count: number): CameraControls {
  const camera = sceneCameraForCount(count);

  return {
    position: [...camera.position],
    lookAt: [...camera.lookAt],
    fov: 45,
    near: 0.1,
    far: 500
  };
}
```

Add:

```ts
export function applyCameraChange(controls: SceneControls, detail: CameraChangeDetail): void {
  copySceneControls(controls, {
    ...controls,
    camera: detail.camera
  });
}
```

Update `clampCameraControls(...)`:

```ts
function clampCameraControls(camera: CameraControls): CameraControls {
  const near = round(clamp(camera.near, 0.01, 10));

  return {
    position: clampVector(camera.position, -1000, 1000),
    lookAt: clampVector(camera.lookAt, -1000, 1000),
    fov: round(clamp(camera.fov, 20, 100)),
    near,
    far: round(Math.max(clamp(camera.far, 0.1, 1000), near + 1))
  };
}
```

Remove `cameraLookAt(...)`, `rotationForLookAt(...)`, `toDegrees(...)`, and `toRadians(...)`.

- [ ] **Step 4: Update custom-rendered scene authoring**

In `src/Scene.typegpu.svelte`, update imports:

```svelte
  import { createCubeField } from './lib/cube-field';
  import { demoColorForIndex } from './lib/demo-colors';
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';
```

Update props:

```svelte
  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
    onCameraChange?: (detail: CameraChangeDetail) => void;
  }

  let { controls, onShapeClick = () => {}, onCameraChange = () => {} }: Props = $props();
```

Add:

```svelte
  function handleCameraChange(event: CustomEvent<CameraChangeDetail>) {
    onCameraChange(event.detail);
  }
```

Replace the camera node with:

```svelte
  <perspectiveCamera
    position={controls.camera.position}
    lookAt={controls.camera.lookAt}
    fov={controls.camera.fov}
    near={controls.camera.near}
    far={controls.camera.far}
    oncamerachange={handleCameraChange}
  >
    <orbitControls minDistance={1} maxDistance={100}>
      <pointerControls></pointerControls>
      <keyboardControls
        rotateLeft="ArrowLeft"
        rotateRight="ArrowRight"
        rotateUp="ArrowUp"
        rotateDown="ArrowDown"
        zoomIn="+"
        zoomOut="-"
      ></keyboardControls>
    </orbitControls>
  </perspectiveCamera>
```

- [ ] **Step 5: Pass camera-change events through the host Svelte app**

In `src/TypeGpuCanvas.svelte`, update imports:

```svelte
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';
```

Update props:

```svelte
  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
    onFps?: (fps: number) => void;
    onCameraChange?: (detail: CameraChangeDetail) => void;
  }

  let {
    controls,
    onShapeClick = () => {},
    onFps = () => {},
    onCameraChange = () => {}
  }: Props = $props();
```

Pass `onCameraChange` into `renderer.render(Scene, ...)` props:

```ts
          props: {
            controls,
            onShapeClick,
            onCameraChange
          }
```

In `src/App.svelte`, update imports:

```svelte
    applyCameraChange,
```

Add:

```svelte
  function syncCamera(detail: Parameters<typeof applyCameraChange>[1]) {
    applyCameraChange(controls, detail);
  }
```

Update the canvas:

```svelte
  <TypeGpuCanvas
    {controls}
    onShapeClick={shiftHue}
    onFps={(value) => (fps = value)}
    onCameraChange={syncCamera}
  />
```

Remove the entire Rotation slider stack from `src/App.svelte`. Keep FOV, Position, Near, Far, and Frame.

- [ ] **Step 6: Run tests and commit**

Run:

```bash
npm run test -- src/lib/scene-controls.test.ts src/Scene.typegpu.test.ts
```

Expected: PASS.

Commit:

```bash
git add src/lib/scene-controls.ts src/lib/scene-controls.test.ts src/Scene.typegpu.svelte src/Scene.typegpu.test.ts src/TypeGpuCanvas.svelte src/App.svelte
git commit -m "Use declarative orbit controls in demo"
```

## Task 6: Full Verification And Browser Check

**Files:**
- Verify all changed files.
- Modify only if tests or browser verification expose defects.

- [ ] **Step 1: Run full test suite**

Run:

```bash
npm run test
```

Expected: PASS.

- [ ] **Step 2: Run production build**

Run:

```bash
npm run build
```

Expected: PASS with Vite build output and no TypeScript errors.

- [ ] **Step 3: Start the dev server**

Run:

```bash
npm run dev -- --port 5173
```

Expected: Vite serves the app at `http://127.0.0.1:5173/`.

- [ ] **Step 4: Verify in browser**

Open `http://127.0.0.1:5173/` in the Codex in-app browser.

Check:

- The WebGPU canvas renders the scene.
- Dragging the canvas orbits the camera.
- Wheel input zooms.
- The Frame button resets the camera.
- FOV, Near, Far, and Position controls still update the camera.
- 1, 1k, and 10k count presets still render.
- No overlapping UI text appears after removing rotation controls.

- [ ] **Step 5: Stop the dev server**

Stop the `npm run dev` process from Step 3.

- [ ] **Step 6: Commit verification fixes if needed**

If Step 1, Step 2, or Step 4 required code changes, commit only those fixes:

```bash
git add src docs
git commit -m "Fix orbit camera verification issues"
```

If no fixes were needed, do not create an empty commit.

- [ ] **Step 7: Final status**

Run:

```bash
git status --short
```

Expected: no output.

Report the verification commands and browser checks in the final response.

## Self-Review

Spec coverage:

- Static `<perspectiveCamera>` behavior remains covered in Task 1 and existing tests.
- Declarative `<orbitControls>`, `<pointerControls>`, and `<keyboardControls>` parsing is covered in Task 1.
- Explicit input children and inert empty `<orbitControls>` are covered in Task 1.
- Continuous `camerachange` event shape is covered in Task 4.
- Runtime listener ownership and cleanup are covered in Task 3.
- Orbit math, clamping, and wheel normalization are covered in Task 2.
- Demo migration is covered in Task 5.
- Draw-batch and light dirtiness isolation is covered in Task 1.
- Browser verification is covered in Task 6.

Placeholder scan:

- The plan contains no placeholder markers or incomplete implementation notes.
- Keyboard interaction is deliberately parsed but not wired in this plan; that is an explicit first-slice scope choice from the approved design.

Type consistency:

- The public event is consistently `camerachange`.
- The camera target attribute remains consistently named `lookAt`.
- Renderer interaction uses `setCamera(camera: TypeGpuCameraSettings)` throughout.
- Scene metadata fields are consistently `cameraNode` and `cameraController`.
