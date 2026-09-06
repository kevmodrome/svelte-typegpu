# Asset world performance investigation

## 1. Scope and risk

Measure the reported 50k / 16x slowdown on the real Apple GPU, and fix movement
restart stalls and simultaneous follow/orbit input. Standard risk: two bounded
renderer paths, no public API changes or automatic quality reductions.

## 2. Current program model

- `model-detail.ts` and `glb-loader.ts` expand triangles to nonindexed vertices.
  164,218,928 triangles therefore approach 493 million vertex records per frame.
- `world-profile.ts` measures synchronous `renderFrame`, not GPU execution.
- `svelte-renderer.ts:flushScene` reconciles frame tasks on activation changes.
  `FrameTasks.reconcile` currently walks the whole scene. Combining FrameTasks
  with a transform also rejects `scene-compiler`'s incremental path.
- `camera-interaction.ts:reconcile` treats every position/target change as a new
  input state and cancels dragging, including follow-camera translations.

```text
keydown -> task.active / stride -> whole task scan + full scene rebuild
walking -> follow position + target -> orbit gesture cancellation
renderFrame -> queue.submit -> GPU execution (outside Render CPU measurement)
```

## 3. Proposed program shape

```text
+ repros/asset-world-gpu-profile.mjs       Apple/Metal GPU timestamp diagnostics
~ src/frame-tasks.ts                      cache task candidates by tree revision
~ src/scene-compiler.ts                   allow task changes in incremental updates
~ src/camera-interaction.ts               translate pending orbit with a follow pose
~ focused unit / real compiled motion tests / live input regression
```

Retain existing scheduling and explicit camera-reset semantics. A same-node,
same-controller translation of both position and target preserves input; other
pose changes, switching cameras, disabling controls and disposal still cancel it.
Measure full-resolution and tiny-scissor passes to distinguish geometry work
from shaded pixels, and 1x/4x/16x at fixed model count. No production profiling API.

## 4. Contracts and invariants

Task discovery changes only when root/treeRevision changes. Reconciliation reads
candidate attributes and ancestor visibility, preserving priority/tree order and
snapshot/disposal semantics. FrameTasks-only or combined transform changes retain
static batches and GPU resources. Follow translation rebases the pending orbit
target exactly once without dropping pointer deltas, held keys or touch gestures.
The diagnostic uses a bounded asynchronous timestamp-readback pool, never blocks
rendering on GPU completion, and refuses software adapters by default.

## 5. Vertical slices and verification

1. Record hardware baseline with adapter identity, real GPU durations, callback
   cadence, CPU callback time, draw counts and geometry density/resolution sweeps.
2. Add failing restart/candidate-scan tests and pure-translation gesture tests;
   fix those paths. Exercise 60/120/144 Hz, both callback orders, demand/manual,
   unchanged static uploads, resource reuse, idle and disposal.
3. Run workspace/type/build checks and real-browser move-stop-start plus drag
   while walking. Record measured limitations separately from fixed regressions.

## 6. Risks and decisions

Triangle-count stress deliberately disables LOD/culling. Thirty-three draw calls
do not mean thirty-three cheap draws. Index preservation, precomputed instance
rotation and visibility/LOD are separate opportunities to measure, not grounds
to silently change the benchmark. Timestamp queries require an optional feature;
missing hardware access must be reported rather than replaced with SwiftShader
performance claims. Rollback is confined to the two runtime paths and diagnostics.

## 7. Observations and results

Hardware was confirmed as an Apple M4 Max with 40 GPU cores. Chromium selected
the non-fallback Apple / metal-3 WebGPU adapter. The color buffer was 954 x 455;
shadows were disabled. The default overview submitted all 50,000 models in 33
draws. GPU durations came from pass timestamp queries, not CPU submission time.

| Density | Triangles/frame | Nonindexed vertices/frame | GPU mean | Delivered FPS |
| --- | ---: | ---: | ---: | ---: |
| 1x | 10,263,998 | 30,791,994 | 9.36 ms | 91.4 |
| 4x | 41,054,984 | 123,164,952 | 39.87 ms | 24.2 |
| 16x | 164,218,928 | 492,656,784 | 79.32 ms | 12.7 |
| 16x, one-pixel scissor | unchanged | unchanged | 79.10 ms | 12.7 |

CPU RAF callbacks averaged 2.47-2.65 ms. At 16x the normal pass delivered 51
frames for 51 callbacks in the four-second sample. Removing almost all pixel
shading made no material difference, identifying geometry processing as the
dominant GPU cost. This reproduces the reported roughly 11 FPS without a
renderer-introduced alternate-frame scheduling bug. These are observed session
measurements, not universal hardware performance guarantees.

The GLB loader discards original indices and the subdivision helper also returns
nonindexed triangles. Every vertex uses the general mesh shader's Euler
rotations, normal rotation and world/view transformation. There is no frustum
culling or LOD. Instancing saves CPU draw calls and shared resource memory; it
does not eliminate the per-instance geometry work. In this stress scene extra
subdivision leaves the silhouettes unchanged and produces many tiny triangles.

Separate interaction regressions were reproduced before fixing:

- In real compiled 20k component tests, stopping normal gait reread 40,038 local
  transforms because combined FrameTasks/Transform invalidation rebuilt batches.
  Task-only changes also rediscovered every static scene node.
- With normal gait at 50k models, live key-up/restart processing took 299-338 ms.
  The profiler did not expose these Svelte/microtask flushes outside renderFrame.
  After caching task candidates and keeping task/transform changes incremental,
  the same sequence took 1.4-3.3 ms, with unchanged GPU resource counts.
- Follow translations reset the orbit drag and could cancel its pending callback.
  Before the fix both halves of the held live drag produced zero camera rotation.
  After preserving same-camera translations and rebasing the pending orbit
  target, both halves rotate while the camera follows the moving camper.

The GPU benchmark was deliberately not reduced by the interaction fixes. Next
GPU-focused work should preserve/reconstruct indexed geometry without merging
normal/UV/color seams, measure moving invariant rotation work out of the vertex
shader, then add explicit visibility/LOD policies for worlds. Keep a raw all-draw
stress mode so optimizations can be compared on the same workload.

Reference: the WebGPU project's [timestamp-query sample](https://webgpu.github.io/webgpu-samples/?sample=timestampQuery)
demonstrates GPU-side timing. Reports and screenshots from this run are in
`/tmp/typegpu-asset-world-gpu`, `/tmp/typegpu-asset-world-input-before`, and
`/tmp/typegpu-asset-world-input-after`.

## 8. Final verification

- All 1,479 workspace tests pass: root 5, renderer 1,354, docs 86, example 34.
  Renderer TypeScript and a clean regenerated production docs build pass.
- The 18 real compiled 20k Tween/Spring tests now cover start, stop and restart,
  including bounded transform reads/uploads on those transitions, at 60/120/144
  Hz in both callback orders and manual mode. Six additional orbit/follow tests
  exercise both event orders at those same rates. Existing explicit reset,
  camera-switch, lens-change, touch and disposal semantics remain covered.
- The live hardware input probe passes with stable buffers, bind groups and
  pipelines, visible simultaneous rotation/translation and settled demand mode.
  The compact desktop/mobile probe also passes keyboard, captured mouse/touch,
  picking, pause, blur, reset, shadows, reduced motion and retry. Walking delivers
  52/52 and 71/71 frames/callbacks respectively.
- The post-fix GPU sweep confirms the high-density bottleneck: 16x averages
  80.77 ms at 12.5 FPS (50 frames / 50 callbacks); one-pixel scissor averages
  80.72 ms. CPU callbacks average about 3.1 ms. The 1x/4x cases measured 5.58 /
  20.26 ms and 120 / 48 FPS in this later sweep. Lower-density results varied
  between runs; no GPU shader/draw workload was changed, so these differences
  must not be attributed to the interaction fixes. The persistent ~80 ms result
  at 16x is the relevant reproduction. Post-fix reports are in
  `/tmp/typegpu-asset-world-gpu-after`.
