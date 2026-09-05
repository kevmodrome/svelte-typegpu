# Shared Svelte stores

## Scope and risk

Make ordinary store auto-subscriptions a verified part of scene authoring, and
demonstrate a DOM editor and native-canvas viewport sharing the same stores.
Include same-object vector updates, store replacement and unmount cleanup.
Standard risk: existing Svelte ownership crosses the asynchronous viewport mount;
there must be no renderer-specific subscription layer or new animation loop.

## Current program model

`compileTypeGpu` delegates `$store` compilation to Svelte. Its attribute adaptation
snapshots small structured values before Svelte's attribute identity cache.
`attribute-values.ts` retains stable snapshots until consumed fields change.
`ViewportCanvas.svelte` owns the DOM canvas and separately mounts GPU scene content.
The current tests cover deep `$state`, but not auto-subscribed store lifetimes.

```text
store notification -> Svelte store subscription -> template attribute effect
  -> bounded value snapshot -> renderer dirty path -> targeted GPU upload
```

## Proposed program shape

```diff
+ src/store-components.test.ts          subscription and update contracts
~ src/gpu-lifecycle.test.ts             controlled store notification cadence
~ src/svelte-types.test.ts              generated DOM/GPU import type check
+ type-tests/tsconfig.docs.json         focused generated wrapper scope
+ apps/docs/src/examples/shared-stores/SharedStores.svelte
+ apps/docs/src/examples/shared-stores/StoreViewport.typegpu.svelte
~ apps/docs/src/examples/{example-definitions,scene-components,registry.test}.ts
~ apps/docs/scripts/example-source-texts.ts
~ apps/docs/src/components/ExamplePreview.svelte
~ docs/svelte-compatibility.md
```

The DOM example owns store creation per component instance. Its sliders use native
`bind:value={$position[index]}`; its viewport reads `$position` and writes selected
state directly from `onclick`. No module-global mutable scene state. The existing
docs generator supports ordinary Svelte entry components and GPU viewport imports.
Generated sources are regenerated, not edited manually.

Build evidence changed the generator assumption: precompiled DOM client modules
import `svelte/internal/init-operations`, which accesses `window` when the docs
server loads its module graph. Preserve ordinary `.svelte` files as generated
source with rewritten local imports so Mochi/Vite own their client/SSR compilation.
Only `.typegpu.svelte` files become precompiled `.js`; keep declarations for all
compiled GPU components, including imported children. Add generator-output checks and run the production build to
verify this boundary, not just happy-dom component tests.

## Contracts and invariants

- `$store` has Svelte's normal subscription/replacement/unsubscribe behavior.
  Repeated attribute reads do not create a subscription for every mesh or frame.
- `store.update(value => { value[0] = x; return value; })` updates small structured
  props even when the object identity is unchanged. No-op notifications do not
  invalidate the GPU scene or restart attachments.
- Bulk typed arrays remain opaque. A notification is not a promise to scan all
  resource bytes; immutable resource keys still identify immutable contents.
- Removed components unsubscribe; changing a store prop detaches the old producer.
  Scene events update the same store consumed by native DOM controls.
- Cadence tests exercise 60/120/144 Hz in both callback orders, demand idling,
  manual rendering, targeted upload ranges and buffer/bind-group/pipeline reuse.

Existing Svelte `Writable`/`Readable` types are the public contract. No new renderer
types, state owner or error translation is proposed.

## Vertical slices and verification

1. Compiled subscription/replacement/deep-update tests and GPU cadence. Fix an
   actual renderer defect if found, otherwise retain its current implementation.
2. Runnable example, registry/source integration and example state interaction
   tests. Build all apps, inspect desktop/mobile preview, change controls, click
   the mesh and verify demand idling and error logs.
3. Document exact verified semantics and limits. Commit tests and example in
   separate focused checkpoints, with a clean final worktree.

## Risks and unresolved decisions

Store updates can notify with an unchanged object, unlike reference-based derived
values; the renderer must compare consumed values, not infer a mutation from every
notification. Shared stores should be scoped by consumers, not globally cached by
the renderer. Native DOM binding semantics should remain compiler-owned.
No actions, CSS directives, dependency upgrades or compatibility fallbacks are
included. No production scheduling change is expected; any such change needs
before/after live evidence in addition to the controlled clock tests.

## Verification so far

The four compiled lifecycle tests pass without a production change. The real
Tween/Spring key-reset matrix now additionally routes motion through a writable
vector store using same-object `update` calls: 18 additional cases pass across
60/120/144 Hz, both demand callback orders and manual mode. Targeted uploads,
shared resource reuse and settled/disposed scheduling invariants remain intact.
This is controlled-clock evidence, not a hardware refresh-rate measurement.

The generated Shared Stores editor also passes demand/manual integration tests:
native sliders write the shared vector/rotation, picked mesh clicks update the
native selection checkbox, Escape clears selection, and Reset restores state.
The single changed instance writes bytes 6048..6144 of the shared buffer; GPU
buffers, bind groups, pipelines and canvas identity are retained. No renderer
scheduler change was needed.

The DOM-source generator adjustment fixes the observed server `window` error.
The full build, renderer TypeScript/Svelte checks and all 1,115 workspace tests
pass. The dev route `/examples/shared-stores` returns HTTP 200 on port 3334.
The existing example app's 501.64 kB chunk warning is unchanged.

Physical desktop GPU checks remain pending while the Mac is locked. An isolated
headless Chromium/SwiftShader check can establish layout and visible rendering,
but is not evidence of hardware GPU throughput or the monitor's refresh rate.
HTTP and mocked-GPU tests do not substitute for pixel and interaction checks.

## Generated child declarations

A focused Svelte type check found TS7016 in the generated DOM wrapper: its
`StoreViewport.typegpu.js` child lacked a declaration because only entry modules
received one. Move declaration emission into the GPU component writer, which
owns each output module, and remove the entry-only duplication. All generated
GPU components then have the existing `Component<any>` declaration shape.
This fixes module resolution without weakening strict compiler options or adding
a wildcard module declaration. It does not claim precise generated prop inference
or resolve the separately gated scene-element language-tools issues.

Verify the focused DOM wrapper with zero diagnostics, assert every generated GPU
component has a matching declaration in the registry test, and run full tests and
builds. Native `.svelte` outputs remain source and must not be overwritten by a
declaration. This is a build-time correction with no runtime or frame-loop changes.

The focused type check now reports zero diagnostics; all 1,117 workspace tests
and the full production build pass after generating child declarations.

## Mobile preview correction

Headless layout inspection found that the shared preview's mobile 16:10 aspect
ratio gave the canvas only 75px of height at a 390px viewport, after the store
controls consumed their row. Give the Shared Stores preview a stable 480px height
instead of deriving its total height from the canvas-only aspect ratio. A
conditional DOM class in `ExamplePreview.svelte` scopes the rule in `style.css` to
this example; ordinary canvas-only examples keep their sizing. This is a local docs layout change, not
a renderer or scheduling change. Verify screenshots and layout bounds at desktop,
390px and 320px widths: usable canvas height, visible controls and no overlap or
horizontal overflow.

A minimum-height override while retaining the aspect ratio transferred a 768px
intrinsic width into the parent grid, clipping the controls on mobile. Explicit
height without the aspect ratio avoids that coupling. Check actual element bounds
against the viewport; page `scrollWidth` alone misses overflow that an ancestor
clips.

The loading/error status overlay also covered the selection and Reset controls.
Position it below the FPS badge inside the canvas area for this workbench only.
Include status/control non-overlap in the browser bounds checks.

The first headless screenshots were blank even for Native Events. Explicit ANGLE
SwiftShader flags produced visible Native Events geometry and a passing minimal
WebGPU clear probe. Subsequent runs of both examples stalled in native
`GPUAdapter.requestDevice()` before scene creation, with no validation errors;
full Chromium and headless shell both exhibited the stall. Shared Stores pixel,
scene-picking and manual/demand browser checks are therefore still open. Keep
these failures separate from the verified controlled-clock and mocked-GPU tests.

After the layout correction, Playwright bounds assertions and inspected screenshots
pass at 1440x1100, 390x844 and 320x740. The canvas is 352px high on desktop and
329px on both mobile widths. The preview stays within the viewport, controls stay
inside the preview and below the canvas, and the status overlay does not overlap
the controls. Verify both the observed pending state and an unavailable-adapter
error injected into the isolated test browser; the longer error wraps without
covering controls. These six layout checks do not claim scene pixels were drawn.
All 50 docs tests and the docs production build pass. No frame-loop code changed.
