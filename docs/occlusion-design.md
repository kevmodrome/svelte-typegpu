# Optional current-frame Hi-Z occlusion

## 1. Scope and risk

Add `<scene occlusion="hi-z">`, disabled by default. Reduce opaque color work
after frustum selection and authored LOD without changing component lifetime,
simulation, picking, shadows, or frame scheduling. This is high-risk: GPU
visibility, indirect arguments, resource lifetime, and performance are contracts.
No temporal reprojection, transparent sorting changes, or automatic mesh LOD.

## 2. Current program model

`scene-compiler.ts` produces canonical batches and `BatchBounds`.
`gpu-renderer.ts` owns resource caches and the single renderer RAF. Each frame:

```text
frame handler -> resize/uniforms -> full shadow pass
  -> frustum ranges -> LOD ranges -> direct color draws -> FPS sample
```

`resource-caches.ts` retains canonical instance buffers and uploads dirty ranges.
`batch-visibility.ts` owns conservative world AABBs in canonical instance order.
Camera movement does not repack or upload canonical instances.

## 3. Proposed program shape

```diff
+ src/occlusion.ts              retained GPU resources and bounded selection
+ src/occlusion-shaders.ts      max pyramid, visibility scan, stable compaction
+ src/occlusion.test.ts         metadata, fallbacks, lifetime and GPU contracts
~ src/gpu-renderer.ts           optional prepass/compute and indirect color draws
~ src/resource-caches.ts        storage-capable canonical instance buffers
~ src/{types,scene-compiler,primitives}.ts  opt-in scene setting
+ repros/occlusion-*.mjs        actual WebGPU correctness and total-cost probe
~ apps/docs                    occlusion example and documented limitations
```

```text
frame handler -> resize/uniforms -> full shadow pass
  -> existing frustum/LOD ranges
  -> optional actual opaque occluder depth (same camera, same frame)
  -> max-depth pyramid -> local visibility/prefix -> range block scan
  -> stable compacted instance buffer + indirect arguments
  -> existing color queue, using indirect draws for eligible ranges
```

Normal direct drawing remains the fallback. Select only a bounded set of small,
opaque, untextured batches as depth occluders; use their actual mesh triangles,
not enclosing boxes. Large instanced batches are candidates, not expensive
occluders. A wall-heavy example makes this tradeoff measurable.

## 4. Contracts and invariants

- `TypeGpuRenderSettings.occlusion?: 'none' | 'hi-z'` is reactive.
- `HiZOcclusion` owns textures, compute pipelines, per-batch buffers and groups.
  The scene renderer owns and disposes it; it never owns a clock or invalidates.
- Request `indirect-first-instance` as an optional device feature. Missing
  features, limits, depth, useful occluders, or supported scene semantics use
  direct drawing. No synchronous GPU readback or device recreation.
- Full-resolution depth is reduced with **max**, padding uncovered pixels with
  far depth. Holes remain holes. Unknown, nonfinite, near-plane and numerically
  uncertain bounds remain visible. Bounds expand during float32 packing.
- Compaction is stable within each existing frustum/LOD range. Canonical CPU
  slots, resource keys, LOD policy, and shadow submissions stay unchanged.
- Bounds upload only on instance/bounds changes; camera motion only updates
  uniforms and bounded range metadata. All GPU buffers grow geometrically and
  are reused, pruned on structural changes, and destroyed on disposal.
- Occluders bypass self-culling. Transparent/textured/custom materials bypass
  the first version. Shader passes and nonstandard depth writers disable the
  whole path because they can invalidate ordinary opaque depth ordering.
- Current CPU counters are explicitly marked as upper bounds when indirect
  visibility is active. Actual GPU counts are verified by the browser probe;
  rendering never waits for statistics and statistics never schedule frames.

## 5. Vertical slices and verification

1. One opaque wall plus many hidden meshes: compile the scene setting, build
   current-frame depth/Hi-Z, issue indexed and nonindexed indirect draws. Check
   actual GPU arguments and image equivalence with occlusion disabled.
2. Preserve LOD ranges, motion, resize, toggles, teardown, sparse uploads, and
   resource reuse. Exercise real compiled Svelte motion at 60/120/144 Hz in both
   producer orders; demand settles, manual has no RAF, disposal cancels work.
3. Add a consumer-facing wall/courtyard example and a reproducible hardware
   probe. Compare total prepass + compute + color GPU time, CPU time, and frame
   delivery against direct drawing; also measure the open-world no-win case.

Review after each slice; shader validation and hardware results may simplify or
change buffer organization before expanding the integration.

## 6. Risks, alternatives, rollout and recovery

Previous-frame depth is cheaper, but requires reprojection/disocclusion recovery
and can hide newly revealed geometry. Current-frame depth is the conservative
initial choice. One indirect draw per tiny cluster avoids compaction but can
multiply CPU draw encoding costs; stable per-range compaction preserves bounded
draw count. Unordered atomic append is cheaper but changes equal-depth ordering.

Occluder heuristics are deliberately narrow, not a guarantee of speedup. Open
forests can lose because little is hidden; default-off and an explicit state in
statistics make that visible. No asset/API migration is required. Roll back by
removing the scene option. Device-loss recovery remains the existing viewport
retry path; occlusion resources are never reused across a destroyed renderer.

Unknowns to resolve with the first hardware slice: driver costs of the prefix
and copy passes, pyramid bandwidth at high DPR, and useful occluder budgets.
