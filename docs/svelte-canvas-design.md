# Svelte canvas boundary

## 1. Scope and risk

Provide a normal DOM Svelte `Canvas` component for hosting a custom-rendered
scene. Preserve reactive props and context across that boundary; own async GPU
initialization and unmount-before-dispose cleanup. High risk: public lifecycle
API, two renderers, async cancellation, and retained component state.

Non-goals: mixed DOM nodes inside scenes, hiding the custom compiler requirement,
new rendering loops, CSS transitions on scene nodes, or reactive GPU creation
options. Initialization options are sampled once; use a Svelte `{#key}` block to
recreate a canvas deliberately. Scene/sceneProps and callback props remain live.

## 2. Current program model

`createTypeGpuRoot` owns the renderer and canvas interactions, but callers own
Svelte effects. `ExamplePreview.svelte`, `TypeGpuCanvas.svelte`, and README each
repeat root creation and mount cleanup. Some docs controls remount to propagate
props, losing scene state and GPU resource reuse. Context is not passed through.

```text
DOM onMount -> async createTypeGpuRoot -> mount(Scene, snapshot props)
control edits -> some call unmount + mount
DOM cleanup -> caller must unmount then dispose
```

## 3. Proposed program shape

Use Svelte's own dynamic component/spread machinery in a small `SceneHost.svelte`
component containing no DOM elements. Mount that host once with the custom
renderer and getter props. It renders the current scene and forwards current
sceneProps. This avoids a handwritten proxy, prop copying, or a second reactive
graph. Verify this mixed compiler/runtime boundary before expanding the API.

```text
+ packages/svelte-typegpu/src/Canvas.svelte (DOM boundary, async ownership)
+ packages/svelte-typegpu/src/SceneHost.svelte (dynamic component, prop spread)
+ packages/svelte-typegpu/src/canvas.test.ts (compiled DOM + fake GPU lifecycle)
~ package.json/vitest config (component export, DOM component test dependencies)
~ apps/docs/src/components/ExamplePreview.svelte (use Canvas; remove remounts)
~ apps/example/src/TypeGpuCanvas.svelte (use Canvas)
~ README/docs (public usage and initialization contract)

<Canvas scene={Scene} sceneProps={{ controls }} options={{ frameloop: 'demand' }}>
  -> onMount -> root + one SceneHost
  -> ordinary Svelte prop/component changes -> targeted scene mutations
  -> onDestroy -> unmount SceneHost -> dispose root
```

## 4. Contracts and invariants

- Export `Canvas` from `svelte-typegpu/canvas`, leaving the non-component entry
  point usable without a Svelte component loader. Scene props follow Svelte's
  inferred component props; callbacks use ordinary functions.
- `options` excludes owned target/canvas and callbacks; it is initialization-only.
  `onready(root)`, `onerror(error)`, and `onfps(fps)` use current callback props.
  `bind:root` exposes the current root for manual frames, not ownership transfer.
- Capture parent context at component initialization and pass it to the scene
  mount. SSR produces a host/canvas but never initializes WebGPU.
- Root resolution after unmount disposes the late root without mounting a scene
  or firing callbacks. Mount failure frees acquired resources. Cleanup is once
  and always unmounts Svelte before disposing GPU state. The component owns its
  DOM canvas, so repeated mounting cannot accumulate canvases.
- Prop updates retain the scene instance, camera state, frame tasks, attachments,
  buffers, and pipelines. Scene component identity change intentionally replaces
  that component while retaining the GPU root. No new RAF loop is added.

## 5. Vertical slices and verification

1. Prove the no-DOM dynamic SceneHost with real compiled components: replaced
   props, added/removed props, context, dynamic scenes, cleanup, no remount on
   updates. Commit the public Canvas with lifecycle/SSR tests once verified.
2. Migrate live previews and remove control-triggered remount code. Keep camera
   state through ordinary controls. Verify real motion at 60/120/144 Hz and both
   callback orders through SceneHost, resource reuse and disposal. Commit this
   migration separately with docs and generated sources.
3. Full tests/builds, desktop/mobile browser checks, nonblank and interactive
   scenes, shader/preset controls, error paths and no console warnings. Record
   browser FPS separately from synthetic refresh-rate evidence.

## 6. Risks and alternatives

A plain imperative helper would reduce setup lines but not solve reactive props
or context. A custom proxy would duplicate Svelte spread semantics. Nested
`<Canvas><Scene /></Canvas>` snippets might capture the DOM renderer; defer that
API rather than silently mixing renderers. The explicit component prop marks
the boundary clearly. Existing createTypeGpuRoot/mount usage remains supported;
rollback requires no renderer changes. Startup failures surface via onerror;
Svelte boundary/await still own scene rendering/loading failures. Device-loss
recovery is not introduced by this component.

## Verified results

- 534 tests pass across the workspace: 463 renderer, 42 docs, 24 example, and 5
  workspace tests. Renderer TypeScript checking and both production builds pass.
- Real compiled Tween/Spring scenes now run through SceneHost in the existing
  60/120/144 Hz matrix, with both producer/renderer callback orders. Upload
  ranges, resource reuse, idle behavior, and disposal assertions remain green.
- Live desktop checks verify motion/appearance updates, camera settings retained
  through lighting edits, whole-object smoky preset replacement, and disco
  shader selection. Canvas pixel samples confirm visible geometry and motion.
- The Phong model still reports a missing-URL error and recovers after loading
  the valid URL. At 390x844 it is nonblank, fully framed, and has no horizontal
  overflow. Canvas retains both its scoped CSS class and renderer class.
- The automation browser reports 60 rendered FPS before and after migration;
  this does not measure the user's physical 120 Hz monitor. Normal interaction
  checks produced no browser warnings/errors. The intentional missing model
  request produced the expected 404.
- Consumer component inference is now covered by the follow-up
  [Svelte typecheck gate](svelte-types-design.md), including valid usage and
  expected diagnostics for invalid props, callbacks, and root bindings.
