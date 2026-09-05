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
