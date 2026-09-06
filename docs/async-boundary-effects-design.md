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
~ workspace-structure.test.ts: verify the helper's publication exclusion
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

The first cadence probe passes reveal/removal frame delivery but exposes a second
effect path on conditional remount: `create_effect` appends new user effects to
`collected_effects` during an active batch traversal, bypassing `Batch.schedule`.
Revise the candidate to share `defer_to_pending_boundary(effect): boolean` between
`Batch.schedule` and `flush_queued_effects` before execution. The latter first checks
destroyed/inert/dirty state as before. Both callers retain the first-run flag gate;
already-run motion effects still avoid the ancestor walk. This is the same boundary
ownership rule, not another queue or a change to counter lifetime. Add a direct
DOM/scene remount case alongside the frame-delivery case before accepting the revision.

Revised checkpoint: all 60 isolated tests pass, including 24 lifecycle tests and
36 real Tween/Spring cadence cases (60/120/144 Hz, demand in both RAF orders, manual,
late resolve/reject). Each clock step submits one frame. Steady-state movement
uploads one 96-byte instance; reveal/removal have bounded structural uploads.
The CPU instance backing buffer, GPU buffers, bind groups and pipelines are reused.
Demand stops even with a promise still pending; manual schedules no renderer RAF;
late settlement after disposal cannot upload or render. No app runtime was changed.

The motion fixture deliberately does not call Svelte's async `tick()`, which itself
schedules RAF and races it against a timer in this preview. It uses a task boundary
to drain microtasks outside the measured frames, and the same controlled callback
checkpoint as the existing motion suite within frames. This keeps test-generated
callbacks out of renderer/manual-mode assertions. These checks do not establish
physical refresh rate or GPU throughput, and full async-mode regression/live
validation remain open.

## Mixed-compilation regression pass

Add `SVELTE_PROBE_SUITE=regression` to the existing temporary-copy runner. The
probe config includes the normal package tests plus focused async tests and loads
`svelte/internal/flags/async` as a setup module in every isolated test graph.
The normal compiled fixtures retain their existing compiler settings: this tests
coexistence after one async component enables the shared runtime, not a global
compiler migration. It also exercises the unchanged renderer and caches against
the candidate's shared scheduler. No normal test is skipped or assertion relaxed.

Affected files are `repros/vitest.svelte-probe.config.ts`, the runner, a new
`repros/enable-async.ts` setup module, and the probe README. A bounded longer child
timeout applies only to the explicit regression suite. Both suites use the same
copied package aliases and cleanup path; default tests and app flags are retained.
Record the initial failures before changing fixtures. Browser-only async `tick()`
and its extra RAF must be distinguished from renderer scheduling, without mocking
away Svelte behavior in the probe. A broad green runtime pass still does not prove
global async compiler opt-in, SSR/hydration, live rendering, or physical refresh.

Initial result: 981 tests passed, 148 failed, and one six-test module did not load.
The failures expose harness assumptions: async `tick()` needs browser RAF and adds
callbacks to measured queues; SSR helpers resolving the installed server entry by
absolute path split its context state from the copied server renderer. Three client
mounting test files now explicitly use happy-dom. Node-only infrastructure tests
keep their original environment. Both test configs provide a `svelte-test/server`
alias, imported statically by SSR fixtures, so server context and render functions
belong to the same graph. Dynamic absolute imports did not work reliably through
Vitest's browser-environment module URLs.

`component-test-utils.ts:settleComponentUpdates` supplies the existing task-boundary
flush for frame-count tests and the focused motion probe, without calling async
`tick()`. GPU lifecycle and viewport-binding tests retain their frame/upload/resource
assertions. The shared-store example's native range bindings legitimately call
Svelte's `tick()` internally; its manual-mode test now compares RAF requests against
a real compiled `NativeRangeInput.svelte` baseline with the same three input events,
while still asserting zero implicit GPU submissions. This separates native DOM
callbacks from renderer work rather than allowing an arbitrary request tolerance.

The revised regression suite passes all 1,135 tests, including the 345 existing GPU
lifecycle tests, the 60 focused async probes (two overlap the normal suite), and
the existing synchronous canvas SSR/hydration fixtures under the async runtime flag.
Normal tests still pass all 1,166 workspace cases. Production code, the installed
dependency, app compiler options and the lockfile remain unchanged. Global async
compiler opt-in and live GPU validation remain open; the desktop was rechecked and
is still locked.
