# Frustum culling measurements

Measured on the Apple M4 Max's non-fallback Metal WebGPU adapter, using Chromium
GPU timestamp queries. 50,000 models, 100,018 candidate mesh instances, shadows
disabled. The desktop render target is 954 x 455 within a 1440px viewport.
These are observed browser/adapter results, not a physical-monitor refresh claim.

| Desktop follow view, 16x geometry | Raw | Frustum culled |
| --- | ---: | ---: |
| Submitted instances | 100,018 | 10,366 |
| Submitted triangles | 164,218,928 | 15,834,064 |
| Color draws | 33 | 213 |
| GPU mean | 78.73 ms | 7.89 ms |
| Delivered frames / second | 12.50 | 117.12 |
| Browser callback CPU mean | 2.92 ms | 2.81 ms |
| Frames / callbacks in sample | 50 / 50 | 469 / 469 |

89,652 instances were rejected without unmounting objects or uploading visibility
data. No range-budget fallbacks occurred. More draw calls were worthwhile because
they avoided approximately 90% of submitted geometry. GPU buffers, bind groups
and pipelines were reused throughout each sample.

At 1x geometry both follow-view modes delivered about 120 FPS, with GPU mean
falling from 5.03 to 2.48 ms. The overview submitted the same geometry with and
without culling: 16x remained around 79 ms / 12.7 FPS. This is expected when the
whole world is inside the camera. LOD, not more aggressive frustum rejection,
is the next appropriate optimization for that view.

At the final mobile size (360 x 400 canvas within a 390px viewport), the wider
vertical field of view includes more forest. The 16x follow view improves from
12.49 to 57.91 FPS and 78.88 to 16.47 ms GPU time, submitting 33,364,432 triangles
and 21,726 instances in 220 draws. It rejects 78,292 instances with no range
fallbacks. Both 1x modes remain around 120 FPS. View-dependent submitted geometry,
not canvas pixel count alone, explains the difference from desktop.

Frozen original-density canvas comparisons matched exactly in overview and
follow views at desktop and mobile sizes. The GPU sweep compares UI counters
with actual draw arguments and checks nonblank rendered pixels. The compact
playable regression additionally exercises shadows, native picking, touch
capture, reset, pause/blur, asset retry and visible character movement.
It passes at 1440px and 390px widths. Mobile now reserves a stable 400px canvas;
diagnostic wrapping cannot shrink the play area or push its starting character
behind the movement pad.

With culling enabled, the 50k-world input probe retained a held orbit gesture
while walking. Stop/start event-to-next-task measurements were 1.7-8.4 ms;
192 frames uploaded 214,848 instance bytes, confined to moving parts. GPU
resource counts remained stable and demand mode stopped after input settled.

Automated verification: 1,519 workspace tests, including 60/120/144 Hz compiled
Tween/Spring motion, both callback orders, demand/manual/disposal, indexed and
nonindexed instance offsets, conservative bounds, sparse refits, resource reuse
and an 80,000-case oblique-view bounds coverage check. Renderer TypeScript,
public Svelte types (zero errors/warnings) and the production documentation
build pass.

Reproduction commands and flags are in
[the probe README](../packages/svelte-typegpu/repros/README.md). The asset-world
example defaults to raw mode for comparable stress measurements; enable its
Frustum culling checkbox and choose Follow camper to compare. Ordinary scenes
enable culling by default, with `<scene frustumCulling={false}>` as an escape hatch.
