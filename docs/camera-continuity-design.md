# Declarative camera continuity

## 1. Scope and risk

Keep interactive camera views stable through Svelte conditional/keyed content,
material/resource updates, and mixed motion/listener updates. Apply changed camera
props field by field, retain inactive camera views by host-node identity, and reset
new camera nodes. Lens changes must not cancel pending orbit input. High risk:
declarative and interactive state have different owners and meet during frame
delivery. No public binding API, ID requirement, new RAF, physics, dependency
patch, or automatic camera animation.

## 2. Current program model

`camera.ts:readCameraState` reads selection, normalized props and control settings.
`scene-compiler.ts` rereads these on every full compilation; only incremental
transform/material and exact interaction updates preserve `lastState.camera`.
`camera-interaction.ts` commits controls output via `setCamera`, dispatches
`camerachange`, then replaces `activeScene.camera`. The controller also treats lens
changes as a gesture reset. Thus ordinary `{#if}`/`{#each}` work can reset a view,
and a reactive lens can cancel queued input.

```text
markup -> readCameraState -> scene.camera -> GPU + input controller
input -> setCamera + camerachange -> replace active scene.camera
unrelated full compile -> read original markup -> reset scene.camera
```

## 3. Proposed program shape

Add a scene-owned camera cache, keyed weakly by opaque camera host nodes. Each
entry holds a private normalized declaration snapshot and its most recent live
settings. Before resolving the next selected camera, capture the previous scene's
live settings. Compare new declarations with the declaration snapshot, not with
the controls output. Only effective changed fields override live fields.

```text
+ src/scene-camera-cache.ts: declaration/live reconciliation and lifetime
+ src/camera-continuity.test.ts: compiler-level ownership and identity cases
~ src/scene-compiler.ts: camera cache construction and settings resolution
~ src/svelte-renderer.ts: clear camera cache on disposal
~ src/camera-interaction.ts: preserve gestures through lens-only changes
~ src/camera-interaction.test.ts: pending input uses the latest lens
~ src/event-listener-motion.test.ts: live camera during real compiled motion
~ src/interaction-invalidation.test.ts: compiled camera selection, lens, and key reset
~ repros/listener-options.mjs: keyed/conditional edits after native orbit input
~ docs/svelte-compatibility.md, docs/canvas-guide.md, repros/README.md

full compile -> read declarations -> cache.resolve(root, declaration, previousScene)
  -> capture previous live view -> update only changed declared fields
  -> GPU + existing controller reconciliation
same camera + pose + controls, new lens -> keep pending input using new lens
```

## 4. Contracts and invariants

- `SceneCameraCache.resolve(root, declared, previousScene?)` returns camera
  settings. `clear()` drops the root and weak entries; a different root also resets
  ownership. Entries do not retain host nodes strongly.
- Position, target, near, far, and projection-specific fov/zoom compare by effective
  normalized value. Fresh equal tuples do not reset the live view. Removing a prop
  applies its default when that changes its effective declaration.
- Changing fov does not reset an orbit position or target. Changing position does
  not silently rewrite an unchanged target. Replacing a camera node creates a new
  view; switching back to a retained camera node restores its prior live settings,
  with any intervening declarative changes applied. Selection rules stay unchanged.
- Private declaration snapshots copy vectors and never alias mutable live values.
  Existing incremental fast paths keep their allocations/cadence unchanged; no
  cache lookup is needed on their per-frame path.
- Node/pose/projection/controller changes retain the controller's existing input
  cancellation. Lens-only changes preserve pending/active input and its callback
  order. No stale input may overwrite a later explicit pose or replacement camera.
- Controls publish the originating scene's new view before `camerachange` callbacks
  can switch scenes, dispose the controller, or throw. No post-callback write may
  overwrite a replacement scene's camera.
- Camera declarations are committed only after the remaining scene compilation
  succeeds; a failure cannot consume a pending prop update. Changes stay synchronous
  with existing error propagation. No persisted state or consumer migration.

## 5. Vertical slices and verification

1. Reproduce resets with compiler and pending-input tests plus the browser probe.
   Implement cache integration and lens-only input continuity. Cover full/mixed
   dirty masks, camera selection, node replacement, bridge props, defaults,
   mutable live values, and cache lifetime.
2. Extend real compiled Tween/Spring tests at 60/120/144 Hz in both callback orders
   and manual mode to retain a wheel-moved camera through scene updates. Assert
   targeted instance writes, stable resources, frame delivery, demand idling and
   disposal. Add compiled keyed/conditional scene checks as needed.
3. Run workspace, production and type checks, and installed-compiler desktop/mobile
   WebGPU before/after checks. Verify retained camera pixels after offscreen keyed
   edits, actual subsequent input, and cleanup. Commit surgical increments.

## 6. Risks and alternatives

Dirty masks alone cannot distinguish camera selection changes from unrelated tree
edits, and cannot recover a previously active camera's view. Comparing declarations
to the live view mistakes user input for a prop change. Requiring applications to
feed every camerachange back into props would make basic uncontrolled cameras
fragile. A weak per-node record matches Svelte keyed identity without adding IDs or
another mutable public store. Full camera snapshots remain readable via existing
events; this does not add two-way binding or change explicit low-level GPU APIs.
The effective-value contract intentionally avoids treating a fresh equal tuple as
a reset command; use camera `{#key}` remounting for a deliberate reset. Rollback
removes the cache and restores whole-camera reconciliation. Browser software GPU
results verify pixels/work, not physical monitor refresh.

## Verification results

- `pnpm test`: 1,383 workspace tests pass (1,287 renderer, 57 docs, 34 example,
  5 workspace). All 1,287 renderer tests also pass with production Svelte.
  Package TypeScript and public Svelte checks pass with zero diagnostics.
- Compiler regressions cover full/mixed dirty masks, per-field declarations,
  retained inactive cameras, host replacement, orthographic zoom, bridge props,
  defaults, independent declaration vectors, echoed scalar values, root/disposal
  isolation, and retry after a failed compilation.
- Controlled input tests retain pending orbit work through lens changes, cancel
  stale input after pose/projection changes, and keep originating/replacement
  scenes correct when callbacks switch, dispose, or throw.
- Compiled camera switching and `{#key}` reset cases pass at 60/120/144 Hz with
  buffer/bind-group/pipeline reuse. All eighteen real Tween/Spring attachment
  cases preserve a wheel-moved view while delivering each active frame in both
  callback orders and manual mode, with targeted 96-byte instance writes, demand
  idling, and disposal cleanup.
- The baseline desktop WebGPU probe detects 3,768 changed pixels after an
  unrelated offscreen keyed/conditional edit. The completed implementation
  detects zero at both 1440px and 390px. Screenshots were inspected at both sizes.
  Subsequent picked clicks still drive real Tween motion; six buffers, four bind
  groups, and one pipeline are retained. Subscription-only phases still produce
  zero frames/uploads, and unmount during animation leaves no late submissions or
  JavaScript/GPU errors. The probe leaves installed dependencies unchanged.
