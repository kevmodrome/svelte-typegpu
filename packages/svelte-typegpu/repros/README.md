# Renderer integration probes

## Attachment listener options

```sh
rtk proxy env TMPDIR=/tmp pnpm --filter svelte-typegpu exec node repros/listener-options.mjs
```

This separate installed-compiler WebGPU viewport checks picked one-time clicks,
real Tween movement, passive native wheel cancellation, AbortController removal,
reattachment, resource reuse, and unmount during animation at desktop/mobile sizes.
Use the optional browser dependency, executable, and screenshot-directory variables
described below. The browser/server close afterward; the normal docs server and
installed dependencies are unchanged. Software-WebGPU checks do not establish the
physical display refresh rate. See the
[listener contract and design](../../../docs/event-listener-options-design.md).

## Mesh noise resources

`noise-resources.mjs` uses the installed compiler and a separate Vite/WebGPU browser
to exercise conditional standard/smoky materials on a real compiled viewport:

```sh
rtk proxy env TMPDIR=/tmp pnpm --filter svelte-typegpu exec node repros/noise-resources.mjs
```

It uses the same optional `SVELTE_PROBE_BROWSER_DEPENDENCIES`,
`SVELTE_PROBE_CHROMIUM`, and `SVELTE_PROBE_OUTPUT` settings described below.
Desktop/mobile checks cover visible material replacement, animated noise, 60 manual
frames with no new buffers or pipelines, one noise initialization across material
switches, zero renderer RAF callbacks, idle submissions, and buffer/device cleanup.
It never patches dependencies or changes the normal docs server. The plain scene
must not create a noise compute pipeline. See the
[design and allocation results](../../../docs/lazy-noise-design.md).

## Inline boundary snippets (compiler-only)

The independent `boundary-snippets` mode applies the ESM
`probes/boundary-snippets.patch` and its hash-checked CommonJS equivalent to a
temporary Svelte copy. It selects its own
synchronous suite by default and does not apply any async runtime patch:

```sh
rtk proxy env TMPDIR=/tmp pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs boundary-snippets
rtk proxy env TMPDIR=/tmp NODE_ENV=production pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs boundary-snippets
rtk proxy env TMPDIR=/tmp SVELTE_PROBE_COMPILER=cjs pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs boundary-snippets
rtk proxy env TMPDIR=/tmp NODE_ENV=production SVELTE_PROBE_COMPILER=cjs pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs boundary-snippets
rtk proxy env TMPDIR=/tmp SVELTE_PROBE_SUITE=boundary-snippets pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs baseline repros/boundary-snippets/lifecycle.test.ts
```

The baseline command intentionally fails the scene cases with a compiler TypeError;
native scope/error comparisons pass. Each compiler entry passes 58 development
and 53 production tests, including 36 real Tween/Spring cadence cases across scene and
viewport entries at 60/120/144 Hz. It preserves renderer guards, boundary-local
constant scope, failure/reset cleanup, native compiler output, targeted writes,
resource reuse, settled idling and manual/disposal behavior.

This fixes the client boundary visitor's lookup of the function inside a
renderer-tagged snippet. It neither hoists consumer source nor adds a component
wrapper. The one-line CommonJS bundle is mechanically edited only inside the
temporary copy; its full hash and the unique target expression must match the
pinned preview. Installed, mismatched and symlinked targets are rejected. An
explicit interop module selects the real CommonJS compiler for the same tests.
The installed compiler stays the native-output baseline. A separate test compares
112 ESM/CommonJS compilation combinations, including expected diagnostics.

The optional live probe requires Node 24 (module-resolution hooks), Playwright,
pngjs and a downloaded Chromium executable. By default the probe resolves browser
dependencies normally; `SVELTE_PROBE_BROWSER_DEPENDENCIES` may point to an existing
node_modules directory containing them. `SVELTE_PROBE_CHROMIUM` may override the
executable, and `SVELTE_PROBE_OUTPUT` selects the screenshot directory:

```sh
rtk proxy env TMPDIR=/tmp SVELTE_PROBE_COMPILER=esm pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs boundary-snippets --browser
rtk proxy env TMPDIR=/tmp SVELTE_PROBE_COMPILER=cjs pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs boundary-snippets --browser
```

Both live entry points pass desktop/mobile motion, failure, reactive fallback
labels, clicked reset, identical recovery pixels, sibling/canvas retention, idle
and unmount-during-motion checks with software WebGPU. Buffers/bind groups/pipelines
remain stable; teardown verifies renderer-managed buffer destruction and device
destruction for TypeGPU-owned internal resources. It prints metrics and saves
ready/failed PNGs, then closes the separate browser/server. It never changes the
normal docs server. Physical display cadence is not inferred from these runs.

An approved explicit package-manager patch covering both compiler files (or an
upstream update), followed by normal-app verification, remains a deployment gate.
Inline boundary snippets are not yet supported in the running apps.
See the [design and results](../../../docs/boundary-snippets-design.md).

## Async teardown baseline

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

Boundary lifecycle/motion comparison on the pinned commit above (before adding
the separate viewport probes):

| Probe | Passing / failing tests | Unhandled errors | Exit status |
| --- | --- | --- | --- |
| Full baseline | 14 / 46 | 42 teardown TypeErrors | 1 |
| Full teardown candidate | 14 / 46 | 0 | 1 |
| Full nested-effects candidate | 60 / 0 | 0 | 0 |
| Original teardown with candidate | 2 / 0 | 0 | 0 |

The motion probe now has 72 cases: scene-only and native-viewport entries using
real compiled async scenes and Tween/Spring at 60/120/144 Hz in both demand RAF
orders and manual mode. They assert frame delivery during
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
rtk proxy env SVELTE_PROBE_SUITE=regression pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs derived-errors
```

This enables the async runtime before each isolated test module and runs the entire
normal renderer package suite plus the focused probes. The three-patch
`derived-errors` candidate passes all 1,231 tests, with no unhandled errors,
including 345 existing GPU lifecycle cases and 72 async motion cases. The earlier
`nested-effects` candidate fails the four hydration rejection cases described below.
Compiled fixtures keep their current compiler settings: this tests
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

## Async native canvas entry

The compiler now recognizes Svelte's generated async host callback and permits
async syntax in the CSS-only analysis pass. Final compilation still requires
explicit async opt-in. Vite preserves dynamic experimental options while retaining
the TypeGPU-owned renderer selection, in either client/server transform order.
These fixes do not enable async in applications or activate the candidate patches.

`probes/async-viewport.test.ts` adds ten candidate-runtime tests for async native
attributes and script derived values, including dev/prod, scoped canvas CSS and
size bindings. A native parent boundary owns pending/error content. The tests
verify no GPU startup while pending, native/scene attachment ownership, inherited
context, stable canvas/root identity on updates, rejection/reset, and late
resolve/reject after unmount. All ten pass with the combined candidate; the full
mixed-runtime result above includes them. Server compiler tests alone are not
evidence of genuinely async hydration. See the
[viewport compiler design](../../../docs/async-viewport-design.md).

The 36 added viewport cadence cases use the actual native canvas host and GPU root
lifecycle with the shared fake GPU recorder. Native canvas attributes suspend,
commit, and settle late after disposal alongside nested pending scene content and
real Svelte motion. The matrix retains the scene-only frame/upload/allocation
assertions, checks native canvas identity and one GPU initialization, and relies on
host unmount for GPU disposal rather than manually disposing the viewport's root.
This proves controlled callback delivery, not live GPU throughput or physical
monitor refresh. The Mac was still locked during the attempted live check.

## Async server rendering and hydration

```sh
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs baseline repros/probes/async-viewport-hydration.test.ts
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs nested-effects repros/probes/async-viewport-hydration.test.ts
```

Both modes pass 36 of 40 cases and fail the same four assertions, with no unhandled
errors. Passing cases cover awaited server output, untouched scene work on the
server, concurrent server contexts, native SSR pending fallbacks, dev/prod, retained
canvas identity and CSS, native events/size bindings, client-only scene startup,
server rejection, and late client resolution/rejection after hydration unmount.

Failure: an async script derived rejects after hydrating a pending boundary. When
the canvas host uses `$derived` object-rest props, an empty canvas remains beside
the failed snippet; resetting then produces a second canvas. A minimal ordinary
DOM component reproduces it, without the TypeGPU compiler/runtime:

```svelte
<script>
  let { children, ...attributes } = $props();
  const { class: canvasClass, ...nativeAttributes } = $derived(attributes);
</script>
<canvas {...nativeAttributes} class={canvasClass}></canvas>
```

The async parent passes its rejected derived as `aria-label`. A bare native canvas
and an async attribute expression pass; the object-rest host and viewport fail in
both dev/prod. The suspected path is `execute_derived` restoring the derived's
already-run owner effect, then `handle_error` handling the failure without unwinding
the still-creating reader. The tests require zero canvases after rejection and one
after reset, rather than accepting or manually removing orphaned DOM.

## Isolated derived-error candidate

```sh
rtk proxy pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs derived-errors
```

This mode adds `probes/async-derived-errors.patch` to the two earlier candidates.
Owned-derived errors unwind to `execute_derived`, which restores the reader effect
before invoking the existing error handler. Scheduler dirty checks without an
active reader retain the owner boundary context. Unowned deriveds keep their error
cache and recover after invalidation. A throw-only version was rejected because it
broke an existing boundary reset test during `is_dirty`; the refined candidate
passes that test without changing its assertions.

The development regression run includes 41 hydration/error-cache cases and 72
cadence cases and passes all 1,231 tests. Normal
workspace tests still pass all 1,174 cases against the untouched dependency. Probe
TypeScript checks pass. This is not an active patch or a general Svelte runtime
correctness claim; see the [error propagation design](../../../docs/async-derived-errors-design.md).

## Production runtime

```sh
rtk proxy env NODE_ENV=production pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs derived-errors
rtk proxy env NODE_ENV=production SVELTE_PROBE_SUITE=regression pnpm --filter svelte-typegpu exec node repros/probe-async-boundary.mjs derived-errors
rtk proxy env NODE_ENV=production pnpm --filter svelte-typegpu exec vitest run
```

| Run | Tests passing | Dependency |
| --- | --- | --- |
| Development mixed-runtime regression | 1,231 | Isolated three-patch candidate |
| Production mixed-runtime regression | 1,211 | Isolated three-patch candidate |
| Production focused probes | 128 | Isolated three-patch candidate |
| Production normal renderer suite | 1,085 | Untouched installed preview |

All runs exit zero with no unhandled errors. The runtime-mode canary checks the
actual `esm-env` DEV flag. Production retains every behavior category, including
the full 72-case cadence matrix, but does not pair dev-instrumented SSR output with
the production runtime: that runtime intentionally omits the metadata it reads.
Development still exercises both compiler `dev` settings. The 20-case difference
is those redundant compiler-mode variants, not disabled behavior assertions.

The shared Vitest config preserves Node builtin imports before Vite's production
browser resolver discards their names. Happy-dom tests and the spawned compatibility
canary still execute in Node; neither gets a mock or polyfill for those builtins.
The compatibility canary continues to prove the original teardown failure against
the untouched dependency in its own process, including in production mode.

Upstream error-handling review, patch approval, global async compiler rollout, and
live GPU verification remain separate gates. These runtime checks do not establish
a production browser bundle's throughput or the monitor's physical refresh rate.
