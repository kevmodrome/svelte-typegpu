# Incremental Svelte motion

## Results (September 5, 2026)

Implemented all three slices below. Authored markup is unchanged; the new example
binds real Svelte `Tween.current` and `Spring.current` values to group/mesh props.
The preview controls update reactive props without unmounting the scene.

- Visibility now propagates to descendant draws, picking, lights, and shader
  passes. Attached hidden objects retain reusable GPU resources; removal prunes
  them. Nested mesh/model transforms also apply to child lights.
- Render settings resolve authored scene values before root options and defaults.
- The runtime coalesces node/mask pairs. Pure supported transform updates retain
  geometry, material descriptors, batch slots, and picking targets. Dirty ancestor
  updates cover dirty descendants once. Model primitive-local transforms survive.
- GPU synchronization receives only changed instance batches. That path performs
  no geometry/material lookup, pipeline creation, resource pruning, or queue sort.
- Separate instance/property and interaction dirtiness rejects mixed edits, even
  when they affect the same node as a transform. Cached records become eligible
  only after a completed full batch compilation.

### Measurements

The benchmark measures `createSceneState`, not Svelte scheduling, GPU execution,
or whole-frame time. For 2,000 meshes with one moving leaf, after 20 warm-up
iterations and 60 measured iterations on this machine:

| Measurement | Full compilation | Targeted transform |
| --- | ---: | ---: |
| Median CPU synchronization | 6.904 ms | 0.006 ms |
| Transform reads | 2,000 | 1 |
| Instances repacked | 1 | 1 |
| Instance bytes marked for upload | 96 | 96 |
| New packed instance arrays | 0 | 0 |

The upload path was already selective at the checkpoint. This milestone removes
the scene-wide work before that upload, rather than claiming a further reduction
in the 96-byte leaf update. GPU mock tests verify the actual write byte length and
offset and zero new GPU buffers on that path. Small JS objects and upload-range
copies still allocate; this is not a zero-allocation claim.

Run `pnpm --filter docs exec bun ../../scripts/renderer-review-benchmark.ts`.
The script also checks hidden draws and unrelated light insertion. Timings are
machine-specific; work-count regressions are deterministic tests.

### Verification

- 460 tests passed: 389 renderer, 42 docs, 24 example, 5 workspace.
- Package TypeScript check and both production builds passed.
- A compiled Svelte component driven by actual `Tween` frames updates only its
  two grouped meshes while preserving 300 static siblings and the packed array.
- Equivalence tests compare targeted updates with full compilation for nested
  transforms, quaternion/scale changes, model primitives, and coalesced updates.
- Browser smoke checks cover Tween movement, Spring lift, hide/show, and picking
  a target from the 2,000-cube field. Desktop and 390px mobile viewport screenshots
  and pixel checks show a nonblank, framed canvas, moving marker, and no marker
  pixels when hidden. No browser warnings/errors observed. These are desktop
  browser checks with a mobile viewport, not physical-device performance tests.

Preview: http://127.0.0.1:3334/examples/svelte-motion

### Limits

Structural changes, material/picking edits, unknown hints, and moving subtrees
containing lights use full compilation. This is intentional, tested fallback.

The existing docs generator removes and recreates its output directory. Running
a build while the dev server watches that directory can leave a stale preview;
restart the dev server after generation completes. The final preview was checked
again after restarting. Generator/watch coordination is outside this milestone.
Dynamic material identity, buffer capacity growth, bulk GPU data, and frame tasks
are not part of this milestone. This milestone builds on baseline `5ba1bca`
on `codex/renderer-update-review`; the original stash remains intact.

## Scope and risk

Preserve the authored scene API while making leaf and group motion update only
affected transforms, bounds, and instance data. Fix inherited visibility and
root render defaults first. Do not add frame tasks, material animation semantics,
new resource primitives, or an incremental structural editor.

Risk is high: scene compilation, batching, picking, and GPU resource lifetime
share derived state. Baseline commit: `5ba1bca`. The original stash is retained.

## Current program model

`core.ts` owns host nodes and revisions. `svelte-renderer.ts:createRuntime`
coalesces dirty masks but discards dirty nodes. `scene-compiler.ts:createSceneState`
walks and normalizes meshes; `draw-batch-cache.ts` regroups and packs them.
`gpu-renderer.ts:setScene` synchronizes caches, then invalidates the frame loop.

```text
attribute mutation -> scheduleSync -> full draw-item walk -> regroup -> GPU sync
```

The host tree is authoritative. Scene projections and GPU buffers are caches.

## Proposed program shape

```text
~ primitives.ts, lights.ts: consistent visibility and transform invalidation
~ svelte-renderer.ts: retain coalesced dirty nodes and root render defaults
~ scene-compiler.ts: full compilation establishes cached transform records
+ scene-transform-cache.ts: update affected records, preserving resource identity
~ draw-batch-cache.ts: stable instance-id -> batch/slot index for partial packing
~ gpu-renderer.ts, types.ts: separate instance uploads from resource/batch changes
~ scene-compiler.test.ts, gpu-lifecycle.test.ts: semantics and GPU ownership tests
+ incremental-scene.test.ts: equivalence and deterministic work-count tests
+ apps/docs/src/examples/svelte-motion/: real Svelte motion example
~ scripts/renderer-review-benchmark.ts: full vs incremental measurements
```

```text
attribute mutation -> coalesced node/mask map
  -> transform-only, unchanged tree, supported cached nodes?
     -> affected transform records -> known batch slots -> range uploads
  -> otherwise existing full compilation and batch-membership reconciliation
```

Full compilation retains descriptors for attached hidden objects separately from
visible draws. Resource pruning follows attachment; picking follows visibility.
Hidden objects do not require eager GPU allocation. Removed objects are pruned.

## Contracts and invariants

- `TypeGpuSceneStateOptions.dirtyNodes?: ReadonlyMap<TypeGpuNode, Dirty>` is an
  internal optimization hint; the runtime supplies all coalesced mutations.
  Missing hints or unsupported masks take the full path. Initial compilation,
  tree revision changes, model settlement, geometry,
  material, visibility, and listener changes retain the full path.
- Transform dirtiness implies instance and bounds work. Do not also mark it as
  independent `InstanceData`/`Interaction` dirtiness: those bits must disqualify
  mixed property/handler edits from the transform-only path.
- Cached transform records own parent/child links and draw-item projections,
  including model primitive-local transforms. Rebuild the records on full walks;
  discard detached nodes. Deduplicate dirty descendants under dirty ancestors.
- The fast path reuses geometry/material descriptors and batch membership.
  Batch slots remain stable until the next full compilation. Interaction target
  bounds follow updated draw-item bounds; they must never retain stale positions.
- `instanceUpdates?: TypeGpuDrawBatch[]` carries only changed batches. It is
  consumed synchronously by `setScene`, like existing dirty ranges. It must not
  trigger pipeline/resource lookup, pruning, or render-queue sorting.
- Scene snapshots already share mutable packed arrays; they are not immutable
  history. Clear prior update flags before emitting a subsequent projection.
- Visibility is inherited through scene/group/mesh/model descendants, including
  lights and shader passes. A descendant cannot override a hidden ancestor.
  Cameras remain selectable independently of render visibility.
- Settings precedence is authored scene value, root option, library default.
- Runtime disposal clears pending dirty nodes and rejects late async work.

## Vertical slices and verification

1. Semantics: nested hide/show/reparent/remove, picking, lights, model settlement,
   hidden resource reuse, and setting override/removal tests. Run renderer tests.
2. Incremental transforms: first leaf, then nested groups/model primitives and
   coalesced updates. Compare results to fresh full compilation. Count transform
   reads, resource lookups, packed instances, and uploaded bytes; test structural
   and mixed-change fallbacks and runtime disposal. Run full suite and builds.
3. Motion example: ordinary `svelte/motion` values bound to mesh/group position,
   many static siblings, interactive target selection. Verify desktop/mobile
   rendering and actual movement. Benchmark the same workload on both paths;
   report CPU timing and deterministic allocation/upload counts separately.

Review evidence after each slice before expanding the fast path.

## Risks and unresolved decisions

A fully incremental scene graph could also optimize structure and material
changes, but would broaden cache invalidation and ownership substantially. The
chosen transform-only path is smaller and can fall back without authored changes.
Groups containing lights may initially fall back to full compilation so inherited
light transforms remain correct; expand only with dedicated tests.

Reuse resource objects, not merely string keys. Preserve async texture refresh
and loaded-model local transforms. Do not claim zero allocations: transform math
and a small update list still allocate. Measure typed instance-buffer allocation
and upload sizes deterministically; CPU timings are machine-specific.

No persistent data migration or public markup change is needed. Rollback is the
baseline commit or disabling the fast-path predicate. Equivalence tests against
full compilation provide recovery confidence. A frame scheduler and stable
material-instance uniforms remain separate future work.
