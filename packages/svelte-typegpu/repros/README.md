# Async boundary teardown reproducer

Run from the workspace root:

```sh
pnpm --filter svelte-typegpu exec vitest run --config repros/vitest.config.ts
```

Against pinned Svelte PR 18042 commit `17e37a51bc539cdb6a923b424e5746fc6505ba89`,
the assertions pass but Vitest exits with status 1 and two unhandled rejections:
`TypeError: ref_node.before is not a function`. Both promise resolution and rejection
after unmounting a still-pending boundary trigger it. This is a failing reproducer,
not evidence that async expressions are ready to enable in the apps.

The default suite runs this reproducer in a child process and checks the precise
error via a structured reporter. A dependency change that fixes or alters it will
fail the compatibility canary, prompting re-evaluation. No unhandled errors are
suppressed in the application or renderer.

Trace: `destroy_effect` clears the boundary effect's renderer reference; the pending
count later reaches zero; `Boundary.#update_pending_count` tries to insert its
offscreen fragment with that cleared renderer. `insert_before` falls back to the
DOM's `before` method, which scene nodes intentionally do not implement.

Expected behavior: destroying a pending boundary prevents later offscreen content
insertion and releases pending state. No GPU or native DOM node emulation should
be needed. The reproducer uses the actual TypeGPU scene adapter and generated Svelte
output; WebGPU initialization is not required.

## Isolated candidate probe

These commands copy the installed Svelte package to a temporary directory, alias
all Svelte imports to that copy, and remove it after the test process finishes.
They never patch `node_modules`, change the lockfile, or enable async in the apps.
The candidate is a research artifact, not an active pnpm patch.

```sh
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs baseline
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs candidate
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs nested-effects
```

To compare only the original teardown bug:

```sh
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs baseline repros/async-boundary-unmount.test.ts
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs candidate repros/async-boundary-unmount.test.ts
```

The candidate guards offscreen insertion with the owning effect's `DESTROYED`
flag and releases the fragment reference either way. It does not return before
pending counters drain or change renderer scheduling. The original two teardown
tests pass with no unhandled errors in the candidate copy.

The broader probe also covers keyed replacement with a live sibling, partial
resolution followed by unmount, and removal of a nested boundary contributing to
its live parent's pending count. Every scenario runs with native DOM and scene
elements, for both late resolve and late reject.

The broader suite with only the teardown candidate remains failing: attachments under a nested
boundary without its own pending snippet execute while the ancestor still shows
pending content. This happens in both hosts, with and without the teardown candidate.
The lifecycle tests preserve the desired contract rather than accepting the
observed behavior. Pending counters drain and the parent appears, but early
attachment execution needs a separate scheduler correction. Additional cases cover
parent/child pending snippets resolving in either order and rejection followed by reset.

The `nested-effects` mode applies both separate candidates. For eligible effects
that have not run yet, it finds the nearest pending ancestor and stores the deferred
effect there. Rescheduling after that boundary resolves rechecks the chain. It adds
the same check before running effects collected during an existing batch traversal,
which is necessary for conditional remounts. It adds no per-update ancestor walk
for effects that already ran. All lifecycle and focused cadence cases pass
with this candidate, but it is not an active dependency patch or an async-support
claim. See the [scheduler investigation](../../../docs/async-boundary-effects-design.md).

Verified on the pinned commit above:

| Probe | Passing / failing tests | Unhandled errors | Exit status |
| --- | --- | --- | --- |
| Full baseline | 14 / 46 | 42 teardown TypeErrors | 1 |
| Full teardown candidate | 14 / 46 | 0 | 1 |
| Full nested-effects candidate | 60 / 0 | 0 | 0 |
| Original teardown with candidate | 2 / 0 | 0 | 0 |

The 36 motion cases use real compiled async scenes and Tween/Spring at 60/120/144
Hz in both demand RAF orders and manual mode. They assert frame delivery during
pending/reveal/removal/remount, 96-byte targeted steady-state uploads, CPU instance
storage and GPU resource reuse, idle pending boundaries, and cancellation on
disposal with late resolve/reject. The test shares the normal suite's fake GPU
recorder. Its synchronization avoids async `tick()` because that API adds its own
RAF callback; those test-generated callbacks must not be counted as renderer work.

Type-check the opt-in probe code separately from the package's normal source:

```sh
rtk proxy pnpm --filter svelte-typegpu exec tsc -p repros/tsconfig.json
```

This opt-in suite is excluded from normal tests. The normal suite still checks
the precise original failure against the untouched installed dependency. Passing
the narrow teardown probe is not sufficient to enable experimental async scenes.

## Existing-component regression suite

```sh
rtk proxy env SVELTE_PROBE_SUITE=regression pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs nested-effects
```

This enables the async runtime before each isolated test module and runs the entire
normal renderer package suite plus the focused probes. The candidate passes all
1,135 tests, including 345 existing GPU lifecycle cases and synchronous canvas
SSR/hydration. Compiled fixtures keep their current compiler settings: this tests
coexistence once an async scene enables Svelte's shared runtime, not a global async
compiler migration. The original compatibility canary still runs its intentional
failure in a separate process against the untouched installed dependency.

Frame-count fixtures use a task-boundary flush instead of async `tick()` so test
synchronization does not add RAF callbacks. The shared-store editor compares its
manual-mode callback count to a compiled native range-input baseline: Svelte's DOM
bindings themselves legitimately request callbacks in async mode. GPU submissions,
targeted uploads, idle behavior, and resource reuse assertions are retained.

Browser client fixtures explicitly use happy-dom; Node-only infrastructure tests
retain Node. A test-only server alias keeps SSR context and rendering in one Svelte
module graph. No installed runtime behavior is mocked or patched by the harness.
Global async compiler opt-in, genuinely async SSR/hydration, production patch policy,
and live GPU/physical-refresh validation remain gates before enabling this in apps.
