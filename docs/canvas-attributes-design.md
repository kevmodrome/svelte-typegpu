# Canvas DOM attributes

## 1. Scope and risk

Add optional `canvasProps` to the DOM `Canvas` component for accessibility,
focus, native event handlers, styling, and ordinary Svelte DOM attachments.
High risk: a public typed prop crosses the DOM/GPU ownership boundary. Preserve
all current wrapper attributes, scene props, startup callbacks, and root lifetime.
No scene focus model, DOM children inside scenes, new frame loop, or overlay API.

## 2. Current program model

`src/Canvas.svelte` spreads host attributes onto a div. Its inner canvas is private
and has only a binding. `createTypeGpuRoot` adds `renderer-root-canvas`; the GPU
renderer owns its width/height. `camera-interaction` makes the canvas focusable
only if the user has not supplied a tabindex. Native handlers on the wrapper do
not have the same currentTarget as handlers on the canvas itself.

```text
Canvas host props -> wrapper div
onMount -> createTypeGpuRoot(canvas) -> SceneHost -> retained scene component
scene prop changes -> Svelte effects -> targeted scene updates
```

## 3. Proposed program shape

```text
~ src/Canvas.svelte: typed canvasProps, filtered spread, stable renderer class
~ src/test-fixtures/CanvasHost.svelte: reactive test inputs
~ src/canvas.test.ts + canvas-ssr.test.ts: DOM behavior and lifecycle
~ type-tests + src/svelte-types.test.ts: consumer event/attribute inference
~ src/gpu-lifecycle.test.ts: Canvas-prop updates alongside high-refresh motion
~ docs/canvas-guide.md: ownership, accessibility and event-target examples
```

`canvasProps -> filtered attributes -> existing canvas` is independent of root
initialization. Retain symbols in the spread so Svelte DOM attachments work.
Combine user class values with the renderer class declaratively; reactive class
replacement must not remove renderer or scoped styles.

## 4. Contracts and invariants

`canvasProps?: Omit<HTMLCanvasAttributes, 'children' | 'width' | 'height'>`.
Omit those fields at runtime too, so untyped callers cannot resize the drawing
buffer or inject canvas contents. Use CSS for displayed dimensions; the renderer
continues to derive device-pixel dimensions. Native callbacks receive native DOM
events with HTMLCanvasElement currentTarget, not TypeGpuNodeEvent.

Root, scene, and canvas identities stay stable across prop changes. Attribute
updates must not initialize WebGPU, remount a scene, request a frame, or allocate
GPU resources. SSR emits attributes without running callbacks, attachments, or
GPU startup. Attachments receive the DOM canvas and follow Svelte cleanup rules;
they are unrelated to scene-node attachments. Initial root options remain fixed.

## 5. Vertical slices and verification

1. Attribute forwarding through the real DOM component: reactive ARIA/tabindex,
   class merging, event replacement, symbol attachments and cleanup, reserved
   width/height, and unchanged scene/root identity. Include SSR and consumer types.
2. Run real Tween/Spring at 60/120/144 Hz in both RAF orders while updating canvas
   attributes. Assert frame delivery, instance upload ranges, GPU reuse, no
   attachment churn, manual/idle/disposal behavior; then commit this feature.
3. Production builds and live browser checks. A locked Mac limits live evidence,
   not the supported automated verification paths.

## 6. Risks and unresolved decisions

Alternative: redirect top-level attributes to the canvas. That breaks existing
wrapper styling and event-target contracts. A bindable canvas reference would
allow imperative setup but would not provide SSR attributes or normal Svelte
event composition. Separate canvasProps is additive and mirrors sceneProps.
It is not a promise of keyboard navigation among 3D objects; keep accessible DOM
controls outside the custom scene. Raw canvas width/height and renderer class
ownership are explicit compatibility constraints. Roll back the feature commit
if needed; no migration or persisted state is involved.
