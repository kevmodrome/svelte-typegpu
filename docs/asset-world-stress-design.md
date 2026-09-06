# Asset world stress mode

## 1. Scope and risk

Expand the playable example to 20,000 placed GLB models, with count and geometry
density varied independently (29 / 1k / 5k / 20k / 50k; 1x / 4x / 16x triangles).
Standard example-level risk plus performance-sensitive integration tests. Reuse
the nine bundled source assets, not 20,000 downloads. No renderer API, scheduler,
automatic culling, streaming, physics engine, or automatic quality reduction.

## 2. Current program model

`AssetWorld` loads immutable GLBs and owns DOM controls. `WorldViewport` owns the
canvas and composes the campsite and local-state `Player`. `player-controller`
uses SAT footprints but currently scans only the small campsite. `draw-batch-cache`
groups compatible imported primitives into instanced draws. Incremental scene
updates preserve static instance storage. `onready` exposes the root's public GPU
renderer methods; `onfps` already provides a bounded publishing cadence.

```text
load models -> raw assets -> keyed model nodes -> grouped primitive instances
input -> Player frameTask -> local transforms -> dirty instance uploads
```

## 3. Proposed program shape

```text
+ landscape.ts / Landscape.typegpu.svelte   deterministic retained placements
+ model-detail.ts                          cached flat subdivision of shared GLBs
+ WorldCamera.typegpu.svelte               camp / follow / overview cameras
+ world-profile.ts                         example-owned render CPU/batch metrics
~ AssetWorld / WorldViewport / Player      count/detail/view controls and follow pose
~ player-controller                        larger bounds and cell-indexed SAT queries
~ source registry and generated modules
+ layout/detail/profile tests and 20k compiled motion coverage
+ repros/asset-world-stress.mjs             actual submissions and browser timings
```

Flat Loop subdivision uses the established `three-subdivide` geometry utility;
Three.js is used only for geometry conversion, not rendering. Preserve shape,
material, UVs, normals, colors and alpha, with distinct immutable resource keys.
Each shared mesh is refined once per selected level. Resource work never enters
the frame task. The detail labels describe tessellation, not improved art assets.

```text
count/detail selection -> prepare shared resources/layout -> atomic scene props
  -> real keyed <model> instances -> existing batching (no hidden culling)
player -> nearby cell colliders -> transform + optional follow camera -> same RAF
renderer onready -> locally wrapped renderFrame/setScene -> onfps publishes metrics
```

## 4. Contracts and invariants

- A count includes the original 29 campsite models. Count reports come from the
  applied scene, separately from primitive-instance and triangle counts.
- Deterministic placement keys and coordinates form a stable prefix. Static
  placements, assets and collision cells are not rebuilt while moving.
- Geometry levels multiply imported triangle counts exactly by 4 per level, with
  validated 12-float vertex data and unmodified input assets. Preparation failures
  retain the last usable world; superseded work must not overwrite newer controls.
- Large-world collision checks visit nearby cells, not every model per frame.
  Old compact bounds, river banks and bridge crossing remain supported.
- Profiling wraps only this example's renderer, restores wrappers on disposal,
  adds no RAF/timer loop, and publishes through existing FPS samples. Render CPU
  is synchronous renderFrame duration, not GPU elapsed time or all JS activity.
  Counts distinguish color-pass workload from additional shadow work.

## 5. Vertical slices and verification

1. Deterministic large layout and shared density variants: exact counts/multipliers,
   bounds, prefix stability, interpolation/winding, caching, source immutability.
2. Compose the full scene, expand collision queries and add follow/overview controls
   and metrics. Verify input/cleanup, camera continuity and bounded collision work.
   Exercise a real 20k component with motion at 60/120/144 Hz, both callback orders,
   manual and demand modes; assert static uploads/resources remain unchanged.
3. Verify production/type/workspace checks. Capture desktop/mobile, near/overview,
   20k model draw counts, multiple polygon levels and real moving pixels. Record
   startup time, callback/frame rate, CPU work, buffer reuse and triangle load.

## 6. Risks and decisions

This intentionally exposes the current renderer's limits: all geometry is drawn
and structural changes can compile the whole scene. Software WebGPU can be far
slower than physical hardware; no fixed FPS claim follows from synthetic clocks.
Flat subdivision raises GPU work without changing the campsite's art style.
Higher levels remain opt-in beyond the initial 4x workload. Timings exclude GPU
timestamp queries rather than mislabeling CPU submission time as GPU duration.
Rollback is example-local; the core renderer and pinned Svelte preview stay intact.

## 7. Verified results

- Workspace: 1,472 passing tests (root 5, renderer 1,347, docs 86, example 34).
  Renderer TypeScript and the production docs build pass. The full suite includes
  the generated DOM example's Svelte type check.
- The real compiled Campsite, Landscape, Player and follow camera, using actual
  bundled GLBs at 4x density, pass all 18 Tween/Spring cases at 60/120/144 Hz.
  Both producer/renderer orders and manual mode retain one draw frame per clock
  step. Walking uploads only 13 instances (12 camper parts plus the external
  animation test mesh), reads 18 local transforms, and retains instance arrays,
  buffers, bind groups and pipelines. Demand settles; disposal cancels work.
- Geometry tests cover exact 4x/16x multipliers, bounds, normals, UV/color/alpha
  interpolation, winding, immutable inputs and cached variants. Layout tests cover
  every preset and stable prefixes. Collision queries stay below 55 candidates
  in sampled 20k and 50k worlds rather than scanning the scene.
- Desktop 1440px and mobile 390px software-WebGPU probes compare UI metrics with
  actual draw arguments: 20,000 models become 40,018 primitive instances in 33
  draws. Color triangles are 4,104,488 at 1x, 16,416,944 at 4x, and 65,666,768 at
  16x (terrain and camper geometry are not subdivided). The desktop probe also
  grows to 50k and shrinks back to the exact original workload.
- Follow-camera movement changes canvas pixels and delivers 7 rendered frames
  for 7 callbacks in each dense-world probe, with no new GPU resources. At this
  intentionally high load SwiftShader takes roughly 3 seconds for that sample;
  this is not a hardware GPU benchmark or a display-refresh measurement. Asset
  downloads remain nine. Idle worlds stop rendering. No uncaptured GPU errors.
- Desktop/mobile screenshots cover overview, follow, camp and 16x density.
  The overview uses an extent-scaled near plane (and matching orbit minimum) to
  avoid distant depth fighting. Mobile keeps a usable canvas without horizontal
  control overflow. Flat subdivision intentionally preserves the original art.
- The compact-world browser regression passes keyboard and captured mouse/touch
  movement, native model picking, focus/blur/reset/pause, shadows, dusk, reduced
  motion, failed asset retry and retained canvas identity. Canoe delivery is
  133/133 frames/callbacks on desktop and 131/131 on mobile in the sampled window;
  walking is 50/50 and 70/70 respectively, with stable GPU resources.
