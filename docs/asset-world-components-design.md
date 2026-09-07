# Asset-world components

## 1. Scope and risk

Refactor the example into reusable scene objects before adding occlusion culling.
Standard risk: multiple example files and their compiled tests change, but renderer
APIs, assets, scheduling and appearance do not. Keep the existing
`.typegpu.svelte` suffix to select the custom compiler; consumer tags are ordinary
Svelte components such as `<Tree>` and `<Tent>`.

## 2. Current program model

`AssetWorld.svelte` owns loading, shared LOD families and controls.
`WorldViewport.typegpu.svelte` owns the canvas, input and camera/player state, but
also contains terrain and lighting. `Campsite` and `Landscape` place raw models;
`Player`, `Canoe` and `WorldCamera` already encapsulate behavior.

```text
AssetWorld -> WorldViewport -> inline terrain/lights + Campsite/Landscape models
```

## 3. Proposed program shape

```text
+ Tree, Rock, Log, Tent, Campfire, Bridge, Sign.typegpu.svelte
+ Terrain, WorldLighting, SelectionMarker.typegpu.svelte
~ WorldViewport, Campsite, Landscape.typegpu.svelte
~ world.ts (object props and narrower placement types)
~ source registry/generation, compiled component and motion tests

AssetWorld -> WorldViewport -> Terrain + WorldLighting
                           -> Campsite/Landscape -> named object components -> model
                           -> unchanged Player + Canoe + WorldCamera
```

Leaf components choose their model from the shared `WorldAssets` prop, forward
placement/visibility/click props, and apply the existing shadow defaults. Tree
also accepts `kind: 'pine' | 'oak'`. No generic wrapper component or asset context
is needed. The source panel includes every new component.

## 4. Contracts and invariants

Loading and LOD creation stay outside per-object components. Component boundaries
add no scene groups, frame tasks or render roots. The primitive traversal order,
keys, transforms, picking behavior, forest visibility and shared geometry identity
stay unchanged. Svelte owns component lifetime; the renderer still owns GPU
batching and resources. No new error or asynchronous lifecycle path is introduced.

## 5. Vertical slices and verification

1. Extract object components and integrate campsite/landscape. Compare a compiled
   component scene with inline primitives, including prop changes, click handlers,
   keyed reorder/removal and forest toggles. Existing real Tween/Spring tests run
   through the components at 60/120/144 Hz in both RAF orders and manual mode.
2. Extract terrain/lighting/selection, update generated sources and consumer docs.
   Run workspace tests, builds and desktop/mobile gameplay. Compare the 50k-model
   hardware workload and cadence before/after; inspect nonblank screenshots.

Commit any compiler prerequisite separately from the tested example refactor.

## 6. Risks and unresolved decisions

Per-instance Svelte components increase mount-time bookkeeping, so benchmark the
large example and preserve sparse steady-state updates. Prop spreads must not
forward asset collections or component-only options onto renderer primitives.
Keep shared props limited to the example's needs. This refactor neither changes
asset geometry nor promises zero mount overhead; revert individual extractions
if they materially regress usability or frame delivery.

The inline/component parity test exposed a pre-existing compiler inconsistency:
static bare flags became empty strings, whereas flags alongside a spread became
booleans. A separate compiler fix lowers bare scene attributes to explicit `true`
expressions, preserving explicit strings and leaving native canvas attributes
untouched. Shadow intent now applies consistently across component boundaries;
this is a behavior correction, not a claim of identical old shadow output.

## Verification results

All 1,579 workspace tests pass, including 36 real Tween/Spring cadence cases
through the componentized campsite and 20k-model landscape. Those cases cover
60/120/144 Hz, both RAF orders and manual mode, targeted uploads, resource reuse,
settled idling and disposal. Eight new object tests cover default assets, reactive
placement/clicks/shadow overrides, tree variants, forest visibility and equivalent
inline batching through keyed reorder/removal. Five compiler tests cover bare
flags, explicit expressions/strings and the unchanged native canvas boundary.
Renderer TypeScript, public Svelte types and the production docs build pass.

The Apple/Metal 50k-model follow-view comparison uses 16x maximum detail, culling
and LOD, shadows off, and the same 954 by 455 CSS-pixel canvas:

| Metric | Before | Components |
| --- | ---: | ---: |
| Submitted instances | 2,622 | 2,622 |
| Color draws | 142 | 142 |
| Color triangles | 2,823,938 | 2,823,938 |
| Rendered frames / callbacks | 481 / 481 | 480 / 480 |
| Observed FPS | 120.1 | 119.9 |
| Mean callback CPU | 2.27 ms | 2.64 ms |
| Mean GPU color pass | 3.93 ms | 4.58 ms |
| LOD range fallbacks | 0 | 0 |

Raw, LOD-only and culling-only modes also retain their exact previous instance,
draw and triangle counts. There are no steady-state GPU resource creations or
WebGPU errors. These individual runs preserve throughput but do not prove zero
component overhead; mount time and retained JS memory were not separately
quantified. They also do not establish physical monitor refresh.

Frozen before/after follow images differ at 148 pixels (0.034%, RGB threshold 10)
with and without LOD. The independently timed canoe animation is not synchronized
between browser launches. Screenshots remain nonblank and correctly framed.

The 50k input probe passes simultaneous walking/orbit, stop/start, targeted
uploads, resource reuse and idle checks. Dispatch-to-next-task timings are
1.8-12.9 ms, including queued work; these are not isolated event-handler timings.
The compact desktop/mobile software-WebGPU gameplay probe passes with shadows
enabled: animation frames/callbacks 82/82 and 105/105, walking 35/35 and 55/55,
plus picking, touch cancellation, pause/reset, day/dusk, asset retry, reduced
motion and canvas retention. Shadow rendering now includes the previously
miscompiled static casters, so old shadows-enabled throughput is not comparable.

Machine-local screenshots and reports are in `/tmp/typegpu-components-before`,
`/tmp/typegpu-components-after`, `/tmp/typegpu-components-input` and
`/tmp/typegpu-components-gameplay`. Run the existing asset-world GPU/input/gameplay
probes with `SVELTE_PROBE_LOD=1` (and `SVELTE_PROBE_CULLING=1` for input) to repeat.
