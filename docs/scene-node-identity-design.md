# Scene node identity in Svelte state

## Scope and risk

Preserve actual host-node identity when consumers retain attachment or event
targets in `$state`, including nested state objects and arrays. Do not implement
host `bind:this`, actions, CSS directives, or a second mutable scene-state API.
Risk: high, because every host node and identity-keyed renderer cache is affected.

## Current program model

`core.ts:createStub` returns a plain object and installs an own `children` getter
with a per-node closure. `TypeGpuNode` is publicly exported; attachments and
`TypeGpuNodeEvent` expose those objects. Svelte's `proxy` wraps plain objects and
arrays when assigned to ordinary `$state`. Event dispatch and the renderer's
WeakMaps continue using the original object, so retained references can compare
unequal or fail identity-based attachment cleanup. Node internals are not Svelte
state and should not acquire a second reactive owner.

```text
attachment/event -> raw node -> $state assignment -> proxy -> identity mismatch
renderer mutation -> raw node fields -> retained proxy can cache stale fields
```

The pinned compiler still rejects host bindings. Its `bind_this` lowering handles
each-block scopes and teardown ordering; a simple attachment rewrite would not
preserve that contract. Leave existing rejection tests intact.

## Proposed program shape

Use a private host-node class. Svelte treats class instances as opaque references,
as it does native DOM elements. Keep the public structural `TypeGpuNode` interface,
factory functions, field values, and mutation/invalidation operations unchanged.
Move `children` to a shared prototype getter, removing per-node getter closures.

```diff
~ src/core.ts: private HostNode implementation behind createStub
~ src/attachments.test.ts: compiled state, event and keyed-reference regressions
~ src/core.test.ts: shared getter, fresh child snapshots and node factory contracts
~ src/gpu-lifecycle.test.ts: retained node state in the real-motion frame matrix
~ docs/svelte-compatibility.md: retaining references without proxying node internals
```

```text
attachment/event -> host instance -> $state assignment -> same host instance
renderer mutation -> same fields -> retained reference observes current fields
```

## Contracts and invariants

- All node kinds remain identity-stable in shallow or nested reactive state.
  Reassigning a reference is reactive; reading node internals is not a Svelte
  subscription. Declarative props remain the mutation API.
- `children` remains a fresh linked-list snapshot when read, not cached state.
  Its getter moves from an enumerable own property to the class prototype;
  serializing/spreading renderer internals is not a supported tree-copy API.
- No exported constructor, renderer methods, DOM emulation, new queues, or global
  node registry. Existing weak caches and node reachability stay unchanged.
- Keep optional fields absent until populated; preserve factory initialization
  and linked-list operations. Creation does not build a children array.
- Keyed moves retain nodes and attachments; removal clears consumer references
  through ordinary attachment cleanup. No frame subscription is created.

## Vertical slices and verification

1. Reproduce failures using actual compiled Svelte components that retain nodes
   through attachments, event handlers, nested state objects and arrays. Fix
   host representation; verify keyed moves/removal, listeners and reference cleanup.
2. Extend the existing real Tween/Spring demand/manual 60/120/144 Hz matrix with
   a retained scene reference. Assert raw identity and current attributes during
   motion, one frame per active tick, targeted 96-byte writes, GPU resource and
   attachment reuse, bounded settling, and cancellation on disposal.
3. Verify every factory, shared child getter and snapshot behavior. Run full
   tests, builds and Svelte checks; compare a live example when the Mac permits.
   Document verified behavior, limits, and any unavailable visual check.

## Alternatives and risks

Requiring `$state.raw` everywhere avoids proxying but is easy to miss for event
targets or references nested inside other state; it leaves host nodes unlike
other external objects. Setting Svelte's private STATE_SYMBOL would couple the
renderer to proxy internals. A null prototype also avoids proxying but removes
normal object methods/coercion. A private class expresses the existing ownership
boundary and shares the child getter without importing Svelte into the core.

Prototype-based access changes enumeration, not scene traversal. Tests and
repository searches must confirm no internal consumer depends on spreading host
nodes. Rollback is local to node construction; no data migration or GPU format
changes. Do not claim physical refresh-rate improvements from synthetic clocks.

## Verification outcome

- Two real compiled-component regressions failed on the original plain objects:
  retained attachment references were not identical to the renderer's host nodes.
  Both pass with host instances, including event selection, nested state, keyed
  moves/removal, and identity-guarded cleanup.
- `pnpm test`: 798 tests pass (5 workspace, 713 renderer, 46 docs, 34 example).
  The 36-case canvas motion matrix now retains and reads host references on every
  tick at 60/120/144 Hz. Existing frame counts, targeted 96-byte instance writes,
  GPU/attachment reuse, demand settling, manual scheduling and disposal assertions
  remain green. All 132 GPU lifecycle tests pass.
- Factory tests cover all node kinds, absent optional fields, a shared getter
  across 1,000 nodes, and fresh child snapshots after mutation.
- Full workspace builds pass; Svelte check reports zero errors and warnings.
  The consumer reference example compiles warning-free against the pinned
  custom renderer. Generated docs scenes remain unchanged.
- Live visual checks remain unavailable because the Mac is locked. No physical
  display-cadence or GPU-throughput improvement is claimed.
