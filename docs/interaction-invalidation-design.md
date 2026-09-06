# Interaction-only scene updates

## 1. Scope and risk

Changing an attachment subscription or a picking-only prop must update input
behavior without drawing an unchanged scene. Preserve an orbit-controlled camera
and in-flight gestures. High risk: scene cache ownership, CPU interaction state,
GPU invalidation, and external RAF producers meet here. No new scheduler, event
API, pointer-capture API, dependency patch, or scene CSS.

## 2. Current program model

`core.ts` marks listener changes with `Dirty.Interaction`. The runtime coalesces
these through `flushScene`, then reconciles wheel listeners, pending presses,
active drags, and camera controls. `scene-compiler.ts` reuses draw items but rereads
camera/render settings from markup. This discards camera movement committed by
`camera-interaction.ts` into the current scene. `gpu-renderer.ts:setScene` always
marks the projection dirty and invalidates, even with no visual deltas.

```text
attachment / picking prop -> scheduleSync(Interaction) -> createSceneState
  -> reread declarative camera -> gpu.setScene -> requestAnimationFrame -> draw
  -> reconcile wheel, press/drag ownership, and camera input
```

## 3. Proposed program shape

Reuse the last compiled render state for an exact interaction-only update on a
ready cache. Rebuild the interaction index from retained resource items, attach
its targets to the transform cache, and clear previous GPU delta lists/flags.
Skip GPU preparation/invalidation for that pure delta. Still call `setScene` and
perform all runtime input reconciliation; no separate public scene-update method.

```text
~ src/scene-compiler.ts: exact Interaction fast path on a ready cache
~ src/gpu-renderer.ts: no GPU work for pure interaction deltas
~ src/scene-events.test.ts: retained camera/resources and cleared deltas
+ src/interaction-invalidation.test.ts: compiled attachment and input lifecycle
~ repros/listener-options.mjs: observable zero-frame listener churn
~ docs/scene-events-guide.md, docs/svelte-compatibility.md: frame contract
~ repros/README.md: repeatable browser verification

Interaction -> reuse current camera/render data -> rebuild interaction index
  -> gpu.setScene (no preparation, upload, or RAF)
  -> unchanged runtime input reconciliation
Interaction | visual dirty bits -> existing compilation and rendering
```

## 4. Contracts and invariants

- `TypeGpuSceneState.dirty` describes the update; exact `Dirty.Interaction` is
  nonvisual. GPU-side delta flags/lists also must be empty for the early return.
  Initial/full and mixed updates retain the existing path.
- The scene compiler owns its last state and caches. Interactive camera updates
  mutate that state's camera through the existing controller. Reuse this camera
  object; do not reconstruct it from unchanged markup.
- Listener edits may rebuild CPU picking data, but never reset transforms, pack
  instances, replay previous uploads, rebuild render resources, or request RAF.
- Camera updates already queued by actual input remain queued. No cancelling or
  rescheduling to hide extra frames. Manual mode still never schedules renderer
  RAF, and always mode continues at its existing cadence.
- Reconciliation must still detach wheel/window listeners, release active drag
  capture, forget cancelled press ownership, and use the new pick index immediately
  after the normal Svelte/microtask flush. Cleanup produces no late callbacks.

## 5. Vertical slices and verification

1. Reproduce camera reset and extra frames before implementation. Add compiler
   identity/delta tests and real compiled attachments at 60/120/144 Hz in demand
   and manual modes. Verify picked clicks, once, abort, reattachment, picking
   opt-outs, wheel ownership, active drag release, and exact zero idle GPU work.
2. Implement the two internal fast paths. Run real Tween/Spring tests in both
   callback orders, including listener replacement/abort during motion. Verify
   mixed visual updates still draw and camera input remains effective.
3. Run full workspace, production, and type checks. Run the installed-compiler
   WebGPU probe before/after at desktop/mobile sizes; inspect pixels, resource
   reuse, per-phase submissions, and cleanup. Commit code and verification in
   focused increments, without pushing.

## 6. Risks and alternatives

Skipping `gpu.setScene` in the runtime alone saves work but leaves the compiler's
camera reset and cached snapshot churn in place; it also makes the GPU handoff
inconsistent. Broadly treating every non-resource update as nonvisual could stall
camera, frame-task, or render-setting changes. The exact-mask path intentionally
does neither. Incorrect custom dirty masks remain a caller error, like existing
resource flags. A ready-cache check and reuse-option guard preserve cold and
explicit cache-reuse behavior. Rollback removes the two fast paths; no migration
or persistent state is involved. Browser software WebGPU does not establish
physical monitor refresh rate.

## Verification results

- Before the fix, the compiler regression replaces an interactive camera with the
  declarative default. Six of twelve compiled lifecycle tests fail: listener edits
  request unwanted RAF at all three refresh rates and add work alongside pending
  camera input. The baseline WebGPU probe submits one extra frame for each of
  nonvisual once consumption, abort, and reattachment at both viewport sizes.
- After the fix, `pnpm test` passes 1,352 workspace tests (1,256 renderer, 57 docs,
  34 example, 5 workspace). All 1,256 renderer tests also pass in production mode.
  Package TypeScript and Svelte type checks pass.
- The new lifecycle matrix covers 60/120/144 Hz in demand/manual/always modes,
  native-picked events, picking opt-outs, abort during drag, wheel/window listener
  release, mixed visual updates, stale upload clearing, and no extra demand
  follow-up when a frame was already queued. Nonvisual changes upload nothing;
  the mixed transform change writes only bytes 9600..9696 for one of 101 instances.
  Buffers, bind groups, pipelines, and instance storage are retained.
- The existing eighteen real compiled Tween/Spring attachment cases continue to
  deliver each active frame in both producer/renderer callback orders. Demand
  settles, manual adds no renderer RAF, and disposal cancels pending work.
- The installed-compiler WebGPU probe at 1440px and 390px now records zero frames
  for once, abort, reattachment, and cleanup after orbit input. Native clicks still
  produce 33,823 changed pixels. Native `GPUQueue.writeBuffer` counts also stay
  unchanged during each nonvisual phase. Six buffers, four bind groups, and one render
  pipeline are reused. Orbit-camera pixels remain identical after abort; the
  desktop/mobile screenshots were inspected. Unmount during renewed animation
  leaves no pending work or later submissions, with no JavaScript/GPU errors.
