# Scene pointer actions

## 1. Scope and risk

Support ordinary `ondblclick`, `oncontextmenu`, and `onwheel` attributes on scene
nodes, including component forwarding and capture. High risk: native cancellation
and camera ownership interact. Preserve click/drag suppression, hover boundaries,
the nearest eligible hit policy, and frame scheduling. No synthesized double-click
timer, DOM focus model, or new scene primitive.

## 2. Current program model

`svelte-renderer.ts:createRuntime` owns canvas subscriptions and picking.
`node-events.ts` owns propagation and native `preventDefault` forwarding.
`scene-compiler.ts:createInteractionTargets` memoizes inherited event types;
the interaction index is retained through transform/material updates.
`camera-interaction.ts:onWheel` currently zooms without checking cancellation.

```text
Svelte event attribute -> core listener registry -> inherited picking eligibility
canvas input -> createRuntime -> interaction.pick -> dispatchNodeEvent
canvas wheel -> camera controller -> coalesced camera update
```

## 3. Proposed program shape

```text
~ node-events.ts: recognize three additional bubbling, pickable event types
~ svelte-renderer.ts: shared picked-event dispatch; wheel subscription lifecycle
~ camera-interaction.ts: respect native wheel defaultPrevented before zooming
+ canvas-event-attributes.test.ts: compiled Svelte through real canvas dispatch
~ svelte-renderer.test.ts + gpu-lifecycle.test.ts: routing and cadence regressions
~ scene-events-guide.md + svelte-compatibility.md: supported contract
```

Double-click and context-menu inputs use ordinary canvas listeners. Click delegates
to their shared dispatcher after its existing suppression checks. Wheel uses a
non-passive capture listener so scene cancellation precedes camera zoom even if
camera controls were installed first. Reconcile wheel subscription eligibility
only when the interaction index identity changes, not whenever bounds move.

## 4. Contracts and invariants

All three events use `TypeGpuNodeEvent` with the native event in `originalEvent`
and `{ instanceId, point }` in `detail`. Scene capture/bubble ordering, this binding,
and propagation snapshots are unchanged. Browser-generated `dblclick` is forwarded
as-is; ordinary click events still occur. Context-menu cancellation is explicit.
Keyboard context-menu targeting is not implemented without a scene focus model.

`onwheel` may call `preventDefault()` to cancel a cancelable native event and stop
camera zoom for that input. `stopPropagation()` remains scene-local and does not
cancel zoom. Native non-cancelable inputs cannot be canceled. Wheel deltas/modifiers
remain native values on `originalEvent`; no hidden unit conversion is introduced.
No scene wheel handlers means no additional scroll-blocking listener. Adding,
removing, hiding, or unmounting eligible geometry updates the subscription. Disposal
removes it with matching capture options. No timers, frame tasks, or extra RAF.

Compiler evidence refined the registration contract: a literal `onwheel={callback}`
keeps a Svelte wrapper even when the callback becomes null. A conditional event
prop spread removes the registration. Eligibility follows the actual scene listener
registry; it does not inspect or rewrite compiler-owned closures. Tests cover both
literal attributes and late subscriptions through spreads. The happy-dom fixture
supplies canvas offsets and WheelEvent mouse fields because that test environment
does not compute/inherit them; native capture/default-cancellation remains real.

## 5. Vertical slices and verification

1. Double-click/context menu: compiled props, capture/target/bubble, cancellation,
   hit filtering, prop replacement, node removal and disposal; focused commit.
2. Wheel: same routing plus camera cancellation after late handler installation,
   listener attachment/removal, native cancelability, idle/manual modes, targeted
   uploads and GPU reuse. Real motion tests remain at 60/120/144 Hz in both orders;
   add event-driven cadence checks and commit separately.
3. Full workspace tests/builds and live example verification when the Mac is
   unlocked. Synthetic clocks do not establish physical display throughput.

Verification: all 648 workspace tests pass (577 renderer, 42 docs, 24 example,
5 workspace), as do renderer typechecking and both production builds. The 27-case
event-input matrix and 24-case real Tween/Spring matrix cover 60/120/144 Hz,
callback order, targeted uploads, GPU reuse, and listener stability. Browser
verification remains pending because computer-use reports the Mac locked.

## 6. Risks and unresolved decisions

Alternative: always attach wheel dispatch. Simpler, but it imposes a non-passive
listener on scenes that never use wheel interactions. Another option is to route
scene input through camera-specific hooks; that couples picking to an optional
controller. A canvas capture listener preserves independent ownership and standard
native ordering. Verify with a DOM-backed canvas, not a fake EventTarget that
ignores capture phases. Existing camera controls remain active over unhandled
geometry and empty space. Handler exceptions keep the existing browser dispatch
behavior; they are not converted into cancellation. The changes are additive and
can be rolled back by their focused commits; no persisted-state migration exists.

References: [Svelte event attributes](https://svelte.dev/docs/svelte/basic-markup#Events),
[native wheel cancellation](https://developer.mozilla.org/en-US/docs/Web/API/Element/wheel_event),
and [DOM dispatch ordering](https://dom.spec.whatwg.org/#concept-event-dispatch).
