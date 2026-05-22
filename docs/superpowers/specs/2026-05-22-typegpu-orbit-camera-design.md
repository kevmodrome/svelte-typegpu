# TypeGPU Orbit Camera Design

## Goal

Add an interactive camera model to the TypeGPU custom renderer while keeping one public camera element. A `<perspectiveCamera>` remains static by default. Optional child control elements add orbit behavior and explicit input methods.

The design should let apps:

- Author static cameras exactly as they do today.
- Add orbit interaction declaratively inside the camera node.
- Capture camera state continuously through `oncamerachange`.
- Extend the input model later without overloading camera props.

## Current State

The renderer already supports:

- A declarative `<perspectiveCamera>` node.
- Camera attributes: `position`, `lookAt`, `fov`, `near`, and `far`.
- `readPerspectiveCamera(root)`, which reads the first camera node into `TypeGpuCameraSettings`.
- `createViewProjectionMatrix(...)`, which builds the GPU view-projection matrix from camera settings.
- Runtime scene syncing through `createTypeGpuRoot(...)`.
- Canvas ownership in the custom-renderer runtime.

The demo currently stores camera position and rotation in DOM-side Svelte state, then derives a `lookAt` value for `<perspectiveCamera>`. Camera movement is controlled by sliders rather than direct canvas interaction.

## Recommended Approach

Keep `<perspectiveCamera>` as the only camera element. Add an `<orbitControls>` child element that can only affect its parent camera. Add explicit input child elements under `<orbitControls>`.

This keeps the API declarative and avoids splitting the camera model into separate static and orbit camera elements.

```svelte
<perspectiveCamera
  position={camera.position}
  lookAt={camera.lookAt}
  fov={camera.fov}
  near={camera.near}
  far={camera.far}
  oncamerachange={syncCamera}
>
  <orbitControls minDistance={1} maxDistance={100}>
    <pointerControls
      dragButton="primary"
      rotateSpeed={1}
      wheel="zoom"
      zoomSpeed={1}
      touch="orbit-pinch"
    />

    <keyboardControls
      rotateLeft="ArrowLeft"
      rotateRight="ArrowRight"
      rotateUp="ArrowUp"
      rotateDown="ArrowDown"
      zoomIn="+"
      zoomOut="-"
      step={0.08}
    />
  </orbitControls>
</perspectiveCamera>
```

`<orbitControls>` with no input children is inert. Input behavior is always declared by child nodes.

## Public API

### `<perspectiveCamera>`

The existing camera element remains the canonical camera authoring surface:

- `position`: `[x, y, z]`, default remains the existing default.
- `lookAt`: `[x, y, z]`, default remains `[0, 0, 0]`.
- `fov`: degrees, default remains `45`.
- `near`: default remains `0.1`.
- `far`: default remains the existing default.
- `oncamerachange`: optional event handler for interactive camera updates.

Without an `<orbitControls>` child, behavior is unchanged.

### `<orbitControls>`

`<orbitControls>` declares orbit state and constraints for its parent camera:

- `minDistance`: minimum orbit radius, default `1`.
- `maxDistance`: maximum orbit radius, default `100`.
- `invert`: optional boolean for inverted drag direction, default `false`.

It does not attach listeners directly. It is active only when it contains supported input children.

### `<pointerControls>`

`<pointerControls>` declares pointer, wheel, and touch input for the parent orbit controller:

- `dragButton`: `"primary"`, `"middle"`, or `"secondary"`, default `"primary"`.
- `rotateSpeed`: multiplier for drag rotation, default `1`.
- `wheel`: `"zoom"` or `"none"`, default `"zoom"`.
- `zoomSpeed`: multiplier for wheel and pinch zoom, default `1`.
- `touch`: `"orbit-pinch"`, `"orbit"`, `"pinch"`, or `"none"`, default `"orbit-pinch"`.

The first implementation should support primary-button drag, wheel zoom, one-finger touch orbit, and two-finger pinch zoom.

### `<keyboardControls>`

`<keyboardControls>` declares keyboard shortcut bindings for the parent orbit controller:

- `rotateLeft`
- `rotateRight`
- `rotateUp`
- `rotateDown`
- `zoomIn`
- `zoomOut`
- `step`

The API should be parsed and represented in scene state from the first implementation. Full keyboard interaction can be staged after pointer controls if needed.

## Camera Change Event

Camera interaction dispatches a continuous `camerachange` event on the `<perspectiveCamera>` node. Dispatch is throttled to animation frames so drag, wheel, touch, and future keyboard input can keep app state live without flooding synchronous events.

The event detail uses public camera state plus derived orbit state:

```ts
interface TypeGpuCameraChangeDetail {
  camera: {
    position: [number, number, number];
    lookAt: [number, number, number];
    fov: number;
    near: number;
    far: number;
  };
  orbit: {
    radius: number;
    yaw: number;
    pitch: number;
  };
}
```

The event does not expose GPU matrices as its primary contract. Matrices remain an internal rendering concern.

## State Ownership

Authored camera props are the source of initial state and external resets. When orbit controls become active, the runtime derives orbit state from the current `position` and `lookAt`:

- `radius`: distance from `lookAt` to `position`.
- `yaw`: horizontal angle around the target.
- `pitch`: vertical angle around the target.

During interaction, the runtime maintains transient orbit state and updates the renderer camera directly. It also dispatches `camerachange`.

If the app handles `oncamerachange` and writes the emitted camera back to Svelte state, the next render keeps authored props synchronized with the internal interactive state. If the app does not handle the event, the camera still moves for rendering, but the new state is not persisted outside the renderer.

If camera props change externally, the runtime re-derives orbit state from the new `position` and `lookAt`.

## Internal Architecture

The scene reader should extend camera parsing without changing draw-batch or lighting responsibilities.

Recommended shape:

```ts
interface TypeGpuCameraController {
  kind: 'orbit';
  minDistance: number;
  maxDistance: number;
  invert: boolean;
  pointer: TypeGpuPointerControls | null;
  keyboard: TypeGpuKeyboardControls | null;
}

interface TypeGpuCameraState {
  node: TypeGpuNode | null;
  settings: TypeGpuCameraSettings;
  controller: TypeGpuCameraController | null;
}
```

`TypeGpuSceneState` can then carry camera settings plus controller metadata. The GPU renderer should continue receiving ordinary camera settings for uniform updates. The custom-renderer runtime should own DOM listeners because it already owns the canvas, window listeners, scene root, and lifecycle cleanup.

On each scene sync, the runtime reconciles camera controls:

1. Read camera settings and camera controller metadata from scene state.
2. If there is no active orbit controller with input children, detach camera input listeners.
3. If there is an active orbit controller, attach the declared listeners.
4. Re-derive orbit state when authored camera props change.
5. For input events, update orbit state and schedule a camera update for the next animation frame.
6. Dispatch `camerachange` from the camera node and push updated camera settings to the GPU renderer.

This keeps the GPU renderer focused on rendering and avoids mixing DOM input code with TypeGPU buffer and pipeline code.

## Orbit Math

Orbit math should match the behavior of the TypeGPU camera example while using the renderer's existing tuple types.

Position from orbit state:

```ts
x = lookAt.x + radius * sin(yaw) * cos(pitch)
y = lookAt.y + radius * sin(pitch)
z = lookAt.z + radius * cos(yaw) * cos(pitch)
```

Rules:

- Clamp `radius` to `minDistance` and `maxDistance`.
- Clamp `pitch` to just inside `-PI / 2` and `PI / 2` to avoid singular look-at math.
- Normalize wheel delta modes for pixel, line, and page input.
- Clamp large wheel deltas to avoid large jumps.
- Keep `lookAt`, `fov`, `near`, and `far` unchanged during orbit input unless a future input child explicitly changes them.

## Interaction Behavior

Pointer controls:

- Primary-button drag rotates around `lookAt`.
- Wheel zoom changes orbit radius.
- One-finger touch rotates.
- Two-finger pinch zooms.
- Drag and touch movement should prevent default browser gestures only while the declared control is active.

Keyboard controls:

- The API is declarative from the first design.
- The first implementation may parse keyboard bindings without fully wiring keyboard input.
- When implemented, keyboard input should use the same orbit state update path and `camerachange` event shape as pointer input.

## Error Handling

Invalid or unsupported camera-control composition should not throw during rendering.

Rules:

- `<perspectiveCamera>` without `<orbitControls>` is static.
- `<orbitControls>` outside a camera is ignored.
- `<orbitControls>` with no supported input children is inert.
- `<pointerControls>` or `<keyboardControls>` outside `<orbitControls>` is ignored.
- Unknown control children are ignored.
- Invalid numeric values fall back to defaults.
- If `minDistance` is greater than `maxDistance`, use safe defaults.
- If `position` equals `lookAt`, use the minimum valid radius and a stable yaw/pitch.

## Dirtiness And Performance

Camera and camera-control changes should not repack mesh instances or lighting buffers.

The existing dirtiness model already treats `perspectiveCamera` as not invalidating draw batches. It should be extended so camera-control nodes also avoid draw-batch and light invalidation. Runtime listener reconciliation should happen only when camera-control scene metadata changes, not on every animation frame.

`camerachange` dispatch should be frame-throttled. GPU camera updates from interaction should avoid rebuilding draw batches.

## Demo Migration

The demo should move from manual camera position/yaw/pitch sliders toward an interactive camera example:

```svelte
<perspectiveCamera
  position={controls.camera.position}
  lookAt={controls.camera.lookAt}
  fov={controls.camera.fov}
  near={controls.camera.near}
  far={controls.camera.far}
  oncamerachange={syncCamera}
>
  <orbitControls minDistance={1} maxDistance={100}>
    <pointerControls />
    <keyboardControls
      rotateLeft="ArrowLeft"
      rotateRight="ArrowRight"
      rotateUp="ArrowUp"
      rotateDown="ArrowDown"
      zoomIn="+"
      zoomOut="-"
    />
  </orbitControls>
</perspectiveCamera>
```

The current camera controls can remain for FOV, near, far, and reset/framing. Position and rotation sliders can be reduced or removed once direct interaction is working.

## Testing

Add focused tests for:

- Static `<perspectiveCamera>` behavior remains unchanged.
- Scene reader parses `<orbitControls>`, `<pointerControls>`, and `<keyboardControls>` under a camera.
- Misplaced controls are ignored.
- `<orbitControls>` with no input children is inert.
- Orbit state derivation from `position` and `lookAt`.
- Rotate and zoom math, including radius and pitch clamps.
- Wheel delta normalization and clamping.
- `camerachange` event detail shape.
- Runtime listener lifecycle when controls are added, removed, and disposed.
- Camera/control changes do not invalidate draw batches or lights.

Existing tests for camera settings, scene state, dirty packing, and TypeGPU rendering should remain.

## Non-Goals

This design does not include:

- A separate `<orbitCamera>` element.
- A `controls="orbit"` camera prop.
- GPU picking.
- Panning controls.
- Damping or inertia.
- Auto-rotation.
- Full keyboard implementation if pointer controls are enough for the first slice.
- Exposing view, projection, inverse view, or inverse projection matrices as public camera state.

Those can be added after the declarative camera-control shape and event contract are stable.
