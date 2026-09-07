# Retained asset LOD results

## Configuration

Measured with the local docs example, Chromium headless shell and a non-fallback
Apple Metal adapter with timestamp queries. Each steady-state sample spans four
seconds after settling. The world contains 50,000 models, 100,018 candidate mesh
instances and 16x maximum triangle density; shadows are disabled. Desktop uses a
954 by 455 CSS-pixel canvas, mobile a 360 by 400 canvas. These are observed browser
callback/render rates, not proof of physical monitor refresh.

The example reuses equivalent flat-subdivided 16x/4x/1x geometry. This demonstrates
retained geometry selection and throughput, not automatic simplification or the
visual quality of independently authored low-poly assets.

## Desktop

| View | Mode | Color triangles | Draws | Instances drawn | GPU mean | FPS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Overview | Raw | 164,218,928 | 33 | 100,018 | 76.33 ms | 13.0 |
| Overview | Frustum only | 164,218,928 | 33 | 100,018 | 76.33 ms | 13.2 |
| Overview | LOD only | 10,263,998 | 33 | 100,018 | 5.61 ms | 120.1 |
| Overview | Both | 10,263,998 | 33 | 100,018 | 5.40 ms | 119.9 |
| Follow | Raw | 164,218,928 | 33 | 100,018 | 76.32 ms | 13.0 |
| Follow | Frustum only | 3,699,152 | 69 | 2,622 | 5.14 ms | 119.9 |
| Follow | LOD only | 143,240,030 | 603 | 100,018 | 66.53 ms | 14.7 |
| Follow | Both | 2,823,938 | 142 | 2,622 | 4.36 ms | 119.9 |

The overview eliminates 93.75% of color triangles with no extra draws. In the
follow view, combining both features saves another 875,214 triangles beyond
frustum culling. Combined follow callback CPU averages 2.18 ms, with 480 submitted
frames for 480 callbacks. GPU buffers, bind groups and pipelines remain unchanged
during steady camera/animation samples; prewarming LOD adds resident geometry
buffers when the asset family is installed.

## Mobile

| View | Mode | Color triangles | Draws | Instances drawn | GPU mean | FPS |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Overview | Raw | 164,218,928 | 33 | 100,018 | 76.31 ms | 13.0 |
| Overview | Frustum only | 164,218,928 | 33 | 100,018 | 76.30 ms | 12.7 |
| Overview | LOD only | 10,263,998 | 33 | 100,018 | 5.41 ms | 119.9 |
| Overview | Both | 10,263,998 | 33 | 100,018 | 5.21 ms | 119.9 |
| Follow | Raw | 164,218,928 | 33 | 100,018 | 76.41 ms | 12.7 |
| Follow | Frustum only | 18,975,184 | 101 | 12,382 | 9.06 ms | 101.9 |
| Follow | LOD only | 141,493,370 | 570 | 100,018 | 65.70 ms | 14.5 |
| Follow | Both | 2,713,258 | 212 | 12,382 | 4.08 ms | 120.1 |

The narrower aspect ratio changes camera framing and frustum membership. LOD
itself preserves the same candidate instance ranges as the corresponding
non-LOD mode. Combined follow has 481 submitted frames for 481 callbacks and
2.46 ms mean callback CPU.

## Conservative limits and visual checks

LOD is not visibility culling. Groups behind the camera or crossing the near
plane conservatively retain high detail. Without frustum culling, the follow
view reaches the 192-range budget in two batches and falls back to full-detail
ranges. That keeps draw work bounded and preserves coverage, but limits savings.
Both combined views have zero LOD range fallbacks. Enable both controls for the
large-world performance comparison.

Frozen, culled 16x-versus-LOD images remain nonblank and differ at less than the
0.5% allowed pixel fraction (a pixel counts when any RGB channel differs by more
than 10): desktop overview 0.0503%, desktop follow two pixels, mobile overview
0.1004%, mobile follow 0.0173%. Small rasterization differences are expected when
equivalent flat surfaces have different tessellation. Desktop/mobile screenshots
also verify stable canvas dimensions, visible characters, controls and diagnostics.

The hardware input probe passes with LOD and frustum culling enabled at 50,000
models and 16x maximum detail. Stop/start input handlers take 1.3-3.4 ms. Walking
continues during two portions of a held orbit drag; 259 frames upload 237,888
instance bytes with 1.88 ms mean callback CPU. Idle, resource reuse and bounded
moving-part upload assertions pass.

The compact software-WebGPU gameplay probe also passes at 1440- and 390-pixel
viewport widths with LOD enabled: visible keyboard/touch movement, simultaneous
animation, picking, input cancellation, pause/reset, reduced motion, day/dusk,
asset failure/retry and retained canvas identity. Animation submits 133/133 and
132/132 frames/callbacks; walking submits 52/52 and 67/67. These functional checks
are separate from the hardware throughput measurements above.

## Automated verification

- 1,566 workspace tests pass: 1,438 renderer, 89 docs, 34 example and 5 root tests.
- Renderer TypeScript build, public Svelte types (zero errors/warnings), and
  production docs build pass.
- Compiled viewport and real Tween/Spring tests cover 60/120/144 Hz, both demand
  callback orders, manual mode, settled idling and disposal.
- Camera-only threshold crossings allocate no new GPU resources and upload no
  instance data. Sparse instance changes retain their slots and targeted writes.
- Tests cover hysteresis, bounded ranges, indexed/nonindexed geometry, frustum
  membership, oblique projection bounds, transparent order and full-detail shadows.

See the [design](./lod-design.md), [consumer API](./renderer-feature-guide.md), and
[repeatable browser commands](../packages/svelte-typegpu/repros/README.md).
Local raw reports and screenshots are under `/tmp/typegpu-lod-overview`,
`/tmp/typegpu-lod-follow`, `/tmp/typegpu-lod-mobile`, `/tmp/typegpu-lod-input` and
`/tmp/typegpu-lod-gameplay`;
these machine-local artifacts are not committed.
