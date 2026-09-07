# Local directional shadow verification

## Reproduction

Measured September 7, 2026 on the local Apple Metal adapter (not a fallback GPU),
Chromium 1228, 1440x1100 page, 954x455 canvas. Asset world: 50,000 models,
100,018 candidate instances, follow camera, frustum culling, authored LOD and
Distant meshes enabled. Hi-Z disabled for the timing comparison. Shadows use
2048x2048 in both versions. GPU timing is the renderer's opt-in timestamp-query
diagnostic; no build/test jobs ran during the measurements.

Baseline is main `2fbba32`, from the preceding shadow diagnosis. The local-map
policy uses `shadowDistance={80} shadowLod`. Each row follows 2.5 seconds of warmup
and about 4.2 seconds of sampling. Browser callbacks and rendered frames matched
one-for-one. Approximately 120 Hz is the observed browser delivery rate, not a
promise about a physical display or other GPU/browser configurations.

| Density | Shadows | Before FPS | After FPS | Before shadow GPU | After shadow GPU | Before shadow triangles | After shadow triangles |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1x | off | 120.0 | 119.9 | 0 ms | 0 ms | 0 | 0 |
| 1x | on | 50.3 | 120.0 | 3.71 ms | 0.33 ms | 10,263,862 | 762,736 |
| 16x | off | 120.0 | 120.1 | 0 ms | 0 ms | 0 | 0 |
| 16x | on | 13.2 | 119.9 | 68.01 ms | 0.78 ms | 164,218,792 | 2,777,320 |

Color work stayed identical: 224,056 triangles at 1x, 2,816,482 at 16x. The shadow
pass submitted 7,864 instances, independently of the 2,622 color instances.
At 16x there were 429 shadow ranges and no fallbacks; shadow LOD saved another
9,423,456 triangles after light-space culling. Total measured color+shadow GPU
time was 2.24 ms. Shadow CPU preparation/encoding was about 0.40 ms.

Average whole-callback CPU at 16x fell from 21.27 ms to 4.09 ms. The diagnostic
span from scene-uniform upload to shadow-uniform upload (bounds/projection setup)
fell from 16.79 ms to 0.010 ms. Shadow texel coverage improved from 1.338 to
0.0815 world units. Screenshots show defined nearby silhouettes in place of the
previous large blurred patches. This trades global coverage for local detail;
it is not a like-for-like world-wide high-resolution shadow map.

## Correctness and frame delivery

- `shadow-camera.test.ts`: perspective/orthographic frustum corners at narrow and
  wide aspect ratios, WebGPU depth order, upstream offscreen casters, texel-snapped
  movement, rotational scale stability, normalized props and sparse bounds refits.
  A throwing packed-instance getter guards the retained-root bounds path.
- `asset-world-player-motion.test.ts`: the real compiled world components with
  real Tween/Spring at 60/120/144 Hz, both external callback orders and manual
  mode. Exactly one color and one shadow pass per delivered frame, 13 x 96-byte
  moving-instance uploads, no forest uploads or new buffers/groups/pipelines.
  Demand settles, manual schedules no renderer RAF, disposal cancels pending work.
- `repros/local-shadows.mjs`: real GPU pixels at 1000x700 and 390x740. A caster
  outside the color view casts onto visible ground; lateral casters are rejected.
  Shadow LOD switches nonindexed 720-triangle geometry to indexed 80-triangle
  geometry without new GPU resources or uploads. Distance fading lightens the
  result, moving the caster restores its previous shadow pixels, and sub-texel
  camera translation leaves the shadow XY matrix unchanged. Manual/disposal idle
  and WebGPU validation are checked.
- `repros/asset-world-input.mjs`, with shadows, 50,000 models and 16x detail:
  both segments of a held orbit gesture rotate while walking. No GPU resource
  creation; 214,848 bytes across 192 frames, within the sparse moving-object
  budget. Measured movement toggles were 1.7-5.4 ms in that run.
- Requesting Hi-Z together with shadows also retained sparse uploads and working
  simultaneous input. This forest view selected no occluders, so it does not
  establish active Hi-Z correctness. Its first cold keydown took 42.1 ms;
  subsequent toggles took 1.9-5.7 ms. Cold-start input latency remains a separate
  follow-up, not a guaranteed one-frame result.

The shared shadow/Hi-Z vertex uniform is padded to 96 bytes in both paths. The
dedicated occlusion GPU probe passed with shadows enabled: zero changed visible
pixels in every on/off comparison, including moving views, removed walls,
indexed LOD, 390/1440-pixel resize and near-plane motion. With walls, Hi-Z kept
1,108 of 6,000 candidates while shadow casters stayed independent. The steady
active path delivered 300 frames for 300 callbacks (119.9 FPS), with no new GPU
buffers/groups/pipelines. GPU diagnostics simultaneously reported shadow, Hi-Z
depth/pyramid/selection and color timings with no validation errors.

Final automated verification: 1,666 tests passed (1,526 renderer, 101 docs,
34 example, 5 workspace). TypeScript build, public Svelte type checks (zero
warnings) and the docs production build passed. Run generation/build separately
from tests: the docs generator replaces files that runtime fixtures import.

## Running the probes

From `packages/svelte-typegpu`, set `SVELTE_PROBE_BROWSER_DEPENDENCIES` to a
directory containing Playwright and pngjs, and `SVELTE_PROBE_CHROMIUM` to a WebGPU
Chromium executable. Start the docs server separately and set `SVELTE_PROBE_URL`
to its asset-world page. All probes close their test browser on completion.

```sh
TMPDIR=/tmp node --experimental-strip-types repros/local-shadows.mjs
TMPDIR=/tmp node repros/asset-world-shadows.mjs
TMPDIR=/tmp SVELTE_PROBE_LOD=1 SVELTE_PROBE_CULLING=1 SVELTE_PROBE_DISTANT=1 \
  SVELTE_PROBE_SHADOWS=1 SVELTE_PROBE_GPU_TIMING=1 node repros/asset-world-input.mjs
TMPDIR=/tmp SVELTE_PROBE_SHADOWS=1 node --experimental-strip-types repros/occlusion.mjs
```

`SVELTE_PROBE_OUTPUT` selects the output directory. The shadow benchmark asserts
bounded submitted geometry and zero fallback for its fixed configuration; it
reports FPS/GPU time rather than imposing a hardware-specific threshold.

## Remaining limits

One directional map, finite local coverage, fixed hardware comparison filtering,
no cascades or alpha-cutout shadows. Shadow LOD can change silhouettes; it is an
explicit opt-in. Unknown geometry bounds retain draw commands but cannot reliably
fit a map. Fragmented selections still have a conservative bounded fallback.
Increasing map resolution can increase LOD geometry detail as well as fill cost.
