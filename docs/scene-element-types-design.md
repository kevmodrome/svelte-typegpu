# Scene element declarations

Status: investigation only. The declarations described below are deferred, not
published. The compatibility reproducer is committed and runs in the test suite.

## 1. Scope and risk

Give Svelte users checked attributes and contextual callback/attachment types for
the implemented scene primitives. High-risk type contract, but declaration-only:
no runtime allocation, scheduling, node ownership, or normalization changes.
Do not claim unsupported primitives, DOM behavior, or upstream compiler features.

## 2. Current program model

`primitives.ts` classifies invalidation; it is not a complete support schema.
`scene-compiler.ts`, `resources.ts`, `material-descriptors.ts`, `camera.ts`,
`legacy-camera.ts`, `lights.ts`, and `frame-tasks.ts` consume actual attributes.
The current Svelte element fallback accepts arbitrary attributes as `any`.
Attachments receive TypeGpuNode at runtime, not HTMLElement.

## 3. Proposed program shape

```text
+ src/elements.d.ts -> TypeGpuElements map and reusable attribute interfaces
~ package.json -> types-only svelte-typegpu/elements export
~ type-tests -> valid scenes, invalid attributes, DOM isolation, attachment/action targets
~ src/svelte-types.test.ts -> reuse structured checker results for scene fixtures
+ docs/scene-elements-guide.md -> activation and supported primitive inventory
```

Opt in using `import type {} from 'svelte-typegpu/elements'` in an application
declaration file. Augment SvelteHTMLElements for only our concrete names; add a
specific svelteHTML.mapElementTag overload for renderer-safe actions. Do not
augment HTMLElementTagNameMap: doing so would incorrectly change document APIs.
Do not automatically load the augmentation from the main renderer entry point.

## 4. Contracts and invariants

TypeGpuElements maps canonical names and the aliases actually normalized today.
Shared node attributes include visibility and symbol-keyed TypeGpuAttachment
values. Mesh/model pointer callbacks use TypeGpuNodeEvent; no DOM methods are
invented. Controls expose camerachange; frameTask update uses TypeGpuFrameCallback.
Transform, material, geometry and camera attributes follow their existing
normalizers. Required inputs describe meaningful use (e.g. buffer vertices/bounds,
shader fragment, frame task update), while defaults stay optional.

## 5. Vertical slices and verification

1. Prove module augmentation with mesh transforms, event inference, attachments,
   actions, and DOM elements in the same checker project. Reject wrong tuples,
   DOM-only event/attachment methods, typos, and unsupported material fields.
2. Cover implemented scene/group/model, cameras/controls, geometry/material,
   lights, shaderPass and frameTask names. Include all existing aliases and
   composed/snippet/await scene patterns. Keep runtime test and frame matrix green.
3. Document activation, unknown-tag limitations and unsupported standalone
   resource nodes; verify package export, full tests and builds. Commit separately.

## 6. Risks and alternatives

Svelte's fallback still accepts unknown tag names; this change checks attributes
of known names, not the entire scene grammar. Replacing the project-wide typings
namespace could reject unknown tags, but would also interfere with ordinary DOM
components and other libraries. The narrow opt-in augmentation is reversible by
removing its import and adds no runtime module. mapElementTag is an internal
language-tools hook and must be guarded by positive and negative action tests.
No CSS transition or host binding support is implied by declarations. Standalone
texture/sampler nodes and material-object props are not consumed by today's
scene compiler and are intentionally not advertised as supported elements.

## Investigation results

With the pinned preview compiler and svelte-check 4.7.6, a configured
`experimental.customRenderer` correctly suppresses DOM compiler warnings, but
the language-tools TS transformation still rewrites `clearColor` to `clearcolor`.
The actual compiler preserves `clearColor`. Adding lowercase aliases to our
declarations would hide genuinely broken user code because runtime attribute
names are case-sensitive. `namespace: 'foreign'` preserves casing in the type
transformer but is rejected by the current Svelte compiler, so it is not a valid
application configuration.

A generic `svelteHTML.mapElementTag` overload also loses to the existing fallback:
`use:domAction` accepts an HTMLElement-only action on a GPU mesh. Symbol-keyed
attachments do infer TypeGpuNode correctly and reject DOM methods. Do not
advertise full renderer-safe action typing based on that generic overload.

Reproduce the two expected diagnostics with:

```sh
pnpm --filter svelte-typegpu exec svelte-check \
  --workspace type-tests/renderer-compat --tsconfig tsconfig.json
```

The first error demonstrates incorrect casing; the second proves attachment
targets are not `any`. The unsafe action on line 6 currently has no diagnostic.
`svelte-types.test.ts` asserts these exact compatibility boundaries and separately
compiles the fixture with the actual custom renderer. Revisit declarations when
language-tools preserves custom-renderer casing, without changing runtime names
or relaxing attribute types. No public element export or augmentation is added.
