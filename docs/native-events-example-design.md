# Direct primitive event example

## Scope

The initial playground combined DOM keyboard/focus events, controls, event-path
feedback, and scene events. Its callback plumbing obscured the intended API:
handlers on scene primitives mutating colocated Svelte state. Replace that
playground with one self-contained scene. No renderer API or scheduling changes.

## Program shape

- `NativeEvents.typegpu.svelte` owns three objects, selection, and hover state.
- Each `mesh` has direct click, hover, wheel, double-click, and context-menu handlers.
- `ExamplePreview.svelte` uses its standard Canvas with empty scene props and demand mode.
- The source panel publishes just the scene, with no DOM wrapper or helper interface.
- The former wrapper, callback types, helper module, and feedback styles are removed.

Canvas input -> renderer hit testing -> mesh handler -> local `$state` -> targeted
scene update -> demand frame. There is no ID lookup or custom animation loop.

## Invariants

Click rotates/selects one object. Hover changes its material. Wheel sizes are
clamped and normalized across pixel/line/page units. Double-click or right-click
resets that object. Wheel cancellation is local; the background retains orbit
camera zoom. No object state is shared between component instances. Canvas DOM
events remain a separate supported API; keyboard object navigation is not part
of this pointer-focused example.

## Verification

Drive the real compiled scene through Canvas and real pointer/wheel events.
Exercise 60/120/144 Hz in both demand callback orders and manual mode. Assert
one frame per active tick, targeted 96-byte instance uploads, stable draw counts,
GPU resource reuse, idle shutdown, and cancellation on disposal. Keep the
existing real Tween/Spring and reactive native Canvas prop tests unchanged.
Check bounds, wheel units, object isolation, resets, and background cancellation.
Run source freshness tests, type checks, production builds, and desktop/mobile
browser checks. Synthetic cadence is not a physical monitor refresh-rate measurement.

## Results

- All 681 workspace tests pass, including ten compiled direct-event example tests.
- Renderer type checking and both app production builds pass.
- Desktop and 390 x 844 browser checks confirm visible geometry, hover, click
  rotation/selection, wheel resizing, double-click reset, and idle rendering.
  Mobile has no horizontal overflow; browser warning/error logs are empty.
