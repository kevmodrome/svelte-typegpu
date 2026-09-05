# Scene event capture

## 1. Scope and risk

Make ordinary `onclickcapture`/`onpointerdowncapture` attributes run before child
handlers. High risk: public event ordering and stop semantics. Retain the nearest
eligible hit, hover boundaries, camera/drag ownership, and single frame loop.
No DOM focus, pointer capture API, new event names, or general AddEventListenerOptions
implementation. Only the capture option is added in this slice.

## 2. Current program model

The pinned Svelte compiler/runtime passes listener options to `core.addEventListener`.
Our hook currently drops the fourth argument. `node-events.dispatchNodeEvent`
snapshots a bubble path; `scene-compiler.createInteractionTargets` memoizes inherited
listener types. `onNodeEvent` owns an independent wrapper and cleanup per subscription.

```text
onclickcapture -> Svelte event(..., capture=true)
              -> core.addEventListener(options ignored) -> bubble-only dispatcher
```

## 3. Proposed program shape

```text
~ core.ts: optional per-node capture listener map; capture-sensitive add/remove
~ node-events.ts: capture -> target -> bubble dispatch, eventPhase
~ attachments.ts + index.ts: optional typed capture argument on onNodeEvent
~ scene-compiler.ts: include captured event types in inherited picking eligibility
~ protocol/runtime/compiled-Svelte/GPU tests; scene event docs
```

Use one snapshotted path and one event for all phases. Allocate capture maps only
when registering a capture listener; delete empty maps after removal. Keep normal
listeners and the existing motion-only path unchanged. The event type union is
computed during interaction rebuilds, never by per-frame ancestor walks.

## 4. Contracts and invariants

`TypeGpuEventListenerOptions = boolean | { capture?: boolean }`;
`addEventListener`/`removeEventListener`/`onNodeEvent` accept it as a fourth argument.
Listener identity includes capture, so one callback may register independently in
both phases. Duplicate registration within a phase remains a no-op. Subscription
cleanup freezes the registration's capture flag, even if an options object changes.

`eventPhase` is 1 on capture ancestors, 2 for both target passes, 3 on bubbling
ancestors, and 0 after dispatch, including exceptions. Non-bubbling events can be
observed by ancestor capture listeners. Propagation is snapshotted before user code;
listeners are snapshotted per node/phase. `stopPropagation` completes the current
node/phase, then stops further visits (including the target's later bubble pass if
called in target capture). `stopImmediatePropagation` also stops the current visit.
Cancellation and scene/native event separation stay unchanged. Removed scene nodes
remain outside picking; ordinary listeners on retained detached nodes follow the
existing lifetime contract.

## 5. Vertical slices and verification

1. Protocol through actual compiled Svelte: capture order, phase identity, capture-only
   picking, duplicate/removal behavior, stable paths under reparenting, non-bubbling
   capture, stop controls, nested dispatch, and throw cleanup. Commit after tests.
2. Reactive component spreads and attachment cleanup; repeat real Tween/Spring at
   60/120/144 Hz with capture-only group interaction, stable handler sets, targeted
   uploads and GPU reuse. Check demand idle/disposal; update docs and commit.
3. Live browser hover/click regression check when computer access is available.
   Current Mac lock is a verification limitation, not a reason to skip automated work.

## 6. Risks and unresolved decisions

Alternative: reject capture options. This avoids accidental bubbling but does not
provide expected Svelte composition. A unified listener-record registry could add
once/passive/signal later, but would replace established Set storage and allocate
more per registration now. Optional capture maps keep this change additive and
focused. No migration is required; existing capture attributes now run in their
intended phase. Capture is scene-local and does not intercept native canvas/camera
listeners. Runtime tests, not editor declarations, prove compatibility with the
pinned preview. Revert this focused feature commit to roll back if required.
