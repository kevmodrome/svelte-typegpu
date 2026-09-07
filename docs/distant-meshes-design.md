# Distant asset representations

## 1. Scope and risk

First measured step toward HLOD/impostors: add an opt-in, below-original geometry
level for asset-world trees, rocks and logs. Retain ordinary `<Tree />` components,
canonical instance slots, full-detail picking and shadows. No billboard shader,
alpha cutout, cluster ownership, automatic component replacement or new RAF.
Standard risk: example asset preparation and async UI state change; the renderer
contract and selection algorithm do not change.

## 2. Current program model

`model-detail.ts:lodWorldAssets` currently ends at the original GLB, even when
16x subdivision is enabled. `Tree.typegpu.svelte` forwards a shared asset to
`<model>`. `lod.ts:createModelLod` requires matching mesh names, transforms and
layouts, retains base materials and unions bounds. `LodSelection` owns cached
screen-height selection; `gpu-renderer.ts` prewarms all geometry variants.

```text
AssetWorld.rebuild -> 16x/4x/original shared assets -> Tree/model
  -> retained batches -> frustum + screen-height LOD -> color draws
```

## 3. Proposed program shape

Use MeshoptSimplifier only during preparation. The spike used Three's bundled
copy; implementation uses the typed, pinned package in the docs app, lazy-loaded
from its simplifier entry point. The renderer gains no dependency.
Weld duplicate complete vertices with Three's mergeVertices before simplification;
the imported nonindexed meshes otherwise cannot simplify. Preserve weighted
normal, UV and color attributes. Compact output vertices. Prepare only the four
repeated landscape assets, cache per source, and keep the current world visible
until a complete replacement is ready. A fifth level is unnecessary: 16x, 4x,
original and distant fit the existing four-level limit.

```text
+ asset-world/distant-meshes.ts, tests; docs-only meshoptimizer dependency
~ model-detail.ts: optional prepared distant assets, cached geometry families
~ AssetWorld.svelte: opt-in checkbox, generation check after async preparation
~ generated example source registry, compiled motion tests, browser probes
```

```text
rebuild -> optional lazy simplifier import/ready -> cached distant assets
  -> createModelLod(..., { maxScreenHeight: 12, asset: distant }) -> existing path
camera motion -> existing selection only (no preparation or Svelte lifecycle)
```

## 4. Contracts and invariants

- `prepareDistantWorldAssets(source): Promise<WorldAssets>` caches one preparation
  promise per immutable source; failures evict the cache so retry is possible.
- Every level remains nonempty, finite, inside original bounds, and no denser.
  Tiny, alpha-bearing, textured or unsupported meshes retain original geometry.
  No material or mesh transform changes. Inputs are never mutated.
- Fixed target ratio 20%, maximum relative simplifier error 5%; this is an
  approximation metric, not a promised pixel-perfect visual error bound.
- Preparation is per shared asset, never per placement or render frame. All
  variants are resident while enabled. Toggle off restores the prior family.
- Rebuild's revision token is checked after awaiting; stale completion, reload
  and unmount cannot replace the active world or clear a newer preparation state.
- Existing LOD defaults and its pixel-identical subdivision comparison remain
  unchanged. Distant geometry is an independent, explicitly lossy opt-in.

## 5. Vertical slices and verification

1. Shared distant assets: actual GLB tests for reduction, bounds, attributes,
   identity, index validity, cache reuse and unsupported fallback. Commit.
2. Declarative UI + families: test 1x/4x/16x composition and concurrent preparation;
   run real compiled 20k component motion with prepared levels at 60/120/144 Hz,
   both producer orders, demand/manual/disposal and sparse writes. Commit.
3. Real GPU A/B at 50k: overview/follow, baseline LOD vs distant; identical camera,
   alternate measurement order, record GPU/CPU/callbacks/triangles and resources.
   Inspect desktop/mobile images, input movement+orbit, idle and no overflow.
   Document observed quality/performance and commit verification.

## 6. Alternatives and rollout

True impostors need per-level materials, masked depth/shadow semantics and view
selection. HLOD also changes grouping/selection ownership across model nodes.
Those are separate renderer contracts, not implied by this option. Authored
offline low-poly assets are a good eventual production choice; this small example
uses meshoptimizer to establish whether below-original geometry helps.
Do not add a runtime dependency to the renderer. If GPU savings or visual quality
are poor, keep the option off and use the measurements to guide the next feature.

Algorithm reference: [meshoptimizer simplification](https://meshoptimizer.org/).

## Implementation review

All three slices are complete. No renderer API or scheduling path changed.
Use the typed docs-only meshoptimizer package rather than untyped declarations
for Three's bundled copy. The existing compiled 20k-world motion matrix now uses
the actual prepared assets; additional compiled DOM tests cover async races.
Real GPU comparisons confirm strong overview savings and a mobile-follow
triangle/draw/CPU tradeoff. The option remains off by default. True HLOD and
impostors were not implemented in this first slice. See
[measured results and the remaining cold-input latency](./distant-meshes-results.md).
