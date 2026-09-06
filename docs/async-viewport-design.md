# Async viewport compilation

## 1. Scope and risk

Allow explicitly opted-in async expressions in the dedicated canvas entry, including
native attributes and script derived values, while retaining GPU-owned children.
High risk: the compiler adapter selects the DOM/GPU renderer boundary. This is a
compiler compatibility change, not approval to enable async authoring in the apps
or carry the isolated upstream runtime patches. Actions and scene CSS stay out of
scope. Existing async lifecycle and cadence rollout gates remain in force.

## 2. Current program model

`compiler/index.ts:prepareTypeGpuSource` lowers one unconditional native canvas to
`ViewportCanvas.svelte`, scopes CSS by compiling a scene-free native shell, and
rewrites size bindings to attachments. `compileTypeGpu` forwards async options to
the final compile. `compiler/vite.ts` uses the same preparation before Vite chooses
its final compiler options. The CSS-only pass currently omits the async option.

`adaptViewportClient` accepts one top-level static host call and changes only its
entry renderer scope to null. The pinned compiler wraps async host props in
`$.async(anchor, blockers, expressions, callback)`, so the adapter rejects them.
Svelte's async runtime captures/restores the renderer around that callback.

```text
source -> preparation (CSS analysis) -> Svelte compile -> static entry adaptation
       -> DOM canvas host -> onMount -> GPU root -> renderer-owned scene snippet
```

## 3. Proposed program shape

```text
~ compiler/index.ts: async-capable CSS analysis; recognize generated async host callback
~ compiler/vite.ts: merge dynamic experimental options, retaining owned renderer selection
~ src/viewport-compiler.test.ts: opt-in, CSS/binding, server, and fail-closed contracts
~ src/vite-integration.test.ts + test fixture: client/server order and dynamic opt-in
~ src/viewport-test-utils.ts: explicit test-only async compile helper
+ repros/probes/async-viewport.test.ts: actual canvas/native-boundary lifecycle
~ repros/probes/async-boundary-motion.test.ts: native viewport parity and async canvas updates
~ repros/README.md: evidence and remaining gates
```

Allow async only in the discarded-JavaScript CSS analysis pass; final compilation
remains authoritative for feature opt-in. Extend entry inspection through only the
known four-argument `$.async` callback with matching anchor, not arbitrary closures.
Inspect that callback for foreign anchors and still require exactly one host call.
GPU snippet bodies remain opaque and renderer-owned. No new renderer state or RAF.

```text
entry inspection -> top-level blocks
                 -> known $.async render callback -> static host validation
                 -> reject unknown/multiple host shapes or foreign anchors
```

## 4. Contracts and invariants

Production function signatures stay unchanged. `compileAsyncViewportSource` is a
test helper that imports the real async flag before evaluating compiled output.
Svelte owns promise settlement, stale results, boundaries and effect cancellation.
The canvas host still owns native attachments and GPU startup/disposal. Pending
canvas initialization must not allocate a root; subsequent async props must reuse
the canvas/root. Late results after unmount must not create or mutate either.
Scene snippets must never produce native DOM nodes. CSS and size binding diagnostics
must remain native Svelte diagnostics. No application compiler flags are changed.
Vite merges the resolved base experimental options with dynamic overrides, then
reasserts the file boundary's renderer selection. Dynamic options cannot replace
the DOM/scene ownership rule. SSR viewport compilation retains async and selects
the DOM renderer; GPU-only files retain the custom renderer on the client.

## 5. Vertical slices and verification

1. Reproduce and fix compilation: async attributes/deriveds, dev/prod, with and
   without CSS/size bindings, client/server, opt-out errors and adapter negatives.
2. Mount compiled viewports inside native pending/error boundaries using the
   isolated Svelte copy. Assert attachment order, renderer ownership, canvas/root
   identity, rejection/reset and late resolve/reject after disposal. Run the existing
   60/120/144 Hz async Tween/Spring matrix and full mixed-runtime regression suite.
3. Record evidence and keep rollout gated on upstream runtime approval, genuine
   async SSR/hydration, and live GPU validation. Compiler-only server checks do not
   prove async hydration. Any new runtime failure gets a reproducer, not a workaround.

## 6. Risks and unresolved decisions

Threading final async options through preparation is an alternative, but Vite's
dynamic options are selected after markup preprocessing. It would duplicate option
resolution merely for discarded JS. Permissive CSS analysis plus strict final
compilation preserves a single authoritative opt-in. Traversing arbitrary closures
would weaken the renderer boundary and is rejected. Changes to Svelte's generated
async shape should fail closed, with tests pinning the supported structure.

Rollback is reverting the compiler change; there is no state migration or new
resource owner. Errors remain normal compiler/runtime errors. The upstream runtime
patch decision and global async rollout remain unresolved and separate.

## Verified results

The compiler and Vite fixes pass the normal workspace suite (1,174 tests), package
TypeScript build, and Svelte type checks. Ten isolated native-viewport lifecycle
cases pass. The motion probe now runs 72 scene/viewport cases, with an awaited
native canvas attribute updating during Tween/Spring motion, both RAF orders,
60/120/144 Hz and manual mode. One frame per measured step, targeted uploads,
resource reuse, idle settlement, and host-owned disposal hold in the candidate
runtime. The full mixed-runtime regression suite passes 1,189 tests with no
unhandled errors. Probe TypeScript checks pass. These are controlled-clock and
fake-GPU results; the live check was unavailable because the Mac remained locked.
Genuinely async SSR/hydration and the upstream patch decision remain open.

## Async server/hydration investigation

Extend the existing high-risk feasibility probe, without production runtime edits:

```text
+ repros/probes/async-viewport-hydration.test.ts
server render (awaited native props) -> actual server ViewportCanvas -> HTML canvas
client hydrate (separately pending props) -> same canvas -> onMount -> GPU scene
```

Compile the real host and viewport for SSR and evaluate them against the isolated
server runtime graph. Use `await render(...)`, not the synchronous `.body` getter.
The client uses `compileAsyncViewportSource` and `hydrate(..., { recover: false })`.
Svelte owns hydration markers, promise suspension and context propagation; the
test owns deferred values, native DOM, mocked GPU-root startup, and teardown.

First verify dev/prod and async attribute/derived variants: SSR waits for native
values but never executes scene-only work, starts WebGPU, or runs attachments;
client hydration keeps the server canvas and CSS scope, waits before startup,
inherits context, and mounts scene attachments only when their async work resolves.
Then cover rejection and unmount while hydrating (late resolve/reject), concurrent
server contexts, and native pending-boundary SSR fallback if supported by Svelte.
Keep native DOM controls as a parity baseline for any suspected upstream failures.
The existing native-viewport cadence matrix remains required regression coverage.

Removing the adapter or recovering by replacing the server DOM is not an acceptable
alternative: it would hide renderer ownership or hydration failures. Preserve
unhandled errors and hydration warnings as failures. These tests do not establish
browser GPU throughput, framework-specific streaming integration, or approval to
activate upstream patches. Unexpected failures become focused reproducers before
any production or dependency change.

The 40-case probe passes 36 and fails four on both the unmodified preview and the
two-patch candidate. Awaited SSR, concurrent contexts, direct hydration, cancellation,
and native pending fallback resolution pass. Rejected async derived props can leave
an orphan canvas when the host derives object-rest attributes; reset adds a second
canvas. A minimal plain DOM component reproduces the same dev/prod failure. A bare
native canvas and direct async attributes pass. This is a new rollout gate, not
evidence that the renderer needs DOM cleanup workarounds. The expanded mixed-runtime
regression result is 1,225 passing, four failing, and no unhandled errors.

The separate [derived-error investigation](async-derived-errors-design.md) now
tests a third isolated candidate. It fixes those failures and preserves the existing
boundary reset behavior; all 41 hydration/error-cache cases and 1,230 mixed-runtime
regression tests pass with that candidate. No dependency patch is active. Broad
runtime review, production-runtime coverage and live verification still gate rollout.
