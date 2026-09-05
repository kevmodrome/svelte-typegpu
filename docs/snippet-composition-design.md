# Viewport snippet composition

## Scope and risk

Allow Svelte 5 snippet declarations alongside a dedicated viewport's single
top-level canvas. Preserve parameter reactivity, component children, keyed node
identity, scoped canvas CSS, and hydration. This is a standard-risk compiler
change: no new runtime primitive, DOM/GPU mixing, or renderer scheduling policy.

## Current program model

`compiler/index.ts:prepareTypeGpuSource` requires the canvas to be the only
non-whitespace root. `compileTypeGpu` and the Vite plugin share this preparation.
Client compilation tags snippets with the custom renderer; `adaptViewportClient`
changes only the outer component's renderer scope to DOM. `ViewportCanvas.svelte`
mounts its children under the custom renderer. Server compilation instead calls
`omitViewportScene` before compiling the DOM-owned canvas host.

## Proposed program shape

```text
~ compiler/index.ts              permit declarations; omit GPU bodies on server
~ src/viewport-compiler.test.ts  dev/client/server and exported-snippet contracts
~ src/viewport.test.ts           keyed parameters, scoped CSS, real hydration
~ src/gpu-lifecycle.test.ts      parameterized children with real Tween/Spring
~ docs/declarative-canvas-guide.md  consumer examples and limitations
```

Control flow is unchanged. Preparation ignores `SnippetBlock` declarations when
counting rendered roots. CSS shell and server preparation strip the bodies of
top-level snippets, not the declarations, so module exports remain resolvable.
The client retains the original snippet source and renderer tags.

## Contracts and invariants

`prepareTypeGpuSource`, `compileTypeGpu`, and `omitViewportScene` keep their public
signatures. Exactly one unconditional canvas remains required. Scene content is
never emitted as server HTML. Svelte owns snippet evaluation and cleanup; the
renderer retains host nodes and GPU resources. The existing fail-closed client
output checks and DOM-authored snippet mismatch checks remain in force.

## Vertical slices and verification

1. Compile, hydrate, and update top-level snippets, including module exports and
   scoped CSS. Run client/server compiler tests and the actual canvas host tests.
2. Pass a parameterized snippet through a scene component's children. Exercise
   real Tween/Spring at 60/120/144 Hz, both RAF orders, demand/manual modes, exact
   instance upload ranges, resource reuse, and disposal. Add a consumer example.

## Risks and unresolved decisions

The pinned compiler might emit top-level snippets differently from nested ones;
tests must establish renderer ownership rather than assuming it. Moving snippets
inside the canvas instead was rejected because it changes lexical scope and
component-prop semantics. No migration is needed; existing scene-only components
remain unchanged. Unsupported compiler output still fails during the build.
