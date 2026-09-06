# Pending-ancestor effect deferral

## 1. Scope and risk

Investigate whether async scene attachments can obey ancestor pending boundaries
without reducing motion cadence. High risk: the candidate touches Svelte's shared
effect scheduler, including native DOM behavior. It remains an opt-in temporary-copy
probe; do not patch installed Svelte, enable app async flags, or change the renderer
scheduler. Production patch policy and live verification are still unresolved.

## 2. Current program model

`repros/probes/async-boundary-lifecycle.test.ts` reproduces early attachment execution
with native DOM and scene hosts. In the pinned runtime, `Batch.schedule` checks only
`effect.b.is_pending`; a nested boundary without a pending snippet has a false flag,
even if its ancestor is pending. `Boundary.is_rendered()` already recognizes ancestor
visibility, but `Batch.schedule` does not use that chain. Boundary-owned dirty/maybe
dirty sets defer effects; `Boundary.#resolve` transfers them into the batch, whose
next `#process` reschedules each effect.

```text
new attachment effect -> Batch.schedule -> nearest boundary not pending -> runs early
boundary resolves -> transfer_effects -> Batch.#process -> Batch.schedule
```

The GPU lifecycle suite already owns controlled RAF tests, real compiled motion
consumers, and a fake TypeGPU root that records uploads, submissions and resource
creation. These are CPU-side contract checks, not GPU throughput measurements.

## 3. Proposed program shape

```text
+ repros/probes/async-pending-ancestor.patch: isolated scheduler candidate
~ repros/probe-async-boundary.mjs: explicit nested-effects comparison mode
~ repros/probes/async-boundary-lifecycle.test.ts: parent/child resolution order
+ repros/probes/async-boundary-motion.test.ts: pending work beside real motion
+ src/gpu-test-utils.ts: shared existing fake GPU recorder, excluded from publication
~ src/gpu-lifecycle.test.ts: reuse the same recorder without changing assertions
~ package.json: exclude the test helper from published files
~ repros/README.md: measured results and remaining gates
```

```text
new effect -> existing effect-kind and REACTION_RAN checks
           -> nearest pending boundary in parent chain -> defer into that owner
owner resolves -> batch reschedules -> recheck remaining pending ancestors
already-run effect -> existing scheduler path, no ancestor traversal
```

No new Svelte API, renderer callback, cache, or subscription. The copied runtime's
`Batch.schedule(effect: Effect): void` retains its signature. The shared fake GPU
factory receives the existing captured draw bindings explicitly, removing its
dependency on the original test file's global rather than adding a new recorder.

## 4. Contracts and invariants

An attachment must not start while any owning ancestor displays initial pending
content. A child's own pending boundary may resolve first; rescheduling must then
defer to the still-pending parent. Removal/unmount must discard held effects without
starting or cleaning up an attachment that never ran. Each committed attachment
starts once and cleans up once. Independent visible content remains reactive.

The traversal occurs only for eligible effects that have never run. It allocates
no collections and adds no persistent ownership. Existing counter propagation,
deferred-set transfer, rejection handling, and the separate destroyed-fragment
guard remain unchanged. Normal motion effects retain the constant-time initial
check and existing targeted GPU upload path.

## 5. Vertical slices and verification

1. Add a third explicit probe mode applying the two separate patches. Re-run the
   existing failing cases, then test nested boundaries resolving in either order,
   rejection/reset and removal. Compare native DOM and scene hosts. Stop and revise
   if deferred effects become stranded or unrelated content stops updating.
2. Reuse the existing fake GPU recorder in an isolated async-motion suite. Test
   60/120/144 Hz, real Tween/Spring, both external/renderer RAF orders, demand idle,
   manual no renderer RAF, disposal cancellation, targeted instance upload ranges,
   stable buffers/bind groups/pipelines, and no GPU resources for offscreen content.
   Re-run unchanged normal GPU tests after extracting the helper.
3. Record exact candidate results. Keep application async support gated pending
   broader async-mode regressions, production patch policy, and live rendering.

## 6. Risks and alternatives

Deferring directly into the immediate non-pending boundary would strand effects:
that boundary may already have resolved and never transfer its sets again. Checking
`is_rendered()` alone cannot identify which boundary owns the deferred work. Adding
a cached pending-ancestor pointer creates invalidation/ownership work when boundaries
resolve; an allocation-free traversal on first scheduling is simpler to verify.

The candidate could still expose other async batching defects. Native parity is
required but insufficient for frame correctness. Rollback removes the probe patch;
the temporary-copy runner cleans up its own directory and normal installed behavior
is unchanged. Keep failures observable in the opt-in suite rather than suppressing
them or weakening scene semantics. No compatibility promise follows from a narrow
green probe.

Lifecycle checkpoint: the combined temporary-copy candidate passes all 22 tests
with no unhandled errors. This includes parent-first and child-first resolution,
rejection/reset, nested removal, keyed replacement, and late settlement after
unmount. The teardown-only candidate still fails eight attachment lifecycle cases.
High-refresh and full async-mode regression checks remain open.
