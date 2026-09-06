# Unsupported directive diagnostics

## 1. Scope and risk

Enforce the agreed attachments-only behavior API and absence of scene CSS.
Reject `use:`, `class:` and `style:` on custom-renderer host syntax at build time,
with original-source diagnostics. Standard risk: a compiler authoring-contract
change, not a runtime or frame-scheduler change. Ordinary DOM `.svelte` files and
supported attachments, scene props and canvas class/style attributes stay valid.

## 2. Current program model

`prepareTypeGpuSource` parses original markup and calls `sceneDiagnostics` before
attribute adaptation and canvas lowering. That analyzer traverses scene elements,
dynamic elements, component children, snippets and control-flow branches. It only
returns unknown-primitive and parent warnings today. The canvas attribute adapter
separately rejects unsupported directives with a generic Error. Raw upstream scene
compilation can accept actions incidentally; that is not our supported API.

```text
compileTypeGpu / Vite markup preprocessor -> prepareTypeGpuSource
  -> original AST diagnostics -> value/canvas adaptation -> Svelte compilation
```

## 3. Proposed program shape

```text
~ compiler/diagnostics.ts              validate host directives during existing walk
+ src/directive-diagnostics.test.ts    source ranges, compilation modes and Vite
~ docs/scene-diagnostics-guide.md      hard errors and migration guidance
~ docs/svelte-compatibility.md         enforce rather than incidentally accept use:
+ docs/unsupported-directives-design.md
```

Reuse the existing diagnostic-location builder for warnings and errors. On a
forbidden directive, throw an Error carrying `typegpu_unsupported_directive`, the
filename, source range and frame. Native canvas messages recommend ordinary
reactive class/style attributes; scene messages recommend material/transform
props. Action messages recommend attachment functions, not a blind syntax rename.

## 4. Contracts and invariants

Validate both regular and dynamic host elements, including unknown custom tags;
their host ABI is still not the DOM. Do not infer component implementations or
reject arbitrary component props. Validate before SSR scene omission so client
and server builds report the same authoring error. Warning filters/onwarn cannot
suppress errors. Earlier user preprocessors retain their existing ordering, so
locations refer to source at the TypeGPU preparation boundary.

Successful source preparation and generated JavaScript must be unchanged. No new
runtime import, host-node property, observer or validation pass enters a frame.
Existing upstream rejections for host bindings and transitions remain untouched.

## 5. Vertical slices and verification

1. Complete: add failing direct/compiler cases across scene-only/viewport, regular/dynamic
   hosts, snippets and control flow, client/server and dev/production output.
   Check code, location, frame and migration message; warning suppression must
   not bypass errors. Confirm valid attachment/value/native-canvas source output.
2. Complete: verify the real Vite preprocessing path rejects the same invalid syntax while
   ordinary DOM directives compile. Run full compatibility/cadence tests and
   type checks; document the contract and commit it separately.

Verification: all 1,300 workspace tests pass, including the 16 new diagnostic
tests; the production renderer suite passes all 1,204 tests. After strengthening
unused-snippet, fallback-branch and Vite-location assertions, the focused 16 tests
pass again. Isolated async-candidate regression passes 1,350 development and 1,330
production tests against the final source, without patching installed Svelte.
Renderer TypeScript compilation and Svelte checking pass with no errors or warnings.

A live Vite viewport on desktop and mobile passes resize motion, native
online/offline updates, unchanged-value idling and unmount cleanup. Pixel changes
confirm rendered output; resources stay at 8 buffers, 5 bind groups and 1 pipeline,
with no page errors. This uses software WebGPU and does not establish physical
monitor refresh rate. Valid compiled output is unchanged; no renderer scheduling
code was modified. Full docs generation/build was not rerun while its watcher
was active.

## 6. Risks and unresolved decisions

Code relying on incidental upstream scene-action support will now fail to build;
it must be rewritten as an attachment with appropriate cleanup semantics. This is
intentional enforcement of an explicitly unsupported API, not action support or
automatic migration. A warning would keep invalid semantics running and could be
silenced, so use a hard error. No dependency patch or public runtime migration is
required. Existing DOM actions remain the application/compiler's responsibility.
