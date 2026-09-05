# Pointer cancellation ownership

## 1. Scope and risk

Support ordinary `onpointercancel` attributes so Svelte components can reset
pressed state when native input is interrupted. High risk: pointer sequences,
object drag capture, handler reentrancy and disposal share runtime ownership.
Preserve event-specific picking, scene capture/bubbling, camera controls and frame
scheduling. No actions, CSS directives, scene focus or public pointer-capture API.

## 2. Current program model

`svelte-renderer.ts:createRuntime` owns native canvas listeners, one active object
drag, temporary window up/cancel listeners and scene picking. `pointercancel` and
`lostpointercapture` only finish drags; neither reaches scene handlers.
`node-events.ts` controls recognized/bubbling events. Interaction targets retain
inherited handler sets across transform and material updates.

```text
pointerdown -> picked down handler -> optional active drag + native capture
pointercancel -> finishActiveDrag(cancelled) -> dragend -> clear drag ownership
```

Callbacks currently run before ownership is cleared. A move callback can dispose
the runtime before the code writes `activeDrag.previousCanvas`. An end callback
cannot start an independent replacement drag safely, and disposal does not release
native drag capture. These need correction before adding another terminal event.

## 3. Proposed program shape

```text
~ svelte-renderer.ts: detach drag before terminal callbacks, guard stale moves
~ svelte-renderer.test.ts: reentrant teardown/capture and cancellation routing
~ node-events.ts: recognize bubbling pointercancel
~ canvas-event-attributes.test.ts: compiled props/capture and native sequences
~ gpu-lifecycle.test.ts: cancellation-to-frame and retained-handler cadence cases
~ scene-events-guide.md, svelte-compatibility.md: supported ownership contract
```

First detach a finishing drag and release capture before notifying application
callbacks. Stale move callbacks must not overwrite replacement ownership. Then
retain cancellation hits in a runtime-local map keyed by native pointer ID.
Track only hits with registered cancel handlers: prefer the actual pointerdown
recipient, falling back to a cancel-only pick when no down recipient exists.
Do not re-pick at cancellation coordinates. Temporary window up/cancel listeners
remain attached while either a drag or a tracked cancellation sequence exists.

```text
down -> remember eligible original hit -> existing down/drag callbacks
up -> forget sequence -> existing picked/captured up and dragend
cancel -> forget sequence -> scene pointercancel -> cancelled dragend
interaction membership change -> prune missing/hidden/opted-out sequences
dispose -> clear sequences, detach listeners, release owned drag capture
```

## 4. Contracts and invariants

- Cancellation bubbles through the original node's current scene ancestry. It
  carries `originalEvent`, the original `instanceId` and down hit point, and is
  non-cancelable. It does not synthesize pointerup or a click.
- Register `onpointercancel` before pointerdown. Handler replacement during a
  tracked sequence uses the latest callback. Parent-only/capture handlers count.
  A down recipient without cancellation handlers does not redirect cancellation
  to a different object behind it.
- Each native pointer ID owns an independent sequence. Up, cancel, lost capture,
  removal, hidden/opted-out membership and disposal release retained ownership.
  No event is synthesized on removal/disposal. Lost capture still reports only a
  cancelled dragend, not a fabricated native pointercancel.
- Clear ownership before terminal callbacks. Canvas events bubbling to window
  must not terminate a replacement sequence created by those callbacks. Exceptions
  propagate with cleanup complete; runtime disposal suppresses further callbacks.
- Membership pruning runs only when the interaction index changes. No per-frame
  pointer maps/scans/picking, no idle animation loop and no new GPU resources.

## 5. Vertical slices and verification

1. Reproduce stale drag ownership on callback disposal/reentrancy, fix move/end/
   start cleanup and native capture release, then commit this focused prerequisite.
2. Add cancellation ownership and dispatch. Test mismatched IDs, two pointers,
   cancellation-only/parent handlers, changed coordinates, callback replacement,
   window fallback, drag cancellation, duplicates, removal/hiding/opt-out and
   disposal. Extend compiled 60/120/144 Hz demand/manual tests and both callback
   orders, retaining real Tween/Spring coverage and targeted upload assertions.
3. Run full workspace tests/builds/Svelte checks and live existing event/drag
   smoke checks. Document that synthetic cancellation tests do not emulate an OS
   gesture recognizer or establish physical display refresh rate. Commit separately.

## 6. Risks and alternatives

Re-picking cancel coordinates is smaller but can reset the wrong component after
movement. Capturing every pointer to implement this would change native gestures
and camera behavior. A runtime-local opt-in sequence map preserves those boundaries
without exposing another consumer API. A complete multi-pointer hover/capture model
remains separate. No saved-data migration is needed; rollback removes additive
cancellation support while retaining the independently useful drag teardown fix.

The non-cancelable event follows [W3C pointercancel](https://www.w3.org/TR/pointerevents3/#the-pointercancel-event).

## Implementation notes

- `f2349d2` fixes stale drag teardown independently. Eight regression cases cover
  disposal from down/start/move/up/end, starting a replacement in dragend, a failing
  dragstart and preventing a stale move from overwriting replacement coordinates.
- A captured object drag takes cancellation ownership when its target has an
  eligible handler. Ordinary pointerdown picking otherwise retains precedence.
- Terminal canvas events are handled once; their window bubble is ignored so a
  callback-created replacement sequence with the same pointer ID survives.
- Pending records and active drags are pruned on interaction membership changes.
  The cadence fixture now supplies an EventTarget-backed window instead of a
  devicePixelRatio-only object, so temporary pointer subscriptions are exercised.

## Verification results

- All 1,061 workspace tests pass: 975 renderer, 47 docs, 34 example and 5 workspace.
  The cancellation slice adds 19 compiled ownership cases, three runtime
  reparenting/error/disposal cases and nine cadence cases, in addition to the
  eight prerequisite drag lifecycle cases.
- The 60/120/144 Hz input matrix delivers one frame and one changed 96-byte
  instance per active tick, in either input/renderer order. Buffers, bind groups
  and pipelines are reused; demand mode settles, manual mode never schedules
  RAF and disposal leaves no pending work. The real Tween/Spring matrix also
  includes inherited pointercancel handlers and unchanged interaction/listener
  identity during motion.
- Production builds and renderer TypeScript pass; Svelte checking reports zero
  diagnostics. The DOM-only autofixer's GPU-tag HTML/a11y warnings do not apply
  to custom scene nodes. No DOM roles or actions were added to suppress them.
- A fresh live Two Boxes page rendered nonblank, responded to camera dragging
  and reported no console warnings/errors. Its FPS display remained around 120;
  this is not an independent physical-refresh or GPU-throughput measurement.
  OS-driven cancellation was not manually reproduced; native PointerEvent
  cancellation and fallback ownership are covered by the compiled tests.
- Vite retains its 500 kB bundle warning for the 501.64 kB main example chunk.
  The warning threshold was not changed.
