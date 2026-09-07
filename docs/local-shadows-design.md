# Camera-local directional shadows

## 1. Scope and risk

Make the asset world's shadows usable at 50,000 models without changing mounted
components or scheduling. High risk: projection, shader uniforms and declarative
light attributes cross compiler/runtime/GPU boundaries. One directional map stays
supported; cascades, alpha-tested shadows and Hi-Z shadow rejection are non-goals.

## 2. Current program model

`scene-compiler.ts -> draw-batch-cache.ts` owns canonical instance storage and
incrementally refitted `BatchBounds`. `gpu-renderer.ts:#drawFrame` currently calls
`shadowBoundsForDrawBatches` (all instances, every frame), fits one world-sized
map, then submits all base-geometry casters. Color visibility and `LodSelection`
already retain bounded canonical ranges, independently of component lifecycle.

## 3. Proposed program shape

```text
~ src/draw-batch-cache.ts       retain bounds for shadow participants too
+ src/shadow-camera.ts         stable local fit and camera-depth plane
~ src/gpu-renderer.ts          batch-root fit; light-space visibility and LOD
~ src/lights.ts, types.ts      shadowDistance and shadowLod
~ src/typegpu-{layouts,pipeline}.ts  distance fade, padded 96-byte uniform
~ src/occlusion.ts             pad the shared depth-pass uniform to 96 bytes
~ apps/docs/.../WorldLighting.typegpu.svelte  enable local shadows
```

Flow: sparse instance update -> existing bounds refit -> merge batch roots ->
stable light projection -> independent light-space ranges -> optional shadow LOD
using the same geometry variants and instance buffers -> depth map -> color pass.
No new animation loop, readback, instance compaction or scene traversal.

## 4. Contracts and invariants

- `shadowDistance?: number`: positive finite camera-forward depth in world units,
  capped at camera far. Unspecified/invalid keeps full-scene coverage. The last
  10% fades to unshadowed lighting. Perspective and orthographic cameras work.
- `shadowLod?: boolean`: false by default. Reuses authored geometry thresholds in
  shadow-map texels, with independent hysteresis/history from color selection.
  Missing levels keep base geometry. Shadow silhouettes may differ when opted in.
- Local XY coverage encloses the camera slice with rotation-invariant dimensions
  and a texel-snapped light-space center. Z includes scene bounds, retaining
  upstream offscreen casters. Camera color culling never removes shadow casters.
- Bounds/selection overflow fails open. Retained bounds refit only changed slots;
  geometry, instance storage, bind groups and pipelines survive camera movement.
- Standalone raw draw-batch helper callers without retained bounds keep a fallback
  bounds calculation; compiled scenes use roots, not the per-instance scan.
- Shadow diagnostics count submitted triangles, ranges, candidates and LOD savings.

## 5. Vertical slices and verification

1. Stable local map and retained bounds: unit coverage of perspective/orthographic
   corners, depth order, texel snapping, sparse refits and light prop normalization.
2. Light-space culling/LOD and fade: indexed/nonindexed commands, offscreen caster
   retention, camera-only resource reuse, compiled real Tween/Spring motion at
   60/120/144 Hz in both callback orders, demand/manual/disposal invariants.
3. Example and evidence: actual Metal GPU pixels, stationary/moving views and
   50,000-model 1x/16x shadow timings against the recorded baseline. Test simultaneous
   movement/orbit; run full suites and production build outside GPU measurements.

## 6. Risks and rollout

Cascaded maps are the serious alternative: better resolution over a wide depth
range, but additional maps/passes and split blending are a larger independent
change. A local single map is the smaller testable improvement. Raising resolution
alone does not address the measured CPU scan or 164M shadow triangles.

Compatibility: opt-in finite coverage and shadow LOD; no source migration needed.
The example opts in declaratively. Unknown bounds conservatively retain draws;
callers should supply valid geometry bounds for reliable map fitting. Finite
coverage intentionally gives distant receivers no shadow. Revert the two example
attributes to restore full-scene/base-geometry policy. Existing GPU pass timings
plus added shadow counts expose cost and fallback behavior. Final measurements
and limitations will be recorded separately before pushing main.

Implementation evidence: medium batches (256-4095 instances) also need the
structural spatial ordering used by large batches; otherwise 32-slot bounds can
span a whole world. The 20,000-model frame tests caught this. Shadow LOD gets a
bounded 384-range budget (color remains 192), since its wider footprint exhausted
the color-sized budget in the 50,000-model/16x GPU benchmark. Neither change
introduces per-frame sorting or expands canonical instance uploads.
