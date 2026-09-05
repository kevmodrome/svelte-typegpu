# Bubbling hover events

## 1. Scope and risk

Support ordinary `onpointerover` and `onpointerout` scene attributes, including
capture, component spreads and reactive appearance. Standard risk: extend the
existing input-driven hover transition without changing scheduling, picking
policy, drag ownership or the scene node API. No actions, CSS directives, scene
focus, new pointer-capture API or per-frame hit testing.

## 2. Current program model

`node-events.ts` defines pickable/bubbling event types and snapshots dispatch
ancestry. `svelte-renderer.ts:updateHoveredTarget` retains the previous target and
ancestor path, emitting non-bubbling leave/enter events when geometry or ancestry
changes. It runs on canvas pointer movement/exit and pauses during object dragging.
Parent event subscriptions make descendant geometry eligible through the existing
interaction index. Stable hover visits do not allocate new ancestry arrays.

```text
Svelte attributes -> listener registry -> inherited interaction eligibility
canvas pointermove -> pick -> compare target/ancestry -> leave/enter -> pointermove
canvas pointerout/pointerleave -> clear hover -> leave
```

## 3. Proposed program shape

```text
~ node-events.ts: two event types; internal dispatch on a retained path
~ svelte-renderer.ts: out -> leave -> over -> enter, native canvas entry listener
~ svelte-renderer.test.ts: ordering, ancestry, repeated input, reentrancy, disposal
~ canvas-event-attributes.test.ts: compiled props/capture/spreads and native input
~ gpu-lifecycle.test.ts: event-to-frame matrix includes both hover event types
~ scene-events-guide.md, svelte-compatibility.md: public behavior and limits
~ apps/docs/src/examples/native-events/: direct over/out handlers in live example
~ apps/docs/src/examples/registry.test.ts, generated/: updated source contract/output
```

`dispatchNodeEventOnPath(path, type, init)` is internal to event dispatch and the
runtime, not a package export. Existing dispatch builds its path and delegates;
hover transitions reuse their already retained paths. No-listener paths skip
event creation. Native canvas `pointerover` enters the same hover transition;
the subsequent pointermove is deduplicated. No direct forwarding of canvas
pointerout as a picked event: it exits the previously hovered scene target.

## 4. Contracts and invariants

- Over/out bubble from the picked node, including between siblings; common
  ancestors retain their existing enter/leave boundary behavior.
- Order is old out, exited boundaries leaf-first, new over, entered boundaries
  ancestor-first, then pointermove when applicable. Each is a separate event;
  stopping one event does not cancel the remaining transition.
- `relatedTarget` is the other picked node, or null outside eligible geometry.
  `detail.instanceId` identifies the instance; an incoming over has the hit point.
  Reparenting/removal exits along saved ancestry, not a newly attached parent.
- Preserve model instance transitions, native cancellation forwarding, exception
  propagation and existing guards against disposed or reentrant transitions.
- Only input does picking. Stable repeated input emits no over/out; event-only
  callbacks schedule no frame. Reactive callbacks use targeted updates and the
  existing demand/manual clocks, with no new GPU resources or listener churn.

## 5. Vertical slices and verification

1. Reproduce absent bubbling hover events through native canvas input, implement
   dispatch/transition changes, and test boundary order, related targets, parent
   eligibility, capture, propagation, removal/reparenting and reentrancy.
2. Verify compiled component prop forwarding and extend the 60/120/144 Hz input
   matrix across both callback orders and manual mode. Retain real Tween/Spring
   tests, targeted 96-byte writes, buffer/pipeline/binding reuse and settled idle.
   Run workspace tests, TypeScript/Svelte checks and a live example smoke check.
   Document and commit the verified behavior surgically.

## 6. Risks and decisions

Forwarding native canvas events directly cannot detect transitions between scene
siblings. Re-picking on every render would add idle and motion cost; the existing
input-driven hover contract remains deliberate. Retained dispatch paths are
needed for old ancestors after reparenting; exposing them publicly is unnecessary.
Hover remains one runtime hover target, not a new multi-pointer focus model.
Existing consumers need no migration; rollback removes the two additive events.

The event distinction follows [W3C Pointer Events](https://www.w3.org/TR/pointerevents3/#the-pointerenter-event).
This scene renderer does not claim full DOM layout or pointer-capture semantics.

## Verification results

- 31 new tests cover runtime ordering and lifecycle, compiled component/snippet
  forwarding, and the additional 18 cadence cases. The existing real Tween/Spring
  matrix also includes inherited over/out handlers in both capture modes, with no
  per-frame subscription changes or interaction scans.
- 1,022 workspace tests pass: 936 renderer, 47 docs, 34 example and 5 workspace.
  Production builds and renderer TypeScript pass. Svelte checking reports zero
  diagnostics. The DOM-only autofixer reports expected HTML/a11y false positives
  for GPU primitives; no DOM roles or action support were added to scene nodes.
- At 60/120/144 Hz, both input/renderer orders deliver one frame per active tick,
  one 96-byte changed instance and no new GPU buffers, bind groups or pipelines.
  Demand mode settles, manual mode schedules no RAF and disposal leaves no work.
- Live Native Events verification showed Coral highlighting, then Jade highlighting
  with Coral restored, then both restored after canvas exit. Click selection and
  rotation still work. The nonblank preview returns to Idle with no console
  warnings or errors. This check does not measure physical monitor refresh rate.
- The production example's main chunk is 500.62 kB and still triggers Vite's
  500 kB size warning; its threshold was not changed.
