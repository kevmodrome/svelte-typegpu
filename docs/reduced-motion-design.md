# Reduced motion and media-query reactivity

## 1. Scope and risk

Make the Svelte Motion consumer example respect Svelte's real
`prefersReducedMotion.current`, including changes during animation. Verify ordinary
MediaQuery reads on scene props, shared listener ownership, and frame delivery.
High risk after the initial probe: native event targets currently enter scene-node
listener code and crash. Fix the renderer hook boundary as well as consumer motion
behavior, without a new public API, dependency patch, CSS scene styling, or animation loop.
The pending async dependency choice and live GPU checks remain separate gates.

## 2. Current program model

`SvelteMotion.typegpu.svelte` owns two real Tweens and a Spring. Effects assign
targets from controls; `onDestroy` stops all three. `MotionMarker` receives their
current values as ordinary props. The pinned `svelte/motion` module exports a real
MediaQuery singleton, backed by `createSubscriber`: first tracked read installs
one native listener, and the last consumer leaving releases it after a microtask.
No current test controls that query or the user's reduced-motion preference.
The compiled MediaQuery probe fails in `core.addEventListener`: the pinned Svelte
`operations.add_event_listener` chooses its hook by current renderer, not target.

```text
controls -> component effects -> Tween/Spring targets -> current props
  -> marker meshes/materials -> targeted uploads -> existing renderer RAF
```

## 3. Proposed program shape

```text
+ src/media-query.test.ts: real MediaQuery composition/listener/cleanup contract
+ src/native-event-targets.test.ts: native listener forwarding and cleanup from scene effects
~ src/svelte-renderer.ts: delegate native targets at the two renderer listener hooks
+ src/reduced-motion.test.ts: actual generated example with controlled preference/RAF/GPU
~ apps/docs/src/examples/svelte-motion/SvelteMotion.typegpu.svelte: instant preference policy
~ generated example/source listings: existing generator
~ docs/svelte-compatibility.md: media-query and reduced-motion semantics
```

```text
+ preference change -> existing component effects
    reduced: set the current targets instantly, cancel existing producers
    normal: animate only a changed target; do not restart settled/current motion
```

Read previous motion targets with `untrack` to avoid making an effect depend on
the target it writes. Keep options and comparisons local to the three existing
effects, rather than introducing a renderer-specific motion wrapper. CSS remains
appropriate for native page layout; media queries can control actual scene values
or animation policy that CSS cannot reach.

The renderer's add/remove listener hooks accept a scene node or native EventTarget.
Targets exposing the native listener method keep their own listener implementation;
scene nodes continue through the unchanged core listener registry. Capability checks
avoid realm-specific `instanceof EventTarget` and introduce no per-frame work.

## 4. Contracts and invariants

The consumer owns its Tween/Spring lifecycle. The OS preference is an input, not a
renderer render-mode setting. Reduced motion keeps interaction and demand/manual
semantics intact; it changes values immediately rather than lowering frame rate.
Turning it off does not replay an already-reached target. Future target changes
animate normally. No-op media events do not upload instances or request frames.

Use the real Svelte export with controlled `window.matchMedia` before module
initialization; do not replace the singleton with a fake reactive object. Test
listener sharing and teardown explicitly. SSR has only the declared fallback and
must not pretend to know the browser's preference. No global consumer-owned state
or preference persistence is added.
Native listeners preserve their receiver, handler and option objects; add/remove
must not dirty scene interaction state. Native errors propagate normally. This does
not make scene nodes DOM EventTargets or enable rejected `<svelte:window>` syntax.

## 5. Vertical slices and verification

1. Fix native listener routing, then real MediaQuery in compiled direct/component/snippet scopes: changed/no-op
   events, keyed conditional subscriptions, replacement and final cleanup. Assert
   stable nodes, bounded targeted dirty ranges and one shared native listener.
2. Actual generated motion example: normal and initially reduced preference;
   toggle during movement, change targets while reduced, toggle back without
   replay, then animate new targets. Exercise 60/120/144 Hz and both RAF orders,
   demand/manual, exact affected uploads, resource reuse, idling and disposal.
3. Document the consumer policy and regenerate source listings. Run workspace
   tests/builds and development/production runtime profiles. Check live examples
   and browser preference emulation when GPU access is available; retain the open
   live GPU/physical refresh gate if the Mac remains locked or device creation stalls.

## 6. Risks and unresolved decisions

Simply rerunning `Tween.set` on every preference change can start a full-duration
no-op tween when motion is re-enabled. Target comparisons prevent that without
subscribing effects to per-frame current values. Cancellation may leave Svelte's
already-queued producer callback to drain once; distinguish it from renderer RAF.
The existing demand scheduler also retains one follow-up when invalidated while a
frame is queued. Cancellation during motion therefore drains exactly two rendered
frames in the tested ordering, then none; an instant update from idle draws once.
The test environment must install matchMedia before importing svelte/motion because
the preference singleton captures its query at module initialization. HMR remains
disabled under its existing ownership contract; it requires separate lifecycle work.

Alternative: patch Svelte's event operations to dispatch by target. That is broader
than the renderer's two hooks and would add another installed-dependency decision.
Changing core scene-node listener types would blur a stable internal boundary.
Forwarding native targets at the renderer adapter is the narrower ownership fix.
Svelte's `on` wrapper still skips DOM delegation when created in GPU scope; keep
DOM delegation-sensitive subscriptions in ordinary DOM components. MediaQuery and
other non-DOM EventTargets do not use that propagation mechanism.

Rollout is the default adapter path after native/scene tests and all cadence suites
pass; no persisted state or data migration is involved. Rollback removes the two
forwarding branches and the preference example change, restoring the reproduced
MediaQuery limitation. Existing capture/bubble and handler-replacement tests guard
scene semantics. Live GPU verification remains open rather than inferred from mocks.
