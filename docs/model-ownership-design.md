# Conditional model ownership

## Scope and risk

Make `{#if}`/keyed removal of the last `<model src>` owner cancel its pending
request and release its root-local CPU cache entry. Include data-backed models,
source replacement and disposal. High risk: scene ownership, asynchronous results
and shared resource identity cross module boundaries. No new primitive, action,
ID, global cache, scheduler or change to caller-owned `loadModel()` promises.

## Current program model

`model-cache.ts:createModelCache` keeps URL results in a permanent Map and data
results in a WeakMap, with no pruning or disposal. `readModelDrawItems` reads it
during `scene-compiler.ts:collectMeshDrawItems`, including hidden nodes. Async
settlement asks `svelte-renderer.ts:createRuntime` for a full scene sync. Runtime
disposal ignores late sync requests but does not stop the load or clear its cache.
`model-loader.ts:loadUrlModel` already accepts an AbortSignal. Transform-only
incremental updates do not call `collectMeshDrawItems` or reread model requests.

```text
Svelte tree/resource mutation -> full draw-item collection -> modelCache.read
  -> URL fetch / synchronous data parse -> cache settlement -> scene sync
```

## Proposed program shape

```diff
~ src/model-cache.ts             collection epochs, live entries, cancellation
~ src/model-loader.ts            check cancellation before late body consumption
~ src/scene-compiler.ts          bracket existing full collection
~ src/svelte-renderer.ts         dispose the root-owned model cache
~ src/model-cache.test.ts        ownership, races, data and controller lifetimes
+ src/model-ownership.test.ts    scene retention, precedence, incremental path
~ src/gpu-lifecycle.test.ts      compiled conditional ownership and frame delivery
~ docs/svelte-compatibility.md   conditional model contract
```

Add internal `beginCollection()`, `endCollection()` and `dispose()` methods to
`TypeGpuModelCache`. Each URL/data record stores its entry and last-read epoch;
only pending URL records own an AbortController. Data records become a Map so
explicit pruning can release them. Caller-supplied resolved assets keep weak
entries. The existing full traversal brackets collection; only a successful walk
prunes records not read in that epoch. No extra tree walk or per-frame observer.

```text
full collection -> begin epoch -> existing read calls mark ownership -> prune
  -> remove obsolete record before aborting its request
live settlement -> identity check -> publish result -> existing scene sync
root.dispose -> invalidate cache -> abort pending URLs -> clear owned entries
```

Keep asset > data > src precedence and one request per shared source. Pass an
optional signal to the internal injected URL-loader contract; the default wrapper
forwards it to `loadUrlModel(src, undefined, signal)`. Existing one-argument loader
functions remain assignable. No public export or source syntax changes.

## Contracts and invariants

- Hidden attached nodes retain ownership. Removing one shared owner does not
  abort or evict; removing the last owner does so at scene synchronization.
- Synchronous remove/reinsert before synchronization retains the request. After
  eviction, a new owner starts a new request; ready and failed URL entries are not
  permanent caches. To retain CPU assets deliberately, keep a `loadModel` result.
- Obsolete resolve/reject paths cannot publish, notify or replace a new same-key
  entry. Disposal is idempotent and further reads start no work.
- Data parsing remains synchronous and cannot be interrupted midway; its pending
  promise result still observes ownership/disposal. Explicit assets/promises are
  caller-owned, and their cancellation behavior is unchanged.
- Transform-only updates do not collect/prune models. Live geometry/bind groups/
  pipelines retain existing reuse. Settled demand mode idles, manual mode never
  schedules renderer RAF and obsolete results never request frames.
- Remove records before aborting to make synchronous abort callbacks harmless.
  A failed scene walk must not evict owners merely because traversal was partial.

## Vertical slices and verification

1. Reproduce missing cancellation, implement ownership through the cache and scene
   walk, then verify sharing/visibility/source precedence, same-key races,
   synchronous remove/reinsert, ready/failed eviction, disposal and incremental
   no-work paths. Run renderer typechecks and focused tests; commit this slice.
2. Compile conditional models with controlled fetch. Exercise 60/120/144 Hz,
   settlement before/after renderer callbacks, demand/manual modes, GPU resource
   cleanup/reuse and targeted updates. Run the real Tween/Spring cadence matrix
   and all workspace tests/builds. Document exact evidence and limitations.

Live browser GPU verification is an open gate: the previous headless check stalls
in native device creation, and the desktop Mac is locked. Recheck availability;
do not infer visible rendering or physical refresh rate from mocked tests.

## Risks and alternatives

A permanent URL cache avoids refetch when toggling a model, but retains arbitrary
assets and keeps unwanted network/parse work alive. A node-level reference-count
registry could prune incrementally but would duplicate tree ownership and add
mutation hooks for every reparent/source update. Collection epochs use the walk
already required by structural/resource changes; incremental frames are unchanged.

This intentionally changes implicit cache lifetime. Users needing persistence
should retain explicit assets rather than rely on an undocumented root-lifetime
cache. No data migration is needed. Rollback removes collection/disposal calls and
restores retained entries; explicit loader users are unaffected. Keep network,
settlement and allocation counters in tests; do not add production telemetry.

## Verification so far

The initial scene tests reproduced missing fetch signals and missing cancellation
on removal/disposal. With ownership enabled, all 39 cache/loader/scene ownership
tests pass, plus the existing scene compiler/incremental/runtime tests. A failed
scene walk retains ownership until a successful collection or disposal.

Twelve compiled GPU cases cover hidden/shared owners, last-owner cancellation,
obsolete responses, fresh requests after eviction, live settlement on either side
of a renderer callback, geometry/instance cleanup and targeted 96-byte updates.
Eighteen additional real Tween/Spring key-reset cases cancel and re-add pending
models while checking every delivered frame and shared resource reuse. All 66
targeted cases pass at 60/120/144 Hz with demand/manual behavior and both RAF
orders. These are controlled-clock/mocked-GPU results, not physical GPU evidence.

Full verification passes 1,166 workspace tests (1,077 renderer, 50 docs,
34 example and 5 workspace checks), renderer TypeScript/Svelte checks, and both
app production builds. The existing example chunk-size warning remains at
502.11 kB (146.58 kB gzip). A fresh desktop check still reports the Mac locked;
live GPU validation remains open. No dependency, action or CSS directive support
was added, and no scheduler code changed.
