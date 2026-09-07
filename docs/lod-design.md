# Retained asset LOD

## 1. Scope and risk

Add opt-in, authored geometry LOD for shared model assets. Select by conservative
projected height in CSS pixels with hysteresis. Keep Svelte nodes, simulation,
picking and instance slots alive. No simplification, streaming, component-tree
LOD, occlusion, shadow LOD or scheduling changes. High risk: public asset data,
resource lifetime and camera-driven draw selection cross module boundaries.

## 2. Current program model

`scene-compiler.ts:readModelDrawItems` expands loaded meshes into retained items.
`SceneTransformCache` owns incremental world bounds; `createDrawBatchCache`
packs canonical instance slots and `BatchBounds` clusters. `VisibilitySelection`
produces contiguous ranges. `TypeGpuSceneRenderer` owns resource caches and draws
those ranges. Camera motion changes selection, not instance storage.

```text
model asset -> compiler -> batch/bounds -> frustum ranges -> full-detail draws
```

## 3. Proposed program shape

`createModelLod(high, [{ maxScreenHeight: 80, asset: medium }, ...])` returns an
ordinary loaded model with validated, shared geometry families. Use that asset
on existing `<model>` primitives; create it once outside the instance loop.
Variants must retain mesh correspondence, transforms and material appearance.
The helper retains the high-detail materials and unions all level bounds.

```text
+ src/lod.ts, lod-selection.ts, focused tests
~ src/types.ts, index.ts, batch-visibility.ts, draw-batch-cache.ts
~ src/scene-compiler.ts, gpu-renderer.ts
~ asset-world/model-detail.ts, AssetWorld.svelte, world-profile.ts
~ browser repros, consumer guide

authored variants -> validated geometry family -> one instance batch
structural sync -> prewarm every geometry level
camera/bounds -> frustum ranges -> cluster LOD ranges -> retained geometry draws
shadow pass -> unchanged full-detail geometry
```

## 4. Contracts and invariants

- Geometry families have at most four levels and strictly descending positive
  pixel thresholds. Hysteresis defaults to 10%; refine immediately above the
  threshold and coarsen below its lower hysteresis boundary.
- `BatchBounds` retains each cluster's largest individual bounding-sphere radius.
  LOD uses that radius and conservative cluster clip-depth limits, not the whole
  cluster's spatial diameter. Unknown bounds/near-plane intersections use high
  detail. Orthographic selection does not depend on camera distance.
- Renderer-owned selection retains per-cluster hysteresis and bounded ordered
  ranges (192 per batch). Overflow uses full-detail frustum ranges; no holes,
  duplicate instances or transparent-order changes. Cache by view, display size,
  bounds revision and visibility selection. No per-camera GPU uploads.
- All geometry levels are prewarmed and retained while the owning asset is live.
  Family bounds enclose every level, including after transforms. Invalid asset
  definitions fail during preparation, before they replace the active scene.
- Existing assets remain unchanged. High-detail shadow casters and picking stay
  independent of color LOD. Disposal releases resources and pending RAF as before.

## 5. Vertical slices and verification

1. Asset family through actual draw calls: validation, union bounds, perspective
   and orthographic pixel selection, hysteresis, range coverage/fallback, indexed
   and nonindexed draws, retained resources and sparse transform updates.
2. Compiled viewport tests at 60/120/144 Hz, both callback orders, real motion,
   demand/manual/disposal. Cross thresholds with no instance uploads or GPU
   resource creation; assert unchanged shadows and event/component lifetimes.
3. Asset-world toggle and diagnostics. Reuse existing 16x/4x/1x shared variants.
   Benchmark 50k overview/follow on hardware; compare fixed images, frame delivery,
   input continuity, desktop/mobile framing and actual submitted triangles.

Commit tested slices separately. If clustering/range budgets erase savings,
revisit the selection strategy before broadening the public API.

## 6. Risks and alternatives

Distance-based LOD is simpler but does not respond to field of view, object scale
or orthographic zoom. Screen size requires conservative projection math and can
over-select high detail for broad clusters. GPU compaction/indirect drawing is
a serious alternative but adds storage, compute and synchronization contracts;
measure the retained CPU range baseline first. Swapping assets through Svelte
every camera frame would rebuild scene batches and lose the intended fast path.

All LOD geometry is resident, trading memory for hitch-free switching. Asset
variants are authored and must share mesh transforms/layout; materials do not
switch. Existing geometry keys remain immutable resource identities. Disable
LOD by using the original asset. Diagnostics report reduced instances, avoided
color triangles and bounded-range fallback, separately from frustum rejection.

Reference patterns: [Three.js LOD](https://threejs.org/docs/pages/LOD.html) uses
authored levels and hysteresis. This implementation deliberately keeps resource
selection below the component lifecycle and uses projected size instead.
