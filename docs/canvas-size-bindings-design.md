# Native canvas size bindings

## Scope and risk

Support Svelte's eight read-only element/ResizeObserver size bindings on the
native `<canvas>` in dedicated viewports. Support assignable expressions and
`{null, setter}` function bindings. Actions are not part of the supported API;
attachments remain the behavior primitive. No layout polling, new renderer loop,
drawing-buffer bindings, or scene-node dimension bindings.

Risk: high at the compiler/runtime boundary. The native element must remain the
measurement source; binding effects must survive scene switches and clean up on
viewport removal. Svelte's pinned compiler/runtime remain the compatibility gate.

## Current program model

`compiler/index.ts:prepareTypeGpuSource` lowers the sole canvas to
`ViewportCanvas.svelte`, forwarding native attributes and attachments but
rejecting all bindings except `this`. The host owns the DOM canvas and a separate
scene mount. `adaptViewportClient` retains DOM ownership of the outer component.
The renderer independently owns drawing-buffer dimensions and GPU invalidation.

```text
compileTypeGpu -> prepareTypeGpuSource -> compile -> adaptViewportClient
  -> ViewportCanvas -> native canvas + startCanvasScene -> scene/GPU root
```

## Proposed program shape

Lower size bindings to internal canvas attachments that invoke the pinned
Svelte `bind_element_size`/`bind_resize_observer` helpers. Validate the original
native canvas shell with Svelte before lowering (reuse the existing CSS shell).
This preserves native binding diagnostics, including read-only function getters.

```diff
~ packages/svelte-typegpu/compiler/index.ts
+ packages/svelte-typegpu/src/canvas-bindings.ts
~ packages/svelte-typegpu/package.json (private compiler import)
~ packages/svelte-typegpu/src/viewport-test-utils.ts (generated import resolution)
+ packages/svelte-typegpu/src/viewport-bindings.test.ts
~ packages/svelte-typegpu/src/viewport-compiler.test.ts
~ packages/svelte-typegpu/src/viewport.test.ts
~ packages/svelte-typegpu/src/gpu-lifecycle.test.ts
~ apps/example/src/test-fixtures/Viewport.typegpu.svelte
~ apps/docs/src/examples/native-events/NativeEvents.typegpu.svelte
~ docs/declarative-canvas-guide.md
```

```text
+ native binding validation -> generated attachment
    -> untracked helper setup on HTMLCanvasElement
    -> Svelte shared ResizeObserver -> consumer setter -> ordinary reactivity
    -> attachment effect teardown -> unobserve after last listener
```

## Contracts and invariants

- Element size keys: clientWidth/clientHeight/offsetWidth/offsetHeight, `number`.
- Observer keys: contentRect/contentBoxSize/borderBoxSize/devicePixelContentBoxSize,
  values as supplied by ResizeObserverEntry, with native observation box options.
- Internal `bind_element_size(canvas, key, setter)` and
  `bind_resize_observer(canvas, key, setter)` only delegate to Svelte. A typed
  facade avoids forbidden internal imports in generated component source.
- Setup is untracked, including evaluation of function-binding setters. Normal
  assignments retain Svelte reactivity; setter reads must not resubscribe.
- No binding means no imported helper and no size observation. Bindings share
  Svelte's observers, never create per-frame observers or read layout in RAF.
- SSR never measures or calls setters; hydration retains the server canvas.
- DOM binding effects belong to viewport lifetime, not scene lifetime. Errors
  propagate through ordinary Svelte attachment/effect behavior.

## Vertical slices and verification

1. Native binding lowering and compiled runtime parity with ordinary DOM Svelte:
   initial values, reactive member targets, function setters, shared observers,
   multiple viewports, resize updates, scoped CSS, invalid expressions and
   generated-name collisions. Check teardown and delayed observer delivery.
2. SSR/hydration and GPU integration: no server measurements, retained canvas,
   60/120/144 Hz with real Tween/Spring in both callback orders, demand settling,
   manual no renderer RAF, exact targeted uploads and resource reuse. Native
   resize assignments must not resubscribe observers during animation.
3. Vite client/SSR fixture and a live responsive example; verify resizing changes
   bound values without remounting. Full tests, typecheck/build, browser errors.

## Risks and alternatives

Unconditionally binding all dimensions in ViewportCanvas would add observers to
every viewport and component-binding state even when unused. A home-grown
ResizeObserver helper would duplicate Svelte scheduling/cleanup semantics.
Compiler postprocessing of individual emitted binding calls would couple to more
generated output than the small source lowering and typed runtime facade.

This is additive, requiring no migration. Roll back the binding branch/export
if the pinned runtime changes incompatibly; compiler/runtime parity tests are
the upgrade gate. Original-source editor typing remains an existing limitation.
Do not claim physical monitor cadence from synthetic clock results.

## Verification outcome

- All eight bindings match ordinary compiled Svelte for initial measurements,
  resize delivery, function capture, target replacement and observer cleanup.
- Compiled viewport hydration preserves the server canvas and never measures on
  SSR. Real Tween/Spring tests cover 60/120/144 Hz in both RAF callback orders.
- A resize-driven mesh update uploads one 96-byte instance range, with no buffer,
  bind-group or pipeline recreation. Demand settles after the existing bounded
  follow-up when scene and native resize invalidations coincide; manual mode
  renders only when explicitly requested. Observer subscriptions stay constant.
- Namespace destructuring retained all Svelte helpers in Bun. Static member
  exports reduced an isolated minified binding entry from 113 KB to 44 KB; a
  docs-bundler regression test now checks unused helpers and a size ceiling.
- `pnpm test`: 750 tests pass. `pnpm build` and `check:svelte` pass (zero Svelte
  errors/warnings). Vite client/SSR fixtures include both binding forms.
- Live Native Events: bound CSS size changed from 954x596 to 345x215, the drawing
  buffer settled to the new size, clicked selection and canvas focus survived,
  all three meshes remained visible, and demand returned to Idle. No browser
  warnings/errors. Physical 120/144 Hz and GPU throughput were not measured here.
