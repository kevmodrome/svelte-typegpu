# Inline boundary snippets

## 1. Scope and risk

Enable the normal inline `failed` snippet shape for custom-renderer boundaries,
including boundary-local constants and ordinary helper snippets. First verify a
compiler-only correction against an isolated copy of the pinned Svelte preview.
High-risk compatibility boundary: lexical scope, error ownership and renderer
ownership must match native Svelte. No installed dependency changes or async app
opt-in are authorized by this investigation.

## 2. Current program model

Svelte's client `SnippetBlock` visitor wraps its generated function with
`renderer_snippet` (outside `wrap_snippet` in development). `SvelteBoundary` assumes
only the development wrapper exists, then prepends boundary-local constant
declarations to the function body. It therefore crashes for inline snippets when
a custom renderer is selected, even with no constants. External snippets work.

```text
boundary transform -> snippet transform -> renderer wrapper -> wrong function lookup
```

## 3. Proposed program shape

Unwrap the renderer tag before the existing development-wrapper lookup. Retain
both wrappers in emitted code, original snippet hoisting, native constant
duplication, async declaration placement and the existing boundary runtime.

```text
+ repros/probes/boundary-snippets.patch       isolated compiler correction
~ repros/probe-async-boundary.mjs             compiler-only candidate mode
~ repros/vitest.svelte-probe.config.ts        independent synchronous snippet suite
+ repros/boundary-snippets/*.test.ts          native/scene comparisons and cadence
~ repros/tsconfig.json                       include the new probes
~ repros/README.md, docs/svelte-compatibility.md  evidence and deployment gate
+ repros/boundary-snippets/patch-commonjs.mjs  hash-checked temporary bundle correction
+ repros/boundary-snippets/compiler-commonjs.mjs  explicit CJS interop for probes
+ repros/boundary-snippets/compiler-parity.test.ts  output/diagnostic parity
+ repros/boundary-snippets/browser.mjs        isolated Vite and live WebGPU probe
```

```text
temporary package copy -> apply compiler patch -> alias Svelte -> compiled tests
  -> delete temporary package; installed preview remains unchanged
  -> optional CommonJS compiler selection or live Vite browser probe
```

## 4. Contracts and invariants

No runtime API or scheduler changes. Svelte still owns reset, attachment cleanup,
error escalation and snippet renderer checks. Constant expressions must remain
inside the boundary and be independently available to its inline snippets.
Renderer tags must survive in both compiler modes. Valid native output must not
change. Canvas SSR continues to omit all GPU content. Existing diagnostics must
remain intact. Async pending support is a separate runtime gate.

## 5. Vertical slices and verification

1. Complete: prove the current crash and compare a component-wrapper alternative against
   native constant scope. Apply the isolated compiler correction; verify inline
   failed/helper/pending compilation, renderer tags, native output, diagnostics,
   failure/reset cleanup, nested escalation and reactive fallback constants.
2. Complete for the isolated candidate: exercise real compiled Tween/Spring around failure/reset at 60/120/144 Hz,
   both demand callback orders and manual mode. Assert exact delivery, targeted
   steady-state uploads, retained siblings/resources, idle and disposal. Record
   probe results and commit the candidate separately from installed dependency
   policy. Actual app support requires an approved patch or upstream update and
   live verification of that deployed compiler.
3. Complete for the isolated candidate: verify the packaged CommonJS compiler as well as ESM. Apply the
   equivalent minified lookup correction to the temporary copy only, guarded by
   the exact original bundle hash and unique expression. Compare client/server,
   dev/production and async compiler outputs and diagnostics; run the same
   lifecycle/motion suite with explicit CommonJS interop.
4. Complete for the isolated candidate: use Node's module-resolution hooks in an isolated probe process to
   point the real Vite plugin at the candidate compiler. Run desktop/mobile
   browser checks for failure, reactive fallback, clicked reset, motion, pixels,
   resource reuse, idle and disposal. No app watcher or dependency files change.

## 6. Risks and unresolved decisions

An internal component wrapper avoids the crash but does not preserve native
boundary constant scope: the upstream visitor explicitly duplicates constants
inside boundary snippets, unlike component snippets. Source hoisting would take
on those compiler responsibilities and change diagnostics/scope. Reject both
alternatives rather than silently narrowing the supported syntax.

The correction targets the pinned visitor shape, not arbitrary future Svelte.
Deployment must cover both ESM source and the CommonJS compiler build; the probe
now exercises both without changing installed Svelte. The pending async
runtime patches remain separate. No public support claim or rollback is needed
until an installed dependency change is approved.

The packaged bundle is a single minified line. A generated full-line patch would
duplicate that bundle in the repository before deployment is approved. Instead,
the isolated runner performs a narrowly hash-guarded mechanical edit; activation
must still generate an explicit package-manager patch covering both compiler
files. Hash mismatch fails closed and requires re-inspection of a new preview.
The browser probe has optional external Playwright/pngjs paths and uses a separate
ephemeral Vite server; software GPU checks cannot prove monitor refresh rate.

## Verified results

- The unmodified ESM compiler fails the synchronous custom-renderer cases with
  `TypeError: Cannot read properties of undefined (reading 'body')`. Native
  comparison cases pass. Both candidate compiler entries pass 58 development and
  53 production tests. The difference is dev-instrumented runtime variants; compile-only cases
  cover both compiler modes in each run.
- ESM and CommonJS output artifacts and diagnostics match across 112 combinations
  of client/server, dev/production, sync/async compilation and DOM/GPU markup.
  Native output also matches the untouched installed compiler. Failed, pending and helper snippets keep their
  renderer tags and reject execution in a foreign renderer scope. Compilation
  of pending snippets does not imply safe async runtime teardown.
- Native and scene tests agree on boundary-local reactive constants, failure
  cleanup, reset from a failure element's click handler, sibling identity and
  nested fallback-error escalation. The component-wrapper alternative actually
  fails at runtime with a ReferenceError when its failure snippet reads the
  boundary-local constant. The synchronous compiler does not reject that source.
- The 36-case motion matrix uses compiled components creating real Tween/Spring
  producers, both scene-only and native-canvas entries, 60/120/144 Hz, both demand
  callback orders and manual mode. Every active clock step produces one frame;
  steady-state writes touch one 96-byte instance after 100 retained static items.
  Failure/reset performs a 192-byte tail write and the next 96-byte motion write,
  not a whole-scene upload. CPU instance storage and GPU buffers/bind groups/
  pipelines are retained. Natural settling idles; unmount during motion cancels
  renderer work and drains the consumer producer without late submissions.
- All 1,300 normal workspace tests and probe TypeScript checks pass against the
  unchanged installed preview. Guard tests reject installed, symlinked and
  mismatched CommonJS targets without modifying them. The installed bundle's
  SHA-256 remains `d765a1335ed4135713cf281de7e538c2f5007cd88505d9aa3b2562bf6b868da0`.
- The real Vite plugin with each isolated compiler passes desktop (1440-wide,
  700x400 canvas) and mobile (390-wide, 300x400 canvas) browser checks. Motion
  changes 1,363 pixels; failure changes 2,198 pixels. Clicking the failure mesh
  resets the boundary and restores identical ready pixels. Fallback labels react
  to boundary-local constants; 37 sibling node identities and canvas identity
  survive. ESM/CommonJS screenshots have identical pixel data and were inspected
  for framing. There are no page or console errors.
- Live resources stay at 8 buffers, 5 bind groups and 1 render pipeline. Unmount
  during motion removes scene nodes/canvas and stops submissions. Seven buffers
  receive explicit destruction; the remaining 12-byte guarded-compute size
  uniform is internal to TypeGPU and released by the single device destruction.
  TypeGPU's `createGuardedComputePipeline` and owned-root `destroy` implementations
  establish this ownership. [Device destruction releases its resources](https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/destroy);
  counting only individual buffer calls would incorrectly report a leak.
- Browser runs use Google SwiftShader, not a physical-monitor timing measurement.
  Each temporary browser/server closes and the candidate copy is removed. The
  normal docs watcher, installed package, lockfile and async options are unchanged.
  An approved explicit package patch, normal-app integration and physical refresh
  verification remain separate deployment gates; no docs build was run.

The consumer syntax follows [Svelte's boundary contract](https://svelte.dev/docs/svelte/svelte-boundary).
The correction and its tests are research artifacts pending dependency policy,
not a source-hoisting adapter or an enabled feature in the apps.
