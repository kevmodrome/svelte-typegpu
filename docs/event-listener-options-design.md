# Scene listener options

## 1. Scope and risk

Honor `once`, `passive`, and `signal` in scene subscriptions, alongside existing
capture behavior. Keep direct event attributes unchanged and make attachment-owned
subscriptions behave predictably. High risk: listener identity, nested dispatch,
abort, replacement, and disposal share ownership. No actions, scene CSS, new RAF,
pointer capture, or compiler/dependency changes.

## 2. Current program model

Before this change, `core.ts` stores per-event sets of callbacks, separated by capture phase.
`node-events.ts:NodeEvent.invoke` snapshots the set and skips removed callbacks.
`attachments.ts:onNodeEvent` wraps each subscription for independent cleanup, but
reduces options to capture. `svelte-renderer.ts` forwards native targets directly
and passes scene subscriptions to core; its wider options type currently permits
silently ignored flags. Native event targets already have their own tested path.

```text
Svelte event hook / onNodeEvent -> core registry -> interaction invalidation
picked event -> capture/target/bubble -> callback snapshot -> Svelte state
```

## 3. Proposed program shape

Use per-event maps keyed by listener identity with a registration record as the
value. This replaces the existing set, not an additional per-node registry.
Records retain normalized once/passive flags, removed status and cleanup. They are
allocated at registration, not per event or frame. Preserve function listeners and
accept native-shaped `handleEvent` objects through the renderer hook/helper.

```text
~ src/core.ts: registration, duplicate identity, abort cleanup, removal
~ src/node-events.ts: listener types and per-invocation once/passive semantics
~ src/attachments.ts: pass full options, preserve independent cleanup
~ src/svelte-renderer.ts: scene listener type forwarding
~ src/index.ts: public listener union export
+ src/event-listener-options.test.ts: native comparisons and lifecycle edges
+ src/event-listener-motion.test.ts: real compiled motion/attachment cadence
+ type-tests/valid/Listeners.svelte: public function/object and option types
+ repros/listener-options.mjs: desktop/mobile installed-compiler WebGPU probe
~ repros/README.md: repeatable probe command
~ docs/scene-events-guide.md, docs/svelte-compatibility.md

add -> normalize -> ignore aborted/duplicate -> publish record + abort subscription
invoke -> snapshot records -> skip removed -> remove once -> passive scope -> callback
remove / abort / once -> mark removed -> delete record -> detach abort callback
```

## 4. Contracts and invariants

- `TypeGpuEventListenerOptions = boolean | AddEventListenerOptions`.
  Removal matches type, listener identity and capture only. Duplicate adds keep the
  first registration's options. `onNodeEvent` retains independent ownership even
  for shared callbacks; its returned cleanup remains idempotent.
- Once is removed before invocation, including nested dispatch and exceptions.
  Removing and re-adding the same callback cannot resurrect a snapshot entry.
  Capture and bubble registrations of one listener are independent.
- An already-aborted signal adds nothing. Abort removes synchronously, including
  listeners not yet visited in an active dispatch. Once/explicit cleanup detach
  the abort listener. Failed native signal subscription cannot leave a live record.
  Synthetic abort events do not cancel a subscription or consume its abort hook.
- Passive makes the scene event's `preventDefault()` a no-op only during that
  invocation; non-passive siblings still cancel. Restore state after exceptions
  and nested dispatch. This does not change the canvas's native listener policy or
  restrict direct access to `originalEvent`.
- Native EventTargets retain browser-owned behavior. Scene nodes remain opaque,
  not HTMLElements. Detached nodes can retain explicitly owned subscriptions,
  like before; Svelte attachment cleanup or consumer abort owns their teardown.
- Interaction indexing continues to inspect registry keys/sizes. GPU resources,
  instance storage, scheduling, callback order and node identity remain unchanged.

## 5. Vertical slices and verification

1. Compare scene/native listener outcomes for once, duplicate add, capture,
   abort, reentrant dispatch, remove/re-add, handler objects and cancellation.
   Verify abort listener release and options snapshots. Implement registry changes.
2. Use compiled attachments inside snippets, real Tween/Spring producers and
   controlled 60/120/144 Hz clocks, both RAF orders and manual mode. Replace/abort
   subscriptions during motion; assert every frame, exact 96-byte writes, stable
   GPU resources/registration identities, natural idling, and unmount cleanup.
3. Run full workspace/type/production checks and a live event/motion WebGPU check.
   Commit runtime and consumer verification surgically; no dependency activation.

## 6. Risks and alternatives

Wrapping only option-bearing callbacks would retain a set fast path but require a
second identity index and complicate remove/re-add semantics. Registration maps
provide one source of truth and only event-bearing nodes allocate records. This
changes renderer-owned registry value types; consumer code should not mutate node
internals. No change to direct `onclick` signatures is needed. Exceptions still
propagate as in the current scene dispatcher, not the DOM's exception-reporting
policy. A passive listener does not promise browser scroll optimizations because
multiple scene handlers share the canvas input listener. Rollback restores the
prior registration representation and removes the additive options contract.

References: [DOM listener lifecycle](https://dom.spec.whatwg.org/#concept-event-listener-invoke)
and [Svelte event subscriptions](https://svelte.dev/docs/svelte/svelte-events).

## Verification results

- `pnpm test`: 1,339 workspace tests pass (1,243 renderer, 57 docs, 34 example,
  5 workspace). The production renderer suite also passes all 1,243 tests.
- Package TypeScript build and public Svelte type fixtures pass with zero errors
  and zero warnings from `svelte-check`.
- Thirteen listener regression cases cover native lifetime comparisons, nested
  dispatch, exceptions, replacement, synthetic abort, passive scope, and cleanup.
- Eighteen compiled attachment/motion cases cover real Tween/Spring at 60/120/144
  Hz, both demand callback orders, and manual mode. Every active step submits one
  frame. Uploads affect only the moving instance's 96-byte range; the first color
  change adds one write to that same range. The other 100 instances remain intact.
  Instance storage, persistent registrations, buffers, bind groups, and pipelines
  are reused. Demand settles and unmount cancels pending work.
- The isolated installed-compiler browser probe passes at 1440px and 390px. Actual
  picked clicks drive Tween/color changes (33,823 changed pixels per viewport),
  wheel cancellation stays passive, abort removes handlers, and reattachment works.
  Resource counts remain six buffers, four bind groups, and one render pipeline.
  Unmount during motion stops submissions and removes the canvas without JS/GPU
  errors. Screenshots were inspected at both sizes.
- The browser uses software WebGPU. Its submission counts verify rendering and
  cleanup, not the physical monitor's refresh rate. These changes do not alter the
  scheduler: listener-membership changes still use the existing coalesced scene
  synchronization/invalidation path.
