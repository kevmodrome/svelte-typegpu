# Playable asset world

## 1. Scope and risk

Add a controllable camper to the existing campsite: camera-relative keyboard and
touch movement, running, simple obstacle/bank collision, and reset. Keep orbit,
selection, asset loading, and day/dusk controls. Standard risk: example-only
input and simulation ownership; no renderer API or scheduler changes. This is a
grounded walking demo, not a rigid-body engine, animated GLB rig, or quest system.

## 2. Current program model

`AssetWorld.svelte` owns DOM controls and loaded assets. `WorldViewport` owns the
native canvas/camera and composes `Campsite`. `Canoe` owns a reactive phase driven
by one `frameTask`; `FrameTasks` supplies clamped delta seconds. Existing compiled
tests cover the actual campsite at 60/120/144 Hz and both external RAF orders.

```text
DOM state -> WorldViewport -> Campsite/Canoe -> frameTask -> reactive transforms
```

## 3. Proposed program shape

```text
+ player-controller.ts       SAT.js grounded collision/movement
+ player-input.ts            keyboard/pointer ownership and attachment cleanup
+ Player.typegpu.svelte      local player state, frameTask, primitive-built camper
+ MovementPad.svelte         captured multitouch directional buttons
~ WorldViewport              native keyboard events, focus attachment, camera basis
~ AssetWorld                 touch input, player reset, reduced-motion separation
~ example registry/generator source list and generated output
+ player controller/input and compiled frame-delivery tests
~ repros/asset-world.mjs      keyboard/touch, visible movement, idle/resource checks
```

```text
canvas key events / DOM movement pad -> small movement value
  -> Player frameTask (active only for movement input)
  -> delta-scaled camera-relative displacement -> SAT collision response
  -> local position/heading/gait -> existing targeted instance updates
```

Use [SAT.js](https://github.com/jriecken/sat-js) for circle/polygon overlap response, with prebuilt simplified XZ
colliders for trees, tents, details, river banks and island limits. The bridge is
the river crossing. A fixed overview camera remains orbitable; no follow-camera
state competes with controls. Existing assets and the canoe remain unchanged.

## 4. Contracts and invariants

- `Movement { x, z, run }`; opposing keys cancel and diagonals normalize. Keyboard
  aliases and pointer IDs retain separate ownership. Only focused canvas keys
  prevent browser defaults. Blur, hide, cancellation, pause and unmount clear input.
- `createPlayerController()` retains collision scratch state; `step(state, input,
  delta, camera, forest)` mutates only the player's small reactive state. Static
  colliders and assets do not rebuild during walking. Travel uses elapsed seconds.
- Player updates use the renderer frame task, never a second RAF or timer loop.
  Pausing stops both player and canoe; reduced motion stops decorative animation
  but still permits deliberate walking without a gait animation.
- Frame task is inactive on release. Disposal removes DOM listeners and pending
  renderer work. Manual mode still depends on explicit render calls.
- Colliders are authored gameplay approximations, not automatic mesh physics.

## 5. Vertical slices and verification

1. Implement pure input/movement and collision tests, then a primitive-built
   character composed into the world. Verify equal travel at 60/120/144 Hz,
   diagonal/run speed, boundaries, bridge crossing and obstacle blocking.
2. Add focused keyboard and captured touch input/reset. Verify aliases, opposite
   inputs, release/cancel/blur, pause, reduced motion and disposal. Compile the
   real Player with external Tween/Spring in both RAF orders and manual mode;
   assert one delivered frame, bounded affected instances and stable GPU resources.
3. Generate docs, run workspace/type checks, then desktop/mobile WebGPU probes
   and screenshots. Compare baseline callback/render counters, visible movement,
   demand settling and buffer/pipeline reuse. Commit tested slices separately.

## 6. Risks and decisions

SAT ground-plane collision avoids adding asynchronous WASM physics startup for a
flat world. It does not support jumping, slopes, gravity or dynamic bodies. Mesh
details may not exactly match collision footprints. Keep them conservative and
verify walking across the actual bridge. A full 3D character controller would be
a separate example-level extension. No change to public renderer dependencies.

## Verification results

- The complete workspace suite passes all 1,459 tests.
- The production docs build and renderer TypeScript check pass. The generated DOM
  controls pass the targeted Svelte check with zero errors or warnings.
- Fourteen input/controller tests cover aliases, cancellation, equal travel at
  60/120/144 Hz, running/diagonals, camera-relative movement, bridge/bank/obstacle
  collision, gap clamping, and reuse of collision shapes/scratch objects.
- Eighteen real compiled Player + Tween/Spring cases cover both RAF orders,
  demand/manual scheduling and disposal. A moving frame uploads exactly thirteen
  instances (twelve camper parts and one external mesh), reads only eighteen
  spatial transforms, and leaves a thousand static meshes and GPU resources alone.
- Desktop/mobile WebGPU screenshots verify a visible camper, keyboard walking,
  captured pointer movement, actual touch cancellation, reset, pause, blur, keys
  outside the canvas, and deliberate movement under reduced motion. Asset retry,
  retained canvas, day/dusk, forest, picking, and resource reuse still pass.
- Final software-WebGPU samples delivered 47 frames / 47 callbacks at 1440px and
  67 / 67 at 390px while walking. The scene retains 70 buffers, 4 bind groups and
  3 pipelines during movement; idle input stops scheduling. These are callback/
  render checks, not measurements of the physical monitor's refresh rate.
- The generated viewport uses a native canvas attachment for keyboard cleanup;
  it avoids client-only script effects in the docs' precompiled SSR entry. The
  shared test helper now removes imports via its existing AST parser, including
  the multiline imports emitted for the Player component.
