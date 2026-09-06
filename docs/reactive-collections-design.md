# Reactive scene collections

## 1. Scope and risk

Make SvelteMap-owned objects and SvelteSet-owned selection a tested, discoverable
consumer pattern. Standard risk: new composition/performance coverage and a docs
example, without new renderer APIs, dependencies, async flags, or ownership rules.
Use existing primitives and ordinary keyed each blocks. Actions and scene CSS stay
out of scope; the separate async patch decision remains open.

## 2. Current program model

The renderer already supports keyed each blocks, deep small-value attributes,
shared stores, native canvas hosting and direct scene events. `store-components`
tests check targeted scene updates; `gpu-lifecycle` owns controlled clocks and GPU
resource/upload recorders. There is no coverage or example for svelte/reactivity
collections. The docs example registry and generator support an ordinary DOM
component importing a dedicated viewport, as in Shared Stores.

```text
SvelteMap.keys -> keyed each -> SvelteMap.get(key) -> mesh props
SvelteSet.has(key) -> material props
scene/DOM event -> collection mutation -> Svelte effect -> targeted renderer dirty path
```

## 3. Proposed program shape

```text
+ packages/svelte-typegpu/src/reactive-collections.test.ts: compiled composition contract
~ packages/svelte-typegpu/vitest.config.ts: browser reactivity exports for component tests
~ packages/svelte-typegpu/src/gpu-lifecycle.test.ts: collection cadence and example controls
+ apps/docs/src/examples/reactive-collections/ReactiveCollections.svelte: per-instance state/editor
+ apps/docs/src/examples/reactive-collections/CollectionViewport.typegpu.svelte: native canvas/scene
+ apps/docs/src/examples/reactive-collections/collection.ts: bounded object creation/edit commands
+ apps/docs/src/examples/reactive-collections/collection.test.ts: command bounds and per-instance ownership
~ docs registry/source listing/preview/styles: existing dedicated-viewport integration
~ docs/svelte-compatibility.md: collection semantics and example link
```

Iterate keys, then read each value inside its keyed scope. This preserves keyed
identity while allowing existing-key edits and selection reads to remain local.
Keep the renderer unchanged unless a failing behavioral test proves a real gap.
Compare this with rebuilding arrays of every object on each edit: that remains
valid Svelte, but is not needed to demonstrate per-key collection subscriptions.

## 4. Contracts and invariants

Collections belong to the consumer component, never global server state. SvelteMap
does not deep-proxy its values: use immutable `set` updates or explicitly `$state`
objects for nested mutation. Selection is independent state; consumer remove/reset
commands update both collections. No renderer-owned IDs or cross-component lookup
registry is introduced. Each keys are ordinary user data.

Existing-key edits retain nodes/attachments and scene instance storage. Set no-ops
must not dirty the scene. Removed/replaced collections must stop affecting mounted
nodes. Structural insert/delete/clear may rebuild batches but should retain shared
resources where ownership remains. Disposal cancels renderer work and attachments.

## 5. Vertical slices and verification

1. Complete: compiled direct/component scene cases: map edits, set selection, no-ops, keyed
   add/delete/clear, collection replacement, deep-state values and cleanup. Assert
   exact affected instance ranges and stable unaffected nodes/storage.
2. Complete: real Tween/Spring updates through map values at 60/120/144 Hz in both RAF orders,
   demand/manual modes. Assert frame delivery, exact writes, resource reuse and
   settled/disposed cancellation. Commit this contract before the example.
3. Complete, including software-WebGPU checks: bounded interactive editor using the actual collections and viewport.
   Test generated consumer controls, native/scene selection, remove/reset and GPU
   updates. Generate/build docs, check desktop/mobile layout and live scene pixels
   where the machine permits; report unavailable live GPU checks explicitly.

Contract verification: four composition tests and 18 cadence cases pass, plus two
generated-example GPU lifecycle cases and four consumer command cases. The
workspace passes 1,204 tests; the renderer passes 1,109 in both development and
production, and the full workspace build passes. The isolated async candidate regression passes
1,255 development and 1,235 production tests. The test harness explicitly selects
Svelte's browser collection exports; server exports are plain Map/Set. No renderer
implementation or installed Svelte dependency changed for these contracts.

Headless browser checks pass at 1440x1000 and 390x844: decimal height input,
checkbox selection, add/remove/reset, bounded scrolling, no text/page overflow or
canvas/editor overlap, and no page errors. The loading status is confined to the
canvas after an actual pointer-interception failure exposed it covering the editor.
Screenshots were inspected at both sizes. The initial runs remained pending in native
`GPUAdapter.requestDevice`; they do not prove scene pixels, camera framing, GPU
throughput or physical display cadence. A subsequent isolated CSS probe found the
docs' infinite full-screen background animation delaying device startup. Removing
that animation allowed real SwiftShader WebGPU checks with normal motion preferences
at both sizes: 18,096/8,649 colored canvas pixels and 182/174 changed pixels after
selection, no page errors, and no canvas/editor or text overlap. Screenshots were
inspected for framing. See [preview performance](preview-performance.md) for the
before/after evidence and its limits. Physical high-refresh and hardware GPU
throughput checks remain separate; the Mac was locked during native browser access.

## 6. Risks and unresolved decisions

Plain nested values are not automatically reactive and must not be presented as
such. Avoid subscribing every mesh to whole-collection contents when a per-key
lookup suffices. Collection edits are user actions, not a new animation loop.
There is no public API migration or rollback state. A renderer defect, if found,
needs its own scoped implementation and performance review before adding a shim.
