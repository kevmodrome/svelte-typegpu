# Async scene composition

## 1. Scope and risk

Add an opt-in promise-based model loader and verify ordinary Svelte `{#await}`
composition. Preserve `<model src>` / `<model data>`. No async compiler mode,
Suspense clone, global asset registry, loading IDs, or new scheduler. High risk:
public API, async ownership, and geometry identity cross module boundaries.

## 2. Current program model

`model-cache.ts:createModelCache` owns root-local URL and buffer caches. Its
private loaders parse OBJ/GLB. `scene-compiler.ts:readModelDrawItems` reads cache
entries; loading/failed entries render nothing. Settlement schedules a scene
sync through `svelte-renderer.ts:createRuntime`. GPU caches prune unused keys.

```text
<model src/data> -> scene compiler -> model cache -> fetch/parse
                                      settlement -> scene sync -> GPU draw
```

## 3. Proposed program shape

Extract the existing loader implementation; do not duplicate parsing. Add
`loadModel(source, { signal? }) -> Promise<TypeGpuLoadedModel>`. Add `asset` to
the model primitive; the cache wraps resolved assets in stable weak entries.
Asset takes precedence over data, then src. Reusing an asset reuses geometry
keys. Separate explicit loads receive distinct keys, even for the same URL, so
a retry cannot collide with still-mounted older geometry.

```text
+ src/model-loader.ts, src/model-loader.test.ts
~ src/model-cache.ts, src/model-cache.test.ts (reuse loader; weak asset entries)
~ src/primitives.ts, src/scene-compiler.ts, src/index.ts (asset input/public API)
~ src/scene-compiler.test.ts, src/gpu-lifecycle.test.ts
+ src/async-components.test.ts (pinned compiler/runtime compatibility)
~ docs/svelte-compatibility.md, docs guide and a live model example

loadModel -> fetch/parse -> {#await} -> <model asset> -> scene sync -> GPU draw
                          pending/catch are ordinary scene branches
```

Existing implicit loading, material overrides, transforms, and resource pruning
remain. Only loader function bodies move out of the cache.

## 4. Contracts and invariants

- Source is a URL string or ArrayBuffer. The public loader does not memoize;
  callers retain/share the promise or asset and retry by creating a new promise.
- Assets are CPU data, treated as immutable; replacing the reference changes
  geometry. No GPU device or root is needed to load. GPU resources remain owned
  by each renderer and are released when no mounted draw item uses them.
- AbortSignal cancels fetch and is checked before parsing. Synchronous parsing
  cannot be interrupted midway. Rejections propagate to `{#await ... :catch}`.
- Svelte owns stale-promise suppression and branch effect cleanup. Unmount does
  not implicitly abort a caller-owned/shared promise; use `getAbortSignal()` in
  a derived/effect for component-owned requests.
- Resolved assets enter synchronously, without re-fetch, parse, settlement
  callback, or RAF. Dirty asset replacement rebuilds batches; transforms retain
  the incremental path. Weak entries do not retain abandoned assets.

## 5. Vertical slices and verification

1. Public loader to visible model: loader format/error/abort/key tests; cache
   identity/no settlement tests; scene sharing/replacement/material tests;
   renderer typecheck. Commit independently.
2. Compiled `{#await}` pending/ready/error/stale/unmount and context composition;
   investigate boundaries against the pinned compiler before claiming support.
   At 60/120/144 Hz verify bounded demand draws, resource reuse/pruning and no
   post-unmount submissions; retain existing real motion callback-order matrix.
   Commit verified compatibility separately.
3. Live model example and guide: browser desktop/mobile render checks, loading
   and failure recovery, console errors; full workspace tests/build. Commit
   source and generated output together.

## 6. Risks and unresolved decisions

Alternative: expose a root-owned async cache via Svelte context. That couples
data loading to GPU initialization and adds shared cancellation/retry policy.
The explicit loader is smaller; callers opt into sharing with ordinary Svelte
state/context. No migration required; rollback removes only the new export and
asset attribute. Asset mutation is unsupported. URL-cache eviction and worker
parsing are separate future work, not hidden in this change. Boundary async
pending semantics remain unclaimed unless the pinned compiler supports them.

## Verified results

- Public loader/cache/scene tests pass. Compiled components cover pending,
  ready, failure, obsolete results, resolution/rejection after unmount, reactive
  context, and cancellation through Svelte `getAbortSignal()`.
- The pinned compiler crashes when `failed` is declared inside a boundary.
  An externally declared snippet passed with `{failed}` works; failure cleanup,
  reset, and sibling identity have runtime tests. Async boundary pending remains
  unclaimed.
- GPU tests at 60/120/144 Hz verify bounded demand work, no manual-mode RAF,
  one shared geometry upload, a 96-byte affected instance range for material
  edits, no replacement buffers/bind groups/pipelines, and cleanup on removal.
  Existing real Tween/Spring tests retain both RAF callback orders.
- Phong example now uses `{#await}` with explicit reload, error reporting, and
  recovery. Its lighting controls no longer remount the scene. A compiled test
  verifies unrelated material changes retain the request and model node while
  explicit source-object replacement reloads even the same URL.
- Workspace: 524 tests pass; renderer typecheck and both app production builds
  pass. Browser: desktop 1280x720 and mobile 390x844, nonblank canvas pixel checks,
  visible lighting updates, failed URL and successful recovery, no warning/error
  logs. Displayed FPS remained 60 on this browser surface; synthetic 120/144 Hz
  results are not physical monitor measurements. Mobile document width 375 is
  within its 390-pixel viewport.
