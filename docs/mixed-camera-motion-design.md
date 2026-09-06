# Mixed camera and scene motion

## 1. Scope and risk

Make concurrent reactive camera, transform, material-value, and listener updates
incremental. A Tween driving both camera fov and one mesh should not recompute
every mesh transform. Cache camera discovery between structural edits. High risk:
partial updates share camera ownership, transform/instance caches, picking, and
frame delivery. No new props, scheduler, dependency patch, or ID-based wiring.

## 2. Current program model

`scene-compiler.ts:updateSceneValuesAndTransforms` accepts only Transform, Lights,
and MaterialUniform masks. Adding Camera or Interaction forces full compilation.
`camera.ts:readCameraState` also traverses the host tree to find cameras and the
first orbit controller on every full read. `SceneCameraCache` currently preserves
declarative/live views but does not cache discovery. The runtime already provides
dirty-node hints and root `treeRevision`; insert/remove/reparent invalidate it.

```text
one motion producer -> camera + mesh props -> Camera | Transform
  -> full compilation -> discover cameras + read every mesh transform/resource
  -> targeted GPU uploads, despite broad CPU work
```

## 3. Proposed program shape

Separate stateless camera discovery from camera-value reading. Cache candidates
inside the existing scene-owned camera cache, invalidated by root identity/tree
revision. Re-read candidate attributes on every camera update so selection,
active/id changes, and controls remain reactive. Expand incremental preflight to
Camera and Interaction; rebuild picking only when listener eligibility changes.

```text
~ src/camera.ts: collectCameraCandidates / readCameraStateFromCandidates
~ src/scene-camera-cache.ts: cached candidate list and read(root, activeCameraId)
~ src/scene-compiler.ts: mixed incremental preflight and explicit camera/index deltas
+ src/mixed-scene-updates.test.ts: CPU work bounds, selection, and fallback correctness
~ src/event-listener-motion.test.ts: camera fov + mesh Tween/Spring matrix
~ repros/listener-options.mjs: real camera/mesh animation and scene-reset counter
~ docs/svelte-compatibility.md, repros/README.md

same tree -> cached camera candidates -> read live attributes
mixed update -> preflight values/transforms + read camera declaration
  -> update affected instances -> refresh picking if needed
  -> commit camera declaration -> existing GPU/frame path
unsupported mask / failed preflight -> unchanged full compilation
```

## 4. Contracts and invariants

- Camera selection order and normalization remain unchanged. Candidate arrays only
  retain nodes in the indexed tree; structure/root changes rebuild them and disposal
  clears them. Values and active/id flags are never cached as selection results.
- Transform dirty-node maps must contain only Transform/Lights masks. Camera and
  Interaction bits do not become transform work. Camera-only updates do not read
  mesh transforms or geometry. Mixed edits visit only affected transform subtrees.
- Preflight completes before mutating instance/transform caches. Opacity/shadow
  transitions, structural/resource edits, light-bearing subtrees, missing hints,
  and stale trees retain the full fallback. Camera declarations commit after all
  scene compilation work succeeds, preserving retry and live-view ownership.
- Picking targets use updated transforms/material values before rebuilding their
  eligibility. New targets are attached to the transform cache for future motion.
  Existing live camera views, material updates, dirty ranges, and GPU reuse remain
  authoritative. No change to invalidation or RAF order.

## 5. Vertical slices and verification

1. Reproduce broad CPU work with a large retained scene and a live browser reset
   counter. Add cache-discovery tests for value updates, active/id selection,
   controller changes, insertion/removal/reordering, and disposal.
2. Implement mixed incremental updates. Assert one transform read for one moving
   object, no geometry/regrouping/camera discovery on a stable tree, exact instance
   ranges, fresh picking, and correct full fallback. Exercise real compiled
   Tween/Spring at 60/120/144 Hz with both RAF orders and manual mode.
3. Run workspace, production and type checks; repeat the installed-compiler WebGPU
   probe at desktop/mobile sizes. Verify moving pixels, zero scene resets during
   camera/mesh animation, resource reuse, demand idling, and cleanup. Commit
   implementation and consumer verification surgically.

## 6. Risks and alternatives

Dirty-mask expansion alone leaves camera discovery proportional to total scene
size. Caching the selected camera alone misses reactive active/id changes and
structural precedence changes. A tree-revision candidate cache reuses an existing
owner and preserves selection semantics without additional node registries in
core. Interaction rebuilding remains proportional to eligible scene data when
membership changes; this work is not claimed to be constant time. No resource or
GPU state is persisted. Rollback restores the narrow incremental mask and uncached
camera reads. Software WebGPU validates work/pixels, not physical monitor refresh.

## Verification results

- The workspace suite passed all 1,427 tests, including the new mixed-update and
  compiled motion regressions. Renderer TypeScript and the targeted docs consumer
  Svelte check passed.
- A final focused rerun passed all 39 mixed-update and listener/motion tests,
  covering 60/120/144 Hz, both callback orders, and manual mode.
- The installed-compiler WebGPU probe passed at 1440px and 390px. Camera and mesh
  animation produced zero full-scene resets and changed 31,175 screenshot pixels
  at each size. Buffer, bind-group and pipeline counts remained at 6, 4 and 1.
- Once, abort, rearm and camera-controller cleanup produced no extra frames;
  camera continuity checks passed. This software-WebGPU run does not establish
  physical monitor refresh rate.
