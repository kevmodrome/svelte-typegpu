# Reactive canvas options

## Scope and risk

Make `frameloop` and `maxDevicePixelRatio` reactive on dedicated `<canvas>`
viewports and on the legacy `Canvas.options` prop. Preserve the native canvas,
mounted scene, GPU root, and all size-independent GPU resources. Do not change
creation-only device/root policies or add a second frame loop. Risk: high because
prop effects, asynchronous startup, frame callbacks, and resize resources meet.

## Current program model

`Canvas.svelte` and `ViewportCanvas.svelte` capture options in `onMount` and call
`startCanvasScene`. The latter awaits `createTypeGpuRoot`, mounts the scene, then
notifies `ready`. The viewport warns about subsequent option changes; the legacy
host ignores them. `TypeGpuSceneRenderer` stores both settings in readonly fields.
It owns one pending RAF, a demand-only resize observer, and the render-size/depth
texture cache. Its RAF callback preserves a bounded follow-up for external motion
producers. The runtime flushes Svelte effects and frame tasks before GPU drawing.

```text
onMount -> startCanvasScene -> createTypeGpuRoot -> GPU renderer
         -> scene mount -> ready
state option mutation -> warning / no GPU update
```

## Proposed program shape

```text
~ src/gpu-renderer.ts: setOptions, mutable settings, observer and frame ownership
~ src/canvas-lifecycle.ts: optional configure callback before mounting the scene
~ src/Canvas.svelte and ViewportCanvas.svelte: one existing-root options effect
~ src/gpu-lifecycle.test.ts: controlled clocks, real motion and resource checks
~ src/canvas.test.ts and viewport.test.ts: pending/ready/disposed prop forwarding
~ docs/canvas-guide.md and declarative-canvas-guide.md: reactive option contract
~ docs example controls: live mode/resolution changes on the existing scene
```

`TypeGpuRenderer.setOptions(options)` accepts a partial selection of the two
settings. Omitted keys are unchanged; explicitly `undefined` resets the renderer
default. Hosts always supply both keys, so removing a prop restores its default.
The viewport retains its `demand` default; the legacy root retains `always`.
Invalid/non-positive ratios use the normal default, while positive fractional
ratios and Infinity retain their useful resolution-cap semantics.

```text
state mutation -> host $effect -> ownedRoot.gpu.setOptions
  -> normalize and compare -> update mode and ratio atomically
  -> cancel RAF for manual, otherwise coalesce into existing pending work
  -> existing next draw resizes only if effective physical dimensions change

async startup completion -> configure(latest options) -> mount scene -> ready
unmount/error -> dispose -> clear ownedRoot -> no further option effects
```

## Contracts and invariants

- Equal normalized options do no work. No frame per unchanged prop evaluation.
- Switching to manual cancels queued renderer RAF and follow-up intent; producer
  RAFs remain producer-owned. Manual drawing remains an explicit `renderFrame`.
- Automatic-mode changes retain an already queued frame instead of cancelling
  and deferring it to the next display tick. Entering an automatic mode wakes one
  frame, and continuous tasks keep their existing demand semantics.
- Changes made while drawing coalesce into the existing follow-up mechanism.
  A manual-to-always change inside an explicit frame must start the loop;
  always-to-manual inside a callback must not schedule another frame.
- Keep at most one resize observer per renderer, observing only in demand mode.
  Re-entering demand reuses it. Disposal disconnects it and cancels pending work.
- DPR changes invalidate automatic rendering, but manual mode allocates/resizes
  only when explicitly drawn. Equal effective sizes reuse the depth texture.
  Size changes replace only the depth target, not buffers, pipelines or bindings.
- Preserve the last measured CSS size (initial intrinsic size before measurement)
  while hidden. Never feed an already DPR-scaled canvas width back into resizing.
- Apply current props before scene mount/onready after delayed initialization;
  public bound root references do not own or redirect the host's options effect.
- Startup/configuration errors follow the existing cleanup/error path. SSR does
  not initialize or update GPU state. No actions or CSS directive additions.

## Vertical slices and verification

1. Renderer setter: test every mode transition, repeated equal values, atomic
   mode/DPR updates, in-frame changes, hidden canvas sizes and depth-target reuse.
   Exercise 60/120/144 Hz clocks and cancellation/disposal; inspect a live baseline
   before scheduler edits. Commit the independently tested renderer change.
2. Hosts: compiled viewport and legacy host mutate options during pending startup,
   normal operation and teardown. Real Tween/Spring producers in both RAF orders
   cross automatic modes, then manual and back. Assert exact frame delivery and
   instance upload ranges, root/canvas/node identity and GPU resource reuse.
3. Consumer example and docs: expose modes/resolution with ordinary Svelte props,
   regenerate examples, run all tests/builds/Svelte checks, and verify live changes
   and idle behavior. Distinguish synthetic cadence from physical display rate.

## Alternatives and risks

Remounting with `{#key}` already works but discards scene state and GPU resources.
Separate setting mutators make combined manual/DPR changes order-dependent; one
atomic update avoids that. A new scheduler is unnecessary and risks cadence
regressions. The existing pending/follow-up fields remain authoritative.

The additive setter changes renderer test doubles; update those explicitly rather
than making production updates optional. Other root options remain creation-only.
The shared lifecycle configure hook must run after taking ownership so thrown
configuration is cleaned up. Rollback removes the host effects and setter while
leaving scene formats and stored user data unchanged. Live checks cannot establish
monitor rate, CPU cost or GPU throughput without separate measurements.

## Verification results

Implemented the three slices. The renderer change is `955900b`; host integration
and compiled motion coverage are `5d01e43`. Examples and public guides now expose
the same live contract. No actions or scene CSS directives were added.

- `pnpm test`: 958 passing tests (5 workspace, 872 renderer, 47 docs, 34 example).
- `pnpm build`: renderer TypeScript, Vite example and Mochi docs builds pass;
  generated Native Events output and source samples are current.
- `pnpm --filter svelte-typegpu check:svelte`: zero errors and warnings.
- Direct GPU coverage includes every mode pair at 60/120/144 Hz, in-frame and
  post-draw settings changes, observer reuse, DPR normalization, hidden canvas
  size stability, same-size depth reuse and explicit manual resize deferral.
- The 24 compiled host/motion cases cross legacy/dedicated hosts, Tween/Spring,
  all three clocks and both callback orders. Each automatic tick delivers one
  frame; manual ticks run only the producer until explicitly drawn. Writes stay
  within the single moving instance's 96-byte slot; buffers, bind groups,
  pipelines, root, scene nodes and attachments are retained. Settlement and
  disposal cancel renderer work. Delayed startup uses current props before mount.
- Live Svelte Motion: manual mode holds the image while the target changes;
  explicit drawing moves the marker and changes a 930x627 drawing buffer to
  310x209 while CSS stays 620x418. Resuming continuous mode retains target/lift
  values; returning to demand settles to Idle. This browser reported 60 delivered
  FPS in continuous mode; browser callback rate, physical display refresh, CPU
  cost and GPU throughput were not independently measured.
- Live Native Events: cap changes preserve CSS size and native size bindings
  (954x596 CSS, 1431x894 to 477x298 drawing buffer). Narrow viewport checks show
  nonoverlapping controls and a visible 345x215 canvas. Native keyboard reset,
  manual drawing and resolution changes work. Both live pages report no browser
  warnings/errors. The docs server is running at `http://127.0.0.1:3334`.

The official Svelte autofixer found no host errors. Its scene warnings interpret
GPU primitives as DOM elements; its remaining preview suggestions concern the
existing static option lists and the slug-driven reset effect. Neither changes
the custom-renderer contract tested by the actual pinned compiler/runtime.
