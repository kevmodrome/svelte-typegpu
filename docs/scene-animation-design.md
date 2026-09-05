# Scene animation, capacity, and frame tasks

## 1. Scope and risk

Implement three approved milestones after `a8c7517`: cheap material-value updates,
capacity reuse for changing collections, and composable frame tasks. High risk:
batch identity, mutable GPU ownership, and Svelte/render scheduling cross modules.
Keep existing markup and motion bindings. No IDs, dependency graph, physics engine,
GPU compute framework, or general incremental structural compiler is introduced.

## 2. Baseline program model

- `scene-compiler.ts:batchMaterialDescriptor` already batches built-in per-instance
  values independently of their values. `material-descriptors.ts:bindGroupKeyFor`
  still includes shader uniform contents, causing allocation on uniform animation.
- `SceneTransformCache` owns derived transform/item records. Only transform-only
  changes bypass full collection; `Dirty.MaterialUniform` performs a full walk.
- `draw-batch-cache.ts:readDrawBatch` allocates when IDs change.
  `InstanceBufferCache.upload` recreates GPU buffers on any exact size change.
- `TypeGpuSceneRenderer.renderFrame` owns rendering and RAF scheduling. Runtime
  host changes synchronize in a microtask. Gravity currently runs a second RAF.

```text
Svelte props -> dirty nodes -> scene projection -> batch/cache sync -> invalidate
renderer RAF -> uniforms -> shadow/main passes
gravity RAF -> Svelte state -> microtask -> scene sync
```

The host tree remains authoritative; descriptors, packed arrays, and GPU resources
remain derived and root-owned. Hidden attachments retain GPU ownership.

## 3. Implemented program shape

```text
+ scene-value-cache.ts: source node -> affected item/value readers, transactional preflight
~ material-descriptors.ts: authored shader-uniform owner separate from value key
~ scene-compiler.ts, scene-transform-cache.ts: combined value/transform fast path
~ resource-caches.ts: write changed uniforms in place, grow-only instance capacity
~ draw-batch-cache.ts: reuse packed capacity, compare IDs/revisions at each slot
+ frame-tasks.ts: collect and order live callbacks, no separate clock or RAF
~ primitives.ts, dirty.ts, types.ts, index.ts: narrow invalidation and frame contract
~ svelte-renderer.ts, gpu-renderer.ts: before-frame hook, flush Svelte, sync, draw
~ examples/svelte-motion/: appearance animation and variable keyed field size
+ examples/gravity/GravityFrameTask.typegpu.svelte: reusable behavior component
~ examples/gravity/Gravity.typegpu.svelte: bind ordinary state, remove private RAF
```

```text
value + transform dirtiness -> preflight all affected batch identities
  -> unchanged: update affected values/transforms -> known slots/uniform writes
  -> changed/unknown: full existing compilation
renderer frame -> ordered tasks -> Svelte flushSync -> scene flush -> draw
```

## 4. Contracts and invariants

- Authored `shaderMaterial` with uniforms owns a stable node-scoped uniform
  binding; equal values on independent nodes must not alias mutable GPU buffers.
  Materials without authored uniforms can continue sharing the default binding.
  Shader uniform layout stays the existing eight vec4 slots. Value fingerprints
  detect writes, never define mutable ownership. Texture readiness still refreshes
  bindings. Vertex-alpha adjustments must preserve shader fragment/owner identity.
  Shared mesh layouts use TypeGPU-assigned indices: fixed indices leave gaps when
  a custom fragment omits lighting or shadows, which TypeGPU 0.11.6 cannot bind.
  Typed layout identity remains stable; numeric indices are not an authoring API.
- Value readers capture existing mesh/model resource projections, not geometry
  re-reading. Preflight is all-or-nothing: blend/depth/shadow/binding changes use
  full compilation before any cache mutation. Mixed unsupported edits also fall back.
- CPU and GPU instance capacities grow geometrically. Active instance count alone
  controls drawing; spare/stale slots are never drawn. Tail removal requires no
  upload. Reordering overwrites affected slots. Removing a whole batch frees it;
  no unbounded pool of detached resources. Hidden attached batches retain ownership.
- `<frameTask update={callback} active={true} priority={0} continuous={true} />`
  is a host primitive, composable in normal `.typegpu.svelte` components. Lower
  priority first, tree order breaks ties. No implicit target lookup or IDs.
- `TypeGpuFrameContext`: timestamp in milliseconds, delta/elapsed in seconds;
  delta is nonnegative and capped at 0.05 seconds, first frame delta is zero.
  Tasks are synchronous. All callbacks see one frame context; pending Svelte
  effects flush before rendering. Async task continuations are not frame work.
- Active continuous tasks keep demand mode awake; inactive/hidden/removed tasks
  do not. Manual mode never schedules RAF. Disposal cancels scheduled work and
  clears hooks. Callback errors surface and abort the current frame; no retries.
- Task list changes are reconciled on task/tree/visibility changes, not motion.
  Membership is snapshotted per frame; new tasks start on the following frame.

## 5. Vertical slices and verification

1. Material values: resource ownership and allocation tests; targeted/full
   equivalence including opacity boundaries, mixed transform/value updates,
   model overrides, hidden values, independent identical shaders. Extend motion
   appearance and verify actual Svelte updates without remounts.
2. Capacity: append/remove/reorder/grow tests for CPU backing stores and actual
   GPU writes, draw counts, cleanup, and stale slot exclusion. Variable keyed
   field count in the motion example exercises the public workflow.
3. Tasks: ordering, reactivity, active/hidden/unmount/reparent lifecycle,
   demand/manual modes, clamped clocks and error tests. Compiled component tests
   prove same-frame state reaches scene synchronization. Convert Gravity to a
   composed task component and verify pause/resume without remounts in browser.

Review each slice before continuing. Run all tests and production builds after
integration, then start a fresh preview (generation races the existing watcher).
Browser checks cover desktop/mobile framing, nonblank canvas pixels, motion,
appearance, count changes, pause/resume and console errors.

## 6. Risks and decisions

Alternative: cache shader uniforms by value and copy-on-write when they diverge.
That preserves maximal initial batching but adds alias bookkeeping and first-write
allocation. Node-owned authored uniforms are simpler and predictable; explicitly
different shader-material nodes with uniforms may require more draws. Bulk custom
per-instance shader data is separate future work, not hidden behind this API.

Alternative: an independent Svelte frame scheduler is easy to expose but preserves
competing clocks and can draw stale state. A renderer before-frame hook plus
Svelte's supported `flushSync` provides a testable same-frame ordering contract.
See [Svelte flushSync](https://svelte.dev/docs/svelte/svelte#flushSync).

No persistent migration. Existing markup remains valid. New tasks are opt-in;
disable fast-path eligibility to recover original scene compilation. Reverting
this milestone restores exact-size capacity behavior. Measure deterministic work
and allocation counts separately from CPU timings; do not infer GPU FPS gains.

## 7. Results

All three slices are implemented. `pnpm test` passes 472 tests (401 renderer,
42 documentation, 24 example, 5 workspace), and `pnpm build` passes renderer
TypeScript compilation and both application production builds.

Deterministic checks establish:

- One animated built-in material in a 2,000-mesh scene updates one 96-byte
  instance without geometry collection or batch reconstruction.
- Shader-uniform-only animation writes one existing uniform buffer, with no
  instance upload, new buffer, bind group, or pipeline. Independent authored
  shader materials retain independent uniform values, including vertex-alpha use.
- Append, tail removal, reorder, capacity growth, hidden ownership, active draw
  counts, and removal cleanup pass CPU-cache and mocked GPU-resource tests.
- Compiled Svelte components flush task state into the same rendered frame.
  Ordering, visibility, unmounting, disposal, exceptions, demand/manual modes,
  and bounded frame timing are covered.

The local benchmark (`pnpm --filter docs exec bun
../../scripts/renderer-review-benchmark.ts`) measured approximately 0.005 ms for
targeted transform synchronization and 0.004 ms for targeted material values,
versus 7.957 ms for the full transform projection on this machine. These are
CPU scene-sync samples, not total frame times or GPU performance claims.

Browser verification at 1280x720 and 390x844 confirmed nonblank rendering,
Tween/Spring movement, material and custom-uniform appearance changes, and
collection sizes 2000 -> 800 -> 0 -> 2000. Gravity moved, paused with zero changed
scene pixels between captures, resumed, and changed presets. Controls stayed
within the mobile page width. The existing shadow scene also rendered correctly;
fresh verified tabs reported no warning/error logs.

Browser testing found a real TypeGPU fixed-index layout gap for custom fragments
that omit lighting. Shared mesh layouts now use dense TypeGPU-assigned indices,
with a shader-resolution regression test and the shadow browser smoke test.

Remaining limits are deliberate: structural updates still traverse the scene,
authored shader uniforms trade maximum batching for stable independent ownership,
and animation still creates small JavaScript descriptors. A later full projection
can re-stamp and repack one previously value-edited instance even if that full
projection was triggered by an unrelated light edit; the benchmark reports this
extra 96-byte write instead of claiming that every fallback is upload-free.
