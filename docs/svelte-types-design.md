# Svelte consumer type checking

## 1. Scope and risk

Verify the public Canvas API in consumer `.svelte` files, including inferred
scene props, callbacks, and root binding. Standard risk: new test tooling and
possible type-only API corrections, with no scheduling or GPU behavior changes.
Primitive attribute completion is a separate follow-up, not claimed here.

## 2. Current program model

`src/Canvas.svelte` and `SceneHost.svelte` use generic Svelte component props.
The package build runs plain `tsc` with only `src/**/*.ts` included. Vitest
compiles components for runtime tests but does not typecheck their consumers.

```text
CI -> pnpm test -> Vitest (runtime)
   -> pnpm build -> tsc (TypeScript only)
```

## 3. Proposed program shape

Add [Svelte's official checker](https://github.com/sveltejs/language-tools/tree/master/packages/svelte-check)
as a development-only dependency. Run it from a
focused Vitest suite against a fixture project importing public package exports.
Check valid and invalid usage independently so expected diagnostics cannot hide
new errors in supported usage. Keep fixtures outside the published `src` tree.

```text
~ package.json / pnpm-lock.yaml (svelte-check dev dependency)
+ type-tests/ (consumer components and scoped tsconfigs)
+ src/canvas-types.test.ts (CLI diagnostics assertions)
~ src/Canvas.svelte / SceneHost.svelte (only corrections proved necessary)
CI -> pnpm test -> svelte-check -> JSON diagnostics -> assertions
```

## 4. Contracts and invariants

Resolve `svelte-typegpu/canvas` through its real package export. No wildcard
component declarations or `any` casts in consumer fixtures. Scene component props
are the source of truth, including required, optional, and callback props. Root
binding exposes `TypeGpuRoot | null`. Callback arguments are contextual types,
not implicit `any`. Owned target/canvas/onFps options remain unavailable.
No runtime listeners, effects, allocation, or frame loops are added.

## 5. Vertical slices and verification

1. Install the checker and establish actual diagnostics for public components,
   a valid consumer, and expected-invalid consumers. Correct type mismatches.
2. Add diagnostic assertions for required/incorrect props, callback arguments,
   root binding, initialization-only options, and ordinary DOM host attributes.
   Run all runtime tests and builds, then commit this typecheck gate separately.

## 6. Risks and unresolved decisions

The preview compiler and released language tools may disagree. Test with the
pinned compiler and document any actual limitation rather than weakening types.
A handwritten declaration would duplicate component types and can drift; prefer
the actual `.svelte` source. Script-only scene fixtures isolate component prop
inference from the separately missing scene-element declarations. Machine-verbose
diagnostics provide structured records; assert diagnostic codes and locations,
not the checker's human output formatting.

## Investigation results

The checker found a generic mismatch in the internal imperative mount and
accepted unknown scene props by widening generic inference. Explicitly
instantiating `SceneHost<Props>` and using `NoInfer<Props>` for `sceneProps`
resolve these without runtime changes. A local Svelte config prevents the
checker from picking up the unrelated workspace Vite config. Valid consumers
produce zero diagnostics; all 12 invalid cases produce their intended errors.
All 536 workspace tests and both production builds pass, including the existing
real Tween/Spring frame-delivery and resource-reuse matrix. No new runtime work
is introduced by the generic instantiation or the `NoInfer` type annotation.
