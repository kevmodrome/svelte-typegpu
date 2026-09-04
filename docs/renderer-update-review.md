# Renderer update and review

## Results

The workspace now uses the immutable official preview for Svelte PR 18042,
commit `17e37a51bc539cdb6a923b424e5746fc6505ba89` (Svelte 5.57.0).
The original moving `pkg.pr.new` URL served an older 5.56.7 build during this
review. The PR head and install URL were verified through the GitHub PR API and
the official preview bot comment on September 4, 2026.

- PR: https://github.com/sveltejs/svelte/pull/18042
- Pinned source: https://github.com/sveltejs/svelte/commit/17e37a51bc539cdb6a923b424e5746fc6505ba89
- Preview: https://pkg.svelte.dev/svelte/c/17e37a51bc539cdb6a923b424e5746fc6505ba89

Changes are on `codex/renderer-update-review`, based on current `origin/main`.
This is a dependency/API migration, not a Git rebase onto Svelte's unrelated
repository history. The saved local work was restored with `git stash apply`;
the original stash remains intact. Changes have not been committed or pushed.

### Fixed findings

1. **Nested updates could silently disappear.** Scene revisions were computed
   through repeatedly multiplying ancestor hashes. A twelve-group reproduction
   lost a mesh position update. `SceneRevisionCache` now compares dependencies
   and assigns monotonic revision stamps, including resource identity and model
   load entries. Reparenting and resource replacement are covered by tests.
2. **Geometry was regenerated during transform-only updates.** Each scene walk
   called geometry generators and copied vertex data. `readInlineGeometry` now
   caches by host node and revision in a WeakMap. Removed nodes remain collectible.
3. **Unrelated tree changes repacked every instance.** The root tree revision
   contributed to every mesh's revision. Instance revisions now follow their own
   dependencies; structure still determines traversal and batch membership.
4. **Multiple shader passes shared the last pass's uniform values.** Writes to
   one GPU buffer occur before the command buffer executes, even if JavaScript
   interleaves writes and draw encoding. Each shader-pass node now owns a reusable
   uniform buffer/bind group, which is freed on removal or disposal.
5. **Material uniform buffers were not freed on eviction.** Material resources
   now explicitly own and destroy their uniform buffers on replacement, prune,
   and disposal.
6. **Camera-only updates did unnecessary GPU-cache work.** Mesh resource
   synchronization follows `drawBatchesChanged`; depth changes still refresh
   pipelines independently. Live resource key sets are reused when batches are
   unchanged. The combined draw queue is sorted on scene changes, not each frame.
7. **Disposal did not terminate scheduled work.** Queued microtasks and model-load
   completion could synchronize an already disposed runtime. Disposal is now
   idempotent and both entry points guard against late work.
8. **Reactive scene depth/alpha changes did not synchronize.** Those attributes
   were read by the compiler but missing from the dirty-attribute table.
9. **Automatic buffer geometry keys omitted index data and updates.** Geometries
   sharing vertices but different indices could reuse the wrong GPU resource;
   reassigning changed typed-array data could retain stale uploads. Auto keys now
   include index identity and the geometry-node revision. Unchanged shared typed
   arrays still share keys when their node revisions match.

Mount sites, generated component declarations, quickstart snippets, and tests
use Svelte's `mount`/`unmount` API. The older CodePanel compiler workaround was
removed; ordinary nullish-coalescing expressions and typed optional parameters
build successfully with the pinned preview.

### Performance evidence

`scripts/renderer-review-benchmark.ts` compares the pre-review saved source with
the updated source using the same installed TypeGPU dependencies and Bun runtime.
It builds 2,000 meshes, warms up 20 iterations, and measures the median of 60
scene compilations while moving one mesh. This measures CPU scene synchronization,
not GPU execution or browser FPS.

| Measurement | Saved source | Updated source |
| --- | ---: | ---: |
| Median transform synchronization | 16.614 ms | 6.281-6.439 ms |
| Geometry object reused across transform update | No | Yes |
| Unchanged instances repacked after light insertion | 2,000 | 0 |
| Instance bytes marked for upload after light insertion | 192,000 | 0 |

The timing is machine-specific; the operation-count reductions are deterministic.
Run the current benchmark with:

```sh
pnpm --filter docs exec bun ../../scripts/renderer-review-benchmark.ts
```

### Remaining findings and next work

1. **[P1] Visibility inheritance is incomplete.** In
   `packages/svelte-typegpu/src/scene-compiler.ts`, `collectDrawItemsFromNode`
   handles a group's transform but ignores `visible={false}`. A hidden group
   still produces a draw batch in the benchmark's diagnostic. Hidden meshes
   still traverse descendants, and `readModelDrawItems` does not check visibility.
   Define one inherited visibility contract across meshes, models, lights,
   picking, and shader passes, then test hide/show without breaking resource reuse.
2. **[P2] Single-object motion still performs whole-scene work.**
   `svelte-renderer.ts:scheduleSync` receives but ignores `_dirtyNode`.
   `scene-compiler.ts` still walks for cameras, transforms, materials, and bounds;
   `draw-batch-cache.ts` regroups all draw items. Use the existing dirty nodes and
   revision stamps to retain draw items and batch membership. Start with a test
   showing one moving leaf does not re-read static siblings, then expand to group
   motion, insertion, reparenting, and model settlement.
3. **[P2] Custom material uniform values still change resource identity.**
   `material-descriptors.ts:bindGroupKeyFor` includes `uniformKey`, derived from
   numeric uniform values. That key participates in batch identity, so animating
   a shader material can recreate bind groups and instance buffers. Introduce
   stable material-instance identity plus dirty uniform writes. Preserve separate
   values for distinct instances; removing values from the key alone is incorrect.
4. **[P2] Instance buffers resize to exact lengths.**
   `resource-caches.ts:InstanceBufferCache.upload` recreates a buffer whenever its
   byte length differs. A changing keyed each-block can repeatedly allocate and
   upload whole batches. Separate capacity from instance count, grow capacity
   geometrically, and coalesce small dirty ranges when upload-call overhead wins.
5. **[P2] Root render options are overwritten by compiler defaults.**
   `scene-compiler.ts:readRenderSettings` uses hard-coded fallbacks independently
   of `TypeGpuRootOptions`. A root's `depth`, `alphaMode`, or `clearColor` is lost
   on synchronization when the scene omits those attributes. Resolve settings as
   authored scene value, then root option, then default, with one owner.
6. **[P2] The gravity example has simulation limitations.** The browser showed
   bodies moving outside the fixed camera view. `gravity-simulation.ts` uses an
   all-pairs CPU integrator and does not implement the collision/merge behavior
   implied by its dust preset names. Treat it as a small demo, correct the framing
   and labels, and use a tested simulation engine or compute pass for larger loads.
7. **Maintainability: many tests inspect source strings.** These can pass while
   behavior is broken, or reject harmless refactors. The new regression tests
   exercise mount/update/unmount and GPU resource ownership through a fake device.
   Continue replacing implementation-string checks with observable behavior and
   add automated browser WebGPU coverage for command submission and shader output.

The next performance slice should be incremental draw-item compilation. Keep
Svelte responsible for declarative state and composition, and let the renderer
turn a changed node into a targeted buffer write. This builds on the current
architecture without requiring IDs in authored components.

### Verification

- Full workspace test suite: 444 tests passed (373 renderer, 42 docs, 24 example,
  5 workspace).
- Package TypeScript check, example production build, and docs production build
  passed against the pinned PR.
- Browser checks: boxes render and respond to dragging; directional shadows
  render; the smoke shader responds to preset changes; gravity mounts and animates,
  with the framing limitation above. No browser console warnings/errors observed
  in those checks. The two-boxes canvas also rendered at a 390px mobile viewport
  without page overflow. Browser checks are smoke tests, not visual baselines.
- Behavioral GPU tests cover per-pass uniform values at submission, buffer
  eviction, camera-only reuse, depth changes, and unchanged-frame queue reuse.

## Implementation design

## Scope and risk

Update Svelte PR 18042 to commit `17e37a51bc539cdb6a923b424e5746fc6505ba89`,
review the restored declarative renderer work, and implement focused corrections.
Risk is high for the dependency migration because compiler output, mounting,
component effects, and disposal share a runtime. The original stash is retained.

## Current program model

`core.ts` owns the host tree and node revisions. Attribute and tree mutations
call `scheduleSync` in `svelte-renderer.ts`, which batches changes in a microtask.
`scene-compiler.ts` builds scene projections and `draw-batch-cache.ts` packs
instance data. `gpu-renderer.ts` owns GPU caches and the animation loop.

```text
Svelte effect -> core.setAttribute/insert/remove
  -> runtime.scheduleSync -> createSceneState -> renderer.setScene
  -> animation frame -> render queue -> TypeGPU draw
```

## Proposed program shape

```text
~ workspace manifests and lockfile: immutable Svelte preview
~ canvas components, snippets, tests: mount/unmount with renderer option
~ svelte-renderer.ts: disposal terminates scheduled work
~ scene-compiler.ts, resources.ts: revision and geometry caches
~ gpu-renderer.ts, resource-caches.ts: update gating and resource ownership
+ scene-revisions.ts: exact dependency comparisons and revision stamps
+ gpu-lifecycle.test.ts: behavioral GPU resource tests
+ scripts/renderer-review-benchmark.ts: repeatable CPU measurements
+ docs/renderer-update-review.md: findings and verification evidence
```

Mounting changes from `renderer.render(Component, options)` to
`mount(Component, { renderer, ...options })`; cleanup uses `unmount(instance)`.
Vite selects the renderer for `.typegpu.svelte` and explicitly returns `null`
for DOM files in the same application. Generated scene declarations use Svelte's
`Component` type. Existing scene markup and TypeGPU resource ownership remain.

## Contracts and invariants

`createTypeGpuRoot` still owns a GPU renderer and a host fragment. Svelte owns the
mounted component; callers unmount it and dispose its root. A disposed runtime
must ignore queued synchronization and late model-load completion. GPU caches
must continue handling asynchronous texture completion, resource removal, and
depth-setting changes when redundant work is removed.

## Vertical slices and verification

1. Compile and mount against the pinned preview; run component tests, package
   type checking, app builds, and browser smoke checks.
2. Reproduce lifecycle/invalidation failures and add behavioral regression tests
   before fixes. Review exact instance changes and disposal counts.
3. Remove redundant scene/frame work where evidence supports it. Verify reuse
   and invalidation with operation counts; document remaining larger changes.

## Risks and alternatives

Keeping the moving PR URL is simpler but does not reproduce a reviewed compiler
build. The immutable official preview URL gives all workspaces the same version.
Replacing the entire scene compiler with an incremental graph could reduce
animation cost further, but changes cache ownership and needs dedicated design
and performance baselines. This review favors focused changes first.

The upstream API remains experimental. Rollback is the previous dependency and
mount integration; no application data migration is involved.
