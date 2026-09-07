# Distant mesh LOD

## Consumer behavior

In `/examples/asset-world`, enable **LOD**, then **Distant meshes**. Frustum
culling is recommended for the follow view. The option adds a below-original
representation for trees, rocks and logs, including at 1x triangle density.
Other assets are unchanged. The default remains off because this is lossy LOD.

The existing `<Tree {assets} />`, `<Rock {assets} />` and `<Log {assets} />`
components do not inspect the camera or swap their children. Shared preparation
calls `createModelLod`; the renderer selects geometry by conservative screen height
with hysteresis. No IDs, registrations, additional frame tasks or Svelte unmounts
are involved. Picking and shadow geometry retain the original full-detail path.

`prepareDistantWorldAssets` lazily loads the pinned docs-only meshoptimizer
simplifier. It welds identical complete vertices, simplifies with weighted normal
and color attributes, and compacts indices/vertices. Target triangle count is 20%
of the source with maximum relative simplifier error 5%; the error limit can stop
reduction early. This is not a mathematical screen-pixel error guarantee.
Textured, alpha-bearing, custom-shader, tiny and unsupported meshes retain their
original geometry. Material appearance, UVs and mesh transforms are not replaced.

Preparation is synchronous CPU work after module readiness, once per shared
asset set, not per instance or frame. Results and in-flight preparation are cached;
errors permit retry. Stale UI requests cannot replace a newer world. For production
assets, offline authoring/baking avoids this one-time preparation cost.

## Desktop measurements

September 7, 2026. Chromium on a non-fallback Apple Metal adapter, 50,000 models,
16x maximum detail, frustum + authored LOD enabled, Hi-Z and shadows disabled.
Canvas: 954 by 455. Each row averages two four-second color-pass GPU samples in
baseline/distant/distant/baseline order, with matching camera history. These are
browser/GPU observations, not physical monitor refresh or end-to-end frame times.

| View | Distant | Triangles | Draws | Instances | GPU color mean | Callback CPU mean |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Overview | Off | 10,263,998 | 33 | 100,018 | 4.95 ms | 3.01 ms |
| Overview | On | 3,577,681 | 33 | 100,018 | 3.11 ms | 3.24 ms |
| Follow | Off | 2,771,510 | 149 | 2,622 | 4.44 ms | 3.11 ms |
| Follow | On | 2,762,846 | 155 | 2,622 | 4.36 ms | 3.05 ms |

Overview saves 65.1% of submitted color triangles and about 37% of measured color
GPU time. Follow saves only 0.31% of triangles and adds six draws: its visible
objects are mostly larger than the conservative 12-CSS-pixel threshold. The small
follow timing difference is not evidence of a reliable speedup. All samples
delivered one frame per browser callback, around 120 Hz, and created no additional
buffers, bind groups or pipelines during the steady measurement windows.

Frozen overview images differ at 0.845% of pixels (any RGB channel difference
above 10); follow differs at zero pixels. The reduced scene remains nonblank and
the camper and nearby assets remain intact. This image check is a regression
guard, not a perceptual guarantee for all cameras. Camera-only LOD crossings use
existing resident geometry and do not upload instance transforms.

## Mobile viewport

Same desktop Apple GPU, 390-pixel viewport and 360 by 400 canvas; this is not a
phone GPU benchmark. The example deliberately changes its follow framing at this
size, showing 12,382 instances instead of 2,622.

| View | Distant | Triangles | Draws | GPU color mean | Callback CPU mean |
| --- | --- | ---: | ---: | ---: | ---: |
| Overview | Off | 10,263,998 | 33 | 4.87 ms | 2.89 ms |
| Overview | On | 3,577,681 | 33 | 2.91 ms | 2.93 ms |
| Follow | Off | 2,654,200 | 198 | 3.97 ms | 3.08 ms |
| Follow | On | 2,161,344 | 389 | 3.10 ms | 3.39 ms |

Mobile follow removes 18.6% of triangles but adds 191 draws and about 0.31 ms of
callback CPU work. There are no range fallbacks. This is a real tradeoff, not a
universal optimization. All measurement windows still deliver matching frame and
callback counts around 120 Hz. Overview/follow frozen pixel differences are
0.782%/0.158%; screenshots show nonblank scenes and controls fitting without
horizontal overflow.

## Verification and limitations

- All 1,658 workspace tests pass, including real compiled 20k-model components
  with actual Tween/Spring at 60/120/144 Hz, both producer callback orders,
  demand settling, manual mode, disposal, targeted uploads and GPU resource reuse.
- Geometry tests check actual GLB reduction, nonempty compact indices, exact
  retained vertex attributes, source bounds, immutable inputs and cache reuse.
- Compiled DOM tests exercise late success/failure, superseding options and
  unmount during preparation. Existing full-detail shadow/LOD tests remain green.
- Renderer TypeScript/public Svelte checks and production docs build pass.
- The 50k input probe passes with distant LOD, frustum culling, Hi-Z and GPU
  timings enabled: both portions of a held orbit drag rotate while walking,
  buffers/groups/pipelines stay stable, and demand mode becomes idle afterward.
  In this forest Hi-Z reports `no-occluders`, so this checks its fast bypass; the
  existing occlusion fixture covers actual indirect compaction.

The input run submitted 195 frames with 218,304 instance bytes, not whole-forest
uploads. Its first keydown-to-next-task sample took 33.9 ms; later starts took
5.5/8.9 ms and releases 2.2-2.8 ms. The identical baseline without distant meshes
measured 26.1 ms first, 12.8/6.1 ms later, and 1.9-3.6 ms releases. These few samples
do not establish a latency regression or equivalence. Cold input remains above
the 8.33 ms 120-Hz frame budget and deserves separate investigation; the existing
100 ms probe guard only excludes the old whole-scene rebuild failure.

This is geometry LOD, not HLOD or a billboard impostor. It does not reduce Svelte
component count, simulation cost, shadow triangles or texture bandwidth. Proper
impostors still need per-level material selection and alpha-cutout depth/shadow
contracts; HLOD additionally needs ownership and selection across model groups.
The renderer API is unchanged and gains no meshoptimizer dependency.

Raw local reports and images: `/tmp/typegpu-distant-desktop`,
`/tmp/typegpu-distant-mobile`, `/tmp/typegpu-distant-input`. They are not committed.
See the [design](./distant-meshes-design.md),
[consumer guide](./renderer-feature-guide.md#authored-asset-lod) and
[repeatable probes](../packages/svelte-typegpu/repros/README.md).
