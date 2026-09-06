# Derived error propagation investigation

## 1. Scope and risk

Test a third isolated Svelte candidate that prevents partially created DOM from
surviving an async-derived rejection. High risk: derived error propagation is shared
runtime behavior. Do not patch the installed dependency, remove orphan DOM in the
renderer, change app flags, or claim general async support. This extends the existing
pending user decision about carrying preview patches.

## 2. Current program model

`async-viewport-hydration.test.ts` reproduces orphan canvases in both the actual
viewport and a minimal native DOM host with `$derived` object-rest attributes.
Both the untouched preview and the two-patch candidate fail four of 40 cases.

```text
async derived rejects -> deferred component callback starts
  -> attribute effect reads owned object-rest derived
    -> execute_derived sets active_effect to derived.parent (already ran)
    -> rejected input throws -> update_reaction catches -> handle_error
    -> boundary.error destroys subtree, handle_error returns
  -> component callback continues -> append orphan canvas
```

The reader's attribute effect is still being created, but `handle_error` sees the
derived's older owner effect. A direct attribute read without the intermediate
derived unwinds correctly. For unowned deriveds, existing handling caches the error
with `ERROR_VALUE` until the value is read; that behavior must remain intact.

## 3. Proposed program shape

```text
+ repros/probes/async-derived-errors.patch: throw owned-derived errors to reader
~ repros/probe-async-boundary.mjs: explicit derived-errors mode applies three candidates
~ repros/probes/async-viewport-hydration.test.ts: unowned error-cache regression
~ repros/README.md: commands, measured outcomes, limitations
```

After the existing unowned-derived branch, rethrow if `active_reaction` is a derived.
`execute_derived` catches this after `update_reaction` restores the reader reaction,
restores the previous reader effect, then uses the existing error handler. If there
is no active reader (such as a scheduler dirty check), retain the derived owner's
effect as the error boundary context. Do not add an error queue, renderer cleanup,
or successful-frame work beyond the existing try/finally structure.

```text
owned derived throws -> restore reader effect/reaction -> existing error handler
                    -> still-creating reader rethrows
                    -> async callback catches -> existing boundary handling
                    -> no continuation to append
                    -> dirty check without reader retains owner-boundary handling
```

## 4. Contracts and invariants

No production APIs or signatures change. The third mode only edits the disposable
Svelte copy, after the existing two candidates. Original errors must retain identity,
reach a boundary once, and allow reset without stale DOM or GPU startup. Preserve
unowned derived error caching/recovery, direct attribute behavior, native attachment
cleanup, context isolation, and late-result suppression. No extra successful-frame
checks or allocations: the new condition runs only in the existing error handler.

## 5. Vertical slices and verification

1. Apply the isolated candidate and rerun all native/viewport SSR/hydration cases,
   with zero orphan canvases on rejection and one after reset in dev/prod.
2. Check unowned derived error caching and recovery. Rerun the entire mixed-runtime
   regression suite, including 72 real Tween/Spring scene/viewport cadence cases at
   60/120/144 Hz, both demand orders, manual mode, and disposal. Type-check probes.
3. Record evidence without activating a patch. Full upstream Svelte error-handling
   coverage and review of reads outside a render effect remain necessary before
   treating a local passing candidate as a generally correct runtime fix.

## 6. Risks and alternatives

Removing the canvas host's derived rest props would evade one trigger, but user
components can use the same valid Svelte pattern. It would not solve composition.
Early-returning after boundary destruction in DOM append would conceal continued
execution and side effects, so is rejected. Always rethrowing all errors would break
existing unowned caching and boundary handling; keep the change specific to owned
deriveds. Error-stack attribution and unusual external readers require upstream
review. Rollback removes the disposable candidate only; no application migration,
persistent state, or production recovery procedure is involved.

The initial throw-only candidate passed all 40 hydration cases but regressed
`async-components.test.ts`'s existing boundary reset test: `is_dirty(effect)` can
evaluate deriveds before entering `update_effect`'s handler. This verified regression
requires restoring reader-or-owner error context in `execute_derived`; it must not
be hidden with a test exception or a broad scheduler catch.

The refined isolated candidate passes the mixed-runtime regression suite in both
development (1,231 tests) and production (1,211 tests), with no unhandled errors.
Both include the full 72 scene/viewport Tween/Spring cadence cases at 60/120/144 Hz.
Development tests both compiler dev settings, including 41 hydration/error-cache
cases; production runs each behavior with production compilation only. The normal
workspace remains green at 1,174 tests; its renderer package also passes all 1,085
tests in production mode against the untouched dependency. Probe TypeScript passes.

`vitest.config.ts` now explicitly externalizes Node builtins before Vite's browser
resolver loses their names under NODE_ENV=production. This is test-only: happy-dom
still runs in Node, as does the spawned compatibility canary. The probe's
`compiler-modes.ts` prevents invalid dev-SSR/production-runtime pairings, and
`runtime-mode.test.ts` asserts the real DEV flag. No runtime logic is mocked.
Upstream review, production browser/live-GPU verification, and approval to carry
the candidate patches remain open.
