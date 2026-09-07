# Occlusion coverage and diagnostics

## 1. Scope and risk

Improve the existing opt-in current-frame Hi-Z path without changing component
lifetime, picking, shadows, LOD choice, or frame scheduling. High risk: depth
correctness, GPU resource ownership, async diagnostics, and frame time. No new
occlusion backend, author-supplied proxies, portals, or automatic asset LOD.

## 2. Current program model

`gpu-renderer.ts#prepareOcclusion` selects at most 16 whole small batches using
`occlusion.ts#isUsefulOccluder`. Textures are excluded even though the built-in
opaque pipeline in `typegpu-pipeline.ts` has no alpha discard. `BatchBounds`
already retains a tree over canonical slots, spatially ordered on structural
changes. `HiZOcclusion` owns stable per-range GPU compaction and retained buffers.
The browser probe measures pass timestamps; the live examples show only CPU time.

```text
frame -> shadow -> frustum/LOD -> small-batch occluder selection
      -> depth -> pyramid -> per-instance visibility/scan/compact -> color
```

## 3. Proposed program shape

```diff
+ src/occluder-selection.ts       bounded, ranked instance selection using bounds
+ src/gpu-timing.ts               optional bounded asynchronous timestamp sampler
~ src/{occlusion,occlusion-shaders,gpu-renderer}.ts
~ src/*.test.ts                   GPU contracts and compiled motion cadence
~ repros/occlusion.mjs            before/after images and total-pass benchmarks
~ apps/docs/src/examples          live GPU timings and occluder counters
```

```text
frame -> optional timing slot -> existing shadow/frustum/LOD
      -> cached bounded occluder instance selection (actual geometry)
      -> depth -> pyramid -> [optional coarse cluster test] -> existing compaction
      -> color -> submit timestamp resolve -> asynchronous sample publication
```

Keep flat Hi-Z as the benchmark alternative. Prototype canonical 128-instance
cluster bounds from the existing tree, with sparse updates, not a second BVH.
Enable clustering by default only if hardware measurements justify its cost.

## 4. Contracts and invariants

- The public scene option remains `occlusion="hi-z"`; selection is internal.
- Cap selection search, depth draw count, and total depth triangles. Never use
  bounding boxes as depth geometry. Unknown bounds and unsupported depth remain
  conservative. Transparent/custom materials stay excluded; opaque textured
  built-ins are eligible only while their no-discard depth contract holds.
- Partial batch depth selection must not exempt the entire batch from culling.
  Self-depth cannot reject conservatively widened enclosing bounds.
- Clusters enclose canonical slots, including every authored LOD. Dirty updates
  refit/upload affected clusters only; camera motion uploads no instance bounds.
- `<canvas gpuTiming={enabled}>` is declarative, optional instrumentation, passed
  through existing canvas live options. No consumer registration calls. Request
  timestamp-query as an optional device feature. No feature means unavailable,
  not zero time. Samples include their frame and occlusion state to identify lag.
- Timing owns a fixed pool of query/resolve/readback slots. Busy or overflowing
  slots skip samples, never rendering. Readback neither schedules nor blocks RAF.
  Disabling/disposal destroys resources and ignores pending completions.
- Pass-time sums exclude queue wait/presentation. Existing indirect color counts
  remain explicitly upper bounds, not inferred from timing or frame rate.

## 5. Vertical slices and verification

1. Occluder coverage: tests for large shared batches, ranking, global budgets,
   cached selection, opaque textures and exclusions; GPU pixel comparison with
   holes, camera movement, LOD, and partial-batch self-depth. Focused commit.
2. Diagnostics: fake timestamp results, unsupported features, pool saturation,
   out-of-order completion, rejection, teardown, and no scheduling. Live example
   compares depth+pyramid+selection+color (and shadows). Focused commit.
3. Cluster spike: test sparse bounds uploads and resource reuse; compare flat,
   clustered, and disabled on blocked/open scenes. Real compiled Tween/Spring
   at 60/120/144 Hz in both callback orders, demand/manual/disposal. Keep or
   default-disable based on total GPU and CPU measurements. Focused commit.

## 6. Risks and unresolved decisions

Large world-spanning bounds can make clusters ineffective. The existing spatial
order reduces this without changing animated slot identity, but moving objects
can degrade locality. More occluders can cost more than they save; budgets and
GPU timings must expose that. A global bounded search can miss useful objects;
it affects effectiveness, never visible correctness. GPU timing is delayed and
must not label a prior configuration's sample as the current one.

Alternative: GPU-reduce cluster bounds each frame, avoiding extra CPU uploads,
but adding barriers even for static worlds. Prefer cached tree-derived bounds.
Alternative: per-object hardware queries introduce another depth/resolve path;
not needed while existing GPU Hi-Z can consume improved selections.

No migration. Disable Hi-Z/timing to recover the original paths. HLOD/impostors
are a separate follow-up for visible distant forests, requiring authored asset
representation and screen-error contracts rather than occlusion semantics.
