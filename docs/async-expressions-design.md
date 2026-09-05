# Async expressions in scenes

## 1. Scope and risk

Support Svelte `await` expressions in scene attributes, async derived values, and
child component initialization, with boundary pending/error UI and normal cleanup.
High risk: experimental async mode changes the whole Svelte runtime's batching;
offscreen scene fragments must not reach GPU compilation or picking. Preserve
ordinary `{#await}`, explicit asset sharing, single RAF ownership, and incremental
motion. Do not invent another suspense/loading API or modify the pinned dependency.

## 2. Current program model

`component-test-utils.ts`, the docs compiler, and the example Vite config only enable
`experimental.customRenderer`. Svelte's `AwaitExpression` analyzer additionally
requires `experimental.async`. Its generated modules import the async runtime flag;
`reactivity/async.js:capture` restores `current_renderer` across suspension, and
`dom/blocks/boundary.js` uses renderer-aware fragments and node movement.

```text
scene mutation -> runtime.scheduleSync -> createSceneState -> gpu.setScene
RAF -> flushSync -> scene flush -> frame tasks -> scene flush -> draw
```

The GPU compiles only the mounted root; detached fragments are ordinary scene
nodes without that root's runtime. Svelte owns async batching, obsolete result
suppression, and component effects. loadModel owns fetch/parse, not scheduling.

## 3. Proposed program shape

```text
~ component-test-utils.ts + test-only declarations: async compiler helper
+ async-expressions.test.ts: runtime feasibility, atomicity and cleanup
+ async GPU parity coverage: existing lifecycle suite under the async runtime flag
~ docs compiler/example config only after the compatibility tests pass
~ svelte-compatibility.md + async authoring guide
```

Start with a controlled runtime investigation before changing app compiler options.
An async test helper imports the same flag as a real generated module, then evaluates
the compiled output; synchronous tests remain unchanged. Test the async runtime in
an isolated module graph because the flag cannot be disabled once imported.

```text
await asset -> pending boundary/offscreen scene nodes
           -> Svelte commits resolved subtree -> mounted root dirty -> existing GPU path
```

## 4. Contracts and invariants

`compileAsyncTypeGpuSource<Exports>(source): Promise<Component<any, Exports>>`
is test-only. Public users opt into `experimental.async: true` alongside the custom
renderer compiler option. No new production loader or root API is needed if the
upstream hooks work. Keep `Canvas` startup options initialization-only.

Initial pending UI remains until all expressions in that boundary resolve.
Subsequent updates retain committed content until the dependent update can commit;
unrelated motion must continue. `$effect.pending()` reports subsequent work.
`getAbortSignal` owns cancellation when called in an async derived/effect; shared
promises are not implicitly canceled. Unmount cancels effects and prevents late
scene mutations. Failure/reset must clean up mounted and offscreen branches once.

The runtime never awaits asset work in a frame callback. There is no idle polling,
extra RAF, draw of half-resolved content, or resource allocation for offscreen nodes.

## 5. Vertical slices and verification

1. Async expressions through actual compiled scenes: initial pending -> ready,
   subsequent atomic updates, independent boundaries, rejection/reset, stale results,
   context after await, and late resolution/rejection after unmount. Commit only
   supported behavior; keep upstream failures as precise reproducers if encountered.
2. GPU lifecycle under async mode, plus pending work beside real motion. Test
   60/120/144 Hz and both RAF orders, one targeted upload per moving instance,
   stable GPU resources, idle after settlement, manual no RAF, disposal cancellation.
   Commit performance coverage separately.
3. Enable opt-in authoring where verified, document actual semantics, and run full
   builds/tests. Live desktop/mobile checks require an unlocked Mac; report that
   limitation independently from synthetic cadence evidence.

## 6. Risks and unresolved decisions

Alternative: recommend only `{#await}`. It remains valid, but does not support async
derived/attribute composition. Enabling async globally without isolated regression
coverage risks changing previously working motion and component behavior. A new
renderer-specific async layer would duplicate Svelte ownership and is rejected.
Inline boundary snippets may hit the known pinned compiler issue; external snippets
are a supported spelling, not a separate runtime. If an essential upstream hook is
missing, retain a reproducer and do not claim broad support or patch dependency
internals silently. Rolling back app compiler opt-in does not affect `{#await}`.

Investigation result: initial pending -> ready and subsequent async derived updates
work, including committed-node identity and `$effect.pending()`. Initial boundary
work is not necessarily awaited by `settled()`; the test waits for the resolved
promise's continuation with `tick()` first. This is not yet a support claim.

Both resolve and reject after pending-boundary unmount reproduce an upstream
failure: `destroy_effect` clears `effect.r`, then
`Boundary.#update_pending_count` inserts its offscreen fragment with a null renderer,
falling through to DOM `before`. The isolated reproducer exits 1 with two unhandled
rejections, even though its no-late-scene-mutation assertions pass. The normal test
suite validates this exact known failure in a child process; it does not suppress
errors in the renderer. App compiler flags and the dependency are unchanged.

Decision pending: carry an explicit tested pnpm patch, or wait for an upstream
fix. Until resolved, async expressions stay gated. Ordinary `{#await}` support
and its resource/cadence coverage are unchanged.
