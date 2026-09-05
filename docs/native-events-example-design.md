# Native events playground

## Scope and risk

Add one complete example covering scene hover/click/capture/wheel/context-menu
events and native canvas keyboard/focus events. Standard risk: docs-only behavior
and source generation, with no renderer API or scheduling changes.

## Current program model

`example-definitions.ts` and `example-source-texts.ts` feed the scene compiler and
static source panels. `ExamplePreview.svelte` owns the generic Canvas and controls.
The generator currently treats every Svelte source as a custom-renderer scene.

## Proposed program shape

```text
+ examples/native-events/NativeEvents.typegpu.svelte: pickable scene objects
+ examples/native-events/NativeEventsPreview.svelte: DOM Canvas, controls, feedback
+ examples/native-events/event-objects.ts: typed initial object values
~ example definitions, source texts, scene registry: register the playground
~ compile-typegpu-scenes.ts: compile ordinary .svelte sources with the DOM renderer
~ ExamplePreview.svelte: pass the compiled scene to the normal DOM preview
~ style.css: focused canvas and compact event feedback
~ registry/source tests + GPU lifecycle tests: generated components and real input
```

Canvas keyboard/DOM controls -> Svelte object state -> sceneProps -> mesh transforms.
Scene pointer events -> object state / hover -> mesh appearance + DOM feedback.
Only the latest event and click path are retained; no unbounded log or RAF loop.

## Contracts and invariants

The DOM wrapper owns three objects' rotation/size and the selection. Scene hover is
local. Native callbacks receive DOM events; scene callbacks receive TypeGpuNodeEvent.
Mochi compiles the DOM wrapper from source for SSR and hydration; only the scene
is client-only precompiled code, passed into Canvas and mounted after onMount.
Wheel cancellation is local to hit objects; background camera zoom remains intact.
Unrecognized or modified keyboard input is not intercepted. Accessible DOM controls
offer the same selection/rotation/size actions. Demand mode settles without work.
Canvas errors remain local and unmounting disposes the owned renderer.

## Vertical slices and verification

1. Build and register the scene plus DOM preview, with complete source tabs. Test
   the generated DOM/scene distinction, metadata, source freshness, and bounds.
2. Drive the compiled preview through real events. Test 60/120/144 Hz input in both
   RAF callback orders, targeted uploads, GPU reuse, idle focus updates, and disposal.
   Run existing real Tween/Spring/manual matrices, full tests, and production builds.
3. Verify desktop/mobile rendering, selection, focus, keyboard and wheel behavior
   in the live browser. Record observed FPS separately from controlled clocks.

## Risks and unresolved decisions

No dependency additions or migrations. The DOM example uses existing global docs
styles; the source compiler need not acquire CSS bundling responsibilities. Keep
the generic preview unchanged for all existing examples. Revert this example's
commits to roll back; no persisted state is involved.

## Verification results

- Full workspace: 680 tests pass, including the actual DOM wrapper in the Svelte
  type checker and seven compiled-playground GPU/input tests.
- Controlled 60/120/144 Hz input in both RAF orders produces one rendered frame
  per active tick, one 96-byte instance upload, stable draw counts, and no new
  buffers, bind groups, or pipelines. Focus/blur stay idle; teardown cancels work.
- Renderer type checking and both app production builds pass.
- Live desktop and 390 x 844 viewport checks show rendered objects, keyboard
  rotation, wheel resizing, double-click reset, selection, hover, focus, and
  capture/bubbling feedback. Mobile has no horizontal overflow; browser logs are
  clear. The FPS display reports Idle between inputs, not a physical refresh rate.
