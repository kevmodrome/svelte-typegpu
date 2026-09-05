# Declarative canvas boundary

Status: implementation in progress, gated by the compile/hydration proof below.
Dedicated `.typegpu.svelte` viewports are the agreed initial scope. The existing
Canvas API remains supported during this work.

### Implementation checkpoint

The first slice tests a narrowly validated compiler adapter. After lowering the
single canvas to a static DOM host, compile its scene snippets with the custom
renderer. An AST-based output adapter changes only the outer component's renderer
scope to DOM (`push_renderer(null)`); the scene snippets retain their actual
renderer identity. This avoids duplicating or extracting the consumer's script
and avoids importing hydration internals into the runtime. It is deliberately
pinned-compiler integration, not general renderer interleaving. Reject changed
compiler output rather than guessing when its structural assumptions fail.

Client and server compilation must produce matching DOM shells. Server output
omits scene content and does not initialize WebGPU. Prove identity-preserving
hydration, parent conditional ownership, context, events, CSS and native handles
before adding GPU startup. If these fail, revise the approach before migration.
Canvas bindings/directives must either retain their native meaning or produce
an explicit diagnostic; they must not silently target an internal component.

Proof result: the tenth isolated test passes with `hydrate(..., recover: false)`.
It retains the exact server-rendered canvas, mounts custom-authored conditional
scenes, updates local state and disposes both surfaces. This establishes the
outer DOM renderer scope approach for the static host; it does not yet establish
the source transform, native attribute contract, CSS or GPU behavior.

Implemented foundation: `compiler/index.ts` now performs source lowering and
validated client entry adaptation; `compiler/vite.ts` supplies the Vite boundary.
`ViewportCanvas.svelte` owns a real canvas and uses `canvas-lifecycle.ts`, shared
with the legacy Canvas host. The parameterless compiled children snippet itself
is the mounted scene entry, so no additional SceneContent component is needed.
Tests cover the actual server host, hydration identity, native canvas references,
scoped CSS output, events, attachments, keyed moves, context, delayed startup and
teardown. The real GPU lifecycle suite covers both hosts with Tween/Spring at
60/120/144 Hz, both callback orders, and manual mode.

The initial contract allows at most one mounted scene (including hidden scenes).
Invalid multiple scenes report an error and dispose the owned scene/root. Empty
content clears once and idles. Testing exposed a redundant invalidation through
setScene -> setCamera; setScene now updates camera data and requests only one
frame. All 646 renderer tests and consumer type checks pass at this checkpoint.
Live verification is pending because the user's Mac is locked.

## 1. Scope and risk

```svelte
<!-- Viewport.typegpu.svelte: proposed authoring API -->
<script>
  let { editing } = $props();
</script>

<canvas frameloop="demand">
  {#if editing}
    <scene><Editor /></scene>
  {:else}
    <scene><Preview /></scene>
  {/if}
</canvas>
```

The DOM app imports this as `<Viewport {editing} />`. There is no public
`scene={...}`, `sceneProps`, or `canvasProps` at this boundary. Sharing application
state still uses normal props/context; object state and event handlers stay local.

High risk: compiler modes, foreign anchors, async ownership, SSR/hydration,
public types, and performance. Initially require one unconditional top-level
canvas per viewport file. A normal DOM parent may conditionally mount the whole
viewport; supported Svelte scene composition remains available inside its canvas.
Multiple viewport instances may exist, with independent root lifetimes.

Non-goals: mixing arbitrary DOM controls and scene nodes in one file, nested
canvases, multiview/compositing, replacing the scene engine, a new RAF loop,
per-object DOM elements, or upgrading the Svelte dependency.

## 2. Current program and evidence

Findings apply to installed Svelte preview `17e37a51bc539cdb6a923b424e5746fc6505ba89`,
not a claim about the current upstream head.

- `packages/svelte-typegpu/src/Canvas.svelte` owns DOM nodes, captures context,
  initializes WebGPU after mount, and mounts `SceneHost.svelte` with getter props.
  Cleanup unmounts the scene before disposing the GPU root.
- `src/svelte-renderer.ts:createTypeGpuRoot` initializes the GPU renderer, then
  creates its retained root/runtime. `createRuntime` batches dirty changes.
- `src/core.ts` creates retained nodes and routes mutations to their retained
  root. A node named canvas is not an HTMLCanvasElement or a new runtime owner.
- `apps/example/vite.config.ts` selects a renderer per component filename. The
  pinned compiler emits renderer push/pop per component, not per canvas subtree.
- The pinned runtime's `dom/blocks/snippet.js` validates snippet renderer identity.
  The server compiler's `transform-server.js` makes custom components no-ops.

```text
Current: DOM Canvas -> await GPU root -> mount(SceneHost, renderer, props/context)
         -> retained node mutations -> dirty synchronization -> frame scheduler
```

### Executed probes

`packages/svelte-typegpu/investigations/canvas-boundary.test.ts` uses real compiled
Svelte and the actual scene-node adapter. Its nine tests establish:

- A canvas-named retained node survives scene `{#if}` changes. Keyed mesh reorder
  preserves identity; attachments clean up. No real DOM canvas is created.
- DOM-authored scene snippets fail with `snippet_renderer_mismatch` under the
  custom renderer. Snippets cannot simply be reinterpreted at runtime.
- A custom component with a single static imported DOM host can pass custom
  children through that host into a separate custom mount. Scene changes retain
  the real canvas; keyed identity and teardown work in this narrow client case.
- A normal DOM parent can conditionally mount that static-host viewport and
  update ordinary props without replacing its canvas. Hiding the whole viewport
  cleans it up; showing it again intentionally starts a new DOM canvas lifetime.
- A DOM host inside a custom-rendered `{#if}` fails on its foreign anchor:
  `before is not a function`. The static success is not general interleaving.
- Input `bind:value`, canvas `bind:clientWidth`, and canvas `transition:fade`
  are rejected by the custom compiler. Naming a custom node canvas changes none
  of these compiler restrictions.
- Server compilation of the custom canvas component emits no canvas shell.

```sh
rtk proxy env TMPDIR=/tmp pnpm --filter svelte-typegpu exec vitest run \
  --config investigations/vitest.config.ts investigations/canvas-boundary.test.ts
```

These probes do not initialize WebGPU or establish GPU performance or hydration
correctness. They are separate from the default suite and the known failing
async-boundary teardown reproducer.

[Paolo Ricciuti's interleaving analysis](https://gist.github.com/paoloricciuti/f8613bf785285d287c9afb11761835b9)
also discusses snippet identity and foreign-node ownership. Some details in
that May 2026 note predate this pin, including `renderer.render`. Local source
and probes take precedence. The upstream PR page could not be fetched during
this investigation; no dependency upgrade was attempted.

## 3. Proposed program shape

Investigate a narrow, AST-based viewport compilation step. It recognizes the
explicit top-level canvas in a `.typegpu.svelte` entry and lowers it to an
internal DOM host receiving custom-authored scene content. GPU-only child
components keep their existing compilation. Normal `.svelte` canvases stay DOM.

The existing static-host probe makes this plausible, not complete. Scope,
bindings, directives, CSS, SSR, and movement/removal must be deliberately handled;
do not depend on incidental compiler output or patch generated JS with regexes.
An SSR variant must render only the DOM shell, never execute the scene snippet.

```text
Viewport source -> shared compile boundary -> DOM-facing component export
  -> one real canvas + native props/listeners
  -> async GPU initialization
  -> mount custom-authored content once with captured contexts
  -> Svelte branches/snippets/components mutate retained nodes
  -> existing dirty synchronization and scheduler
Viewport removal -> unmount content -> dispose GPU and listeners
```

Candidate layout, to refine after the compile proof:

```text
+ packages/svelte-typegpu/src/CanvasBoundary.svelte    Internal DOM/lifetime owner
+ packages/svelte-typegpu/src/SceneContent.svelte      Typed custom snippet host
+ packages/svelte-typegpu/compiler/*                  Shared AST/compile integration
~ apps/example/vite.config.ts                         Integrate viewport compilation
~ apps/docs/scripts/compile-typegpu-scenes.ts          Use the same integration
~ packages/svelte-typegpu/type-tests/*                 Original-source and import types
~ packages/svelte-typegpu/src/gpu-lifecycle.test.ts     Actual boundary performance tests
```

Reuse `createTypeGpuRoot`, its runtime, and `mount`/`unmount`. Keep the existing
Canvas/SceneHost API operational during the experiment; share lifetime code if
needed rather than maintaining two permanent GPU ownership implementations.

### Alternatives

- **Per-subtree compilation in ordinary Svelte:** closest to one-file DOM/scene
  composition, but the pinned PR has no such compiler hook. Deferred by the
  agreed scope; it needs separate scope-aware compilation/tooling work.
- **Component-backed primitives:** ordinary `Canvas`/`Mesh` components register
  retained objects through context. [Threlte demonstrates this composition
  model](https://threlte.xyz/docs/reference/core/canvas). It avoids this compiler
  crossing, but changes our primitive model. Measure component/effect overhead
  before claiming it would be slower; GPU batching could still be retained.
- **DOM emulation on scene nodes:** not recommended. Adding native-shaped
  methods may satisfy a static insertion but does not solve compiler-disabled
  directives, snippet ownership, removal, or SSR.

## 4. Contracts and invariants

Conceptual internal types, not proposed public exports:

```ts
type SurfaceStatus = 'pending' | 'ready' | 'error' | 'disposed';
type SceneContent = Snippet; // authored and mounted using the same renderer
// Boundary owns: real canvas, current content, captured contexts, one GPU root.
```

- Canvas lifetime is independent of scene branches. No GPU reinitialization
  on scene switches, local motion, or native attribute updates.
- Initially zero or one active scene per canvas. Zero scenes should clear once
  and idle in demand mode; multiple active scenes must not silently merge.
- Svelte owns authoring state. Preserve lexical closures, context, and granular
  subscriptions. No cloned state graph, per-frame prop copying, DOM scene scan,
  or ID registry. Reuse shared GPU resources still in use; release removed
  branch-owned resources normally.
- Native canvas events expose a DOM canvas target. Mesh/group events expose
  hit-tested scene nodes. Specify ordering/cancellation when both handle the
  same input; canvas keyboard focus does not imply keyboard navigation of meshes.
- `bind:this`, attachments, classes/styles, and native bindings/directives need
  explicit canvas semantics. Lowering to an internal component must not silently
  change the exposed handle to a component instance. Verify original-source types.
- CSS owns display size; the renderer owns pixel dimensions/DPR. Resizing uses
  existing scheduling. Define reactive versus creation-only settings; never
  silently recreate a root for a changed initialization-only attribute.
- Async startup uses current content/props when ready. Unmount before resolution
  disposes a late root without mounting content or firing readiness. Failures
  release acquired resources and remain observable and recoverable.
- Context forwarding across `mount` is not shared effect/error-boundary ownership.
  Test parent `svelte:boundary`, pending counts, and cancellation explicitly.
  Existing async-expression limitations remain; no blanket compatibility claim.
- Preserve an accessible SSR shell and stable hydration if feasible within this
  boundary. If that requires a broader compiler change, stop for design review
  rather than silently downgrade to client-only output.

## 5. Vertical slices and verification

1. **Compile boundary proof:** exact lowercase authoring syntax, ordinary DOM
   import, local state, conditional scenes, keyed children, canvas events,
   conditional mounting of the viewport in its DOM parent, context, and cleanup.
   Include native handle/binding, scoped CSS, types, and SSR/hydration probes.
   No GPU required. Review any reliance on extra Svelte internals before proceeding.
2. **One real surface:** connect the proven boundary to existing GPU creation.
   Test scene switches, empty scenes, independent surfaces, startup races/errors,
   and disposal. Real Tween/Spring at 60/120/144 Hz, both callback orders,
   demand/manual clocks, precise upload ranges and affected counts, stable
   buffers/bind groups/pipelines, and bounded allocations. Review before migration.
3. **One authored example:** migrate only Native Events after both gates pass.
   Check desktop/mobile sizing, focus/input, wheel cancellation, and visible
   rendering. Distinguish browser callbacks, rendered frames, CPU work, and GPU
   throughput. Synthetic clocks do not establish physical monitor refresh rate.

## 6. Decisions and migration

Settled: dedicated viewport files initially, normal props/context for external
state, direct primitive handlers, and preservation of the current GPU runtime.

Still open: exact entry validation, supported canvas bindings/directives, DOM
reference semantics, reactive surface options, startup error/retry API, and
how the generated boundary participates in Svelte errors/SSR/hydration. Do not
rename callbacks or remove the current host as a side effect of this research.

Roll out behind the viewport compile path with one example only after the
verification gates. Retain the existing host and low-level API until migration
is reviewed. Roll back by disabling the new compile path and using the original
host; no persisted state, GPU resource format, or dependency change is required.
Retain FPS/error diagnostics and prove no renderer remains alive after teardown.

The public API has not been implemented. The current evidence supports a careful
compile-boundary spike, not shipping a general DOM/custom-renderer bridge.

Verification checkpoint: all nine isolated investigation tests and all 681
existing workspace tests pass. No production build or live GPU benchmark was
needed for these documentation/probe-only changes; neither establishes that the
proposed boundary is ready to ship.
