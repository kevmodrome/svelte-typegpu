# Global elements in viewport components

Status: feasibility investigation, not an implemented feature.

## Scope and risk

The intended consumer API is a top-level `<svelte:window>` alongside the one
unconditional `<canvas>` in a dedicated `.typegpu.svelte` viewport. Global
keyboard events and window bindings should use Svelte's native semantics and
share the viewport's state. Scene nodes are not DOM targets. Actions and scene
CSS directives remain out of scope.

Risk: high. This crosses compiler, DOM ownership, SSR, event ordering and effect
lifetimes. Merely accepting the syntax is not evidence of correct support.

## Current program model

- `compiler/index.ts`: `prepareTypeGpuSource` requires a single canvas root,
  lowers it to `ViewportCanvas.svelte`, and compiles its children as GPU snippets.
- `adaptViewportClient` changes only the outer renderer scope to DOM. It rejects
  generated fragment anchors outside the scene snippets.
- `ViewportCanvas.svelte`: owns the native canvas and asynchronously mounts the
  scene. Attachments passed to it run on that canvas, not at parent initialization.
- The pinned Svelte compiler rejects `SvelteWindow`, `SvelteDocument` and
  `SvelteBody` during custom-renderer analysis, before our output adaptation.
- Native Svelte emits global event registration in its initialization statements,
  before child component calls. Window bindings have separate after-update
  placement and native runtime helpers.

```text
viewport source -> prepareTypeGpuSource -> custom-renderer compile
  -> adaptViewportClient -> DOM ViewportCanvas -> asynchronous GPU scene mount
```

## Proposed program shape

First establish executable evidence for the unsupported path and native ordering.
Do not change runtime or compiler output until an adapter preserves that contract.

```diff
+ src/viewport-globals.test.ts          native baseline and compatibility canaries
+ docs/viewport-global-elements-design.md
~ docs/svelte-compatibility.md          explicit current global-element limitation
```

The desired eventual path adds native global initialization to the DOM-owned
viewport component while leaving scene snippets and GPU lifecycle unchanged.
There is no new root registry, ID wiring, global animation loop or scene event.
Current canvas attributes, size bindings and the fail-closed anchor check remain.

## Contracts and invariants

- Window handlers receive native events with native `this`, `currentTarget`,
  capture, passive defaults and propagation behavior.
- Register parent global handlers before child initialization. Replacing a
  handler reads the current reactive value without resubscribing every frame.
- Listeners belong to the viewport component, survive scene switching and are
  removed on its destruction, even while GPU startup is pending or failed.
- Bindings preserve native initial reads, read-only behavior, function binding
  capture and scroll feedback suppression. Invalid syntax retains native errors.
- SSR does not access `window`; hydration installs each listener once.
- No additional RAF loop, renderer invalidation or per-frame traversal. State
  changes follow existing targeted scene updates.

No new public types or signatures in this investigation.

## Vertical slices and verification

1. Reproduce the pinned compiler rejection for global events and bindings; compile
   the same forms successfully as DOM components. Compare native initialization
   against a canvas-attachment candidate, including unmount cleanup. Commit the
   evidence before selecting an implementation.
2. Only after resolving initialization ownership, implement actual window event
   syntax end to end. Verify native event order, handler replacement, capture,
   deferred pointer listener teardown, SSR/hydration, Vite and GPU startup failure.
3. Add all native window bindings and a live example. Exercise real compiled
   motion at 60/120/144 Hz in both producer/renderer orders, exact frame delivery,
   targeted uploads, resource reuse, demand idling, manual mode and disposal.

Review after each slice. A passing native baseline is not a window-support claim.

## Risks and unresolved decisions

An attachment-only lowering is not automatically equivalent: it initializes at
the canvas, later than native parent global listeners. Registering listeners in
`onMount` has the same issue. Additional DOM helper components introduce outer
anchors that the current adapter intentionally rejects. Native special elements
also reject prop spreads, so a generic spread-only wrapper is not sufficient.

A direct native-runtime lowering could avoid new anchors, but would take on
compiler responsibilities for handler expressions, initialization placement,
bindings, diagnostics and server omission. A two-pass DOM/GPU compiler needs
proof that generated identifiers, reactive scopes and source maps remain aligned.
Prefer upstream support for explicit mixed-renderer ownership if neither option
can preserve native semantics without a parallel compiler implementation.

No dependency fork, new fallback API, migration or rollout is part of this spike.
Recovery is to retain ordinary DOM-component globals until support is verified.
Compatibility tests must fail when the pinned upstream behavior changes, prompting
re-evaluation rather than permanently hiding the missing feature.

## Investigation results

The six focused tests pass against Svelte PR commit
`17e37a51bc539cdb6a923b424e5746fc6505ba89`. Native window events and size bindings,
document events and body events compile successfully; the same sources fail with
`incompatible_with_custom_renderer` when a renderer is selected. Adding a canvas
also encounters our one-root validation, so relaxing that check alone cannot help.

In the runtime comparison, a child dispatches Escape during its initialization.
The native parent `<svelte:window>` receives it; the canvas-attachment candidate
misses it. Both receive later events and clean up on unmount. This rules out the
attachment-only design without changing native initialization semantics.

Window support remains gated, not replaced by a new renderer-specific helper API.
No production behavior or scheduling was changed by this investigation.
