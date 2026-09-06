# Frustum culling and visibility diagnostics

## 1. Scope and risk

Implement conservative camera-frustum culling, enabled by default on scenes,
with `frustumCulling={false}` for raw benchmarks. Keep the asset world's raw
default and add an explicit comparison control. No LOD, occlusion, streaming,
shadow culling, shader changes, or animation scheduling changes in this slice.
Risk is high: instance ordering, draw submission, incremental bounds and public
diagnostics cross compiler/renderer boundaries. Frame delivery is correctness.

## 2. Current program model

`scene-compiler.ts` owns authored draw items and world bounds;
`scene-transform-cache.ts` changes only affected bounds. `draw-batch-cache.ts`
maps stable item IDs to packed instance slots. `gpu-renderer.ts` draws all slots
in both color and shadow passes; `InstanceBufferCache` uploads dirty ranges.

```text
Svelte mutations -> scene compiler -> batch cache -> GPU instance dirty uploads
camera/frame -> render queue -> draw(full batch instance count)
```

## 3. Proposed program shape

```text
+ src/frustum.ts, batch-visibility.ts and focused tests
~ src/draw-batch-cache.ts, scene-compiler.ts, primitives.ts, types.ts
~ src/gpu-renderer.ts and frame-delivery/resource regression tests
~ asset-world/WorldViewport.typegpu.svelte, AssetWorld.svelte, world-profile.ts
~ repros/asset-world-gpu-profile.mjs, asset-world-input.mjs
```

```text
structural compilation -> optionally spatially order large opaque batches
                      -> packed instances + cached bounds hierarchy
incremental mutation  -> existing slot upload + refit affected bounds only
camera/frame          -> per-view range selection -> draw selected slot ranges
shadow pass           -> unchanged full caster batches
```

Use a CPU bounds hierarchy over consecutive instance ranges. Large opaque
batches with depth testing/writing can be Morton-ordered during structural
compilation (4,096+ instances); transparent/order-dependent batches keep source order. Selection
coalesces adjacent ranges. Small batches get per-instance tests, large ones
conservative clusters. A fixed range budget falls back to drawing extra objects
rather than generating unbounded draw calls. No visibility uploads or GPU
readback, no camera-driven sorting or instance repacking.

Initial budgets are 32 instances per large-batch leaf and 64 output ranges per
batch. Small batches use individual bounds. Cached selections skip unchanged
views and bounds revisions. A prerequisite corrected perspective/orthographic
projection depth and orthographic picking from OpenGL [-1,1] to WebGPU [0,1].

## 4. Contracts and invariants

- `BatchVisibility`: retained world bounds, hierarchy and revision; batch-cache
  owned. Invalid/missing geometry bounds are unbounded, never falsely rejected.
- `Frustum`: six planes extracted from the actual column-major WebGPU view
  projection (near clip z=0, far z=w), conservative tolerance at boundaries.
- `VisibilitySelection`: reused range storage, submitted count, bounds-test
  count and fallback flag; renderer owned, cached by view and bounds revision.
- Optional `TypeGpuRenderer.getRenderStats()` reports actual submitted color
  draws/instances/triangles separately from candidates and retained instances.
- Culling never changes authored visibility, Svelte lifetime, picking, frame
  tasks, resource live keys, or shadow caster membership. Range order is stable.
- Invalid camera matrices draw everything. Disposal clears selection caches.
  Demand/manual/disposal retain the existing single-loop scheduling behavior.

## 5. Vertical slices and verification

1. Integrate selection with real draws. Test perspective/orthographic planes,
   touching/intersecting/unknown bounds, transforms, indexed draw offsets,
   ordering, grow/shrink, refits, empty selection and unchanged shadows. Assert
   camera-only changes allocate/upload no instance resources and bound work.
2. Expose diagnostics and raw/culling control. Test compiled scene settings and
   profiler samples. Verify 60/120/144 Hz, both external RAF orders, manual,
   demand idle and disposal, including existing real Tween/Spring fixtures.
3. Compare the live 50k world in overview/follow views, at 1x and 16x, with the
   Apple GPU. Record CPU, GPU, frames/callbacks, submitted geometry and resource
   reuse. Check desktop/mobile screenshots and walking/orbit continuity.

Commit each tested slice separately. Revisit cluster size/range budget based on
the live evidence, not just synthetic passing tests.

## 6. Risks and unresolved decisions

GPU compaction plus indirect draws is the serious alternative: fewer CPU draws
and better arbitrary-order visibility, but requires new storage resources,
compute work and lifecycle/diagnostic paths. Defer until the CPU baseline shows
where it loses. Simply compacting full records on the CPU each camera frame
would lose sparse uploads; per-object draws could explode draw counts.

Clustering may over-submit at view boundaries or after extensive object motion;
it must never under-submit. Spatial ordering can change coplanar opaque tie
results, so preserve original ordering for order-dependent materials and raw
mode. Frustum culling cannot substantially help an overview containing the
whole world. LOD remains a separate next step. The raw switch provides rollback
and comparable measurements; no existing geometry or asset detail is changed.
