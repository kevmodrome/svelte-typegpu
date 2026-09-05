# Scene authoring diagnostics

## Scope and risk

Add build-time warnings for unknown static primitive names and definitely invalid
resource/control nesting. Keep runtime behavior and generated JavaScript unchanged.
No actions, canvas styling directives, runtime tree scans, or claim of complete
primitive typing. Dynamic tags and cross-component/snippet placement remain
runtime concerns.

Risk: standard. Diagnostics change the build experience but do not reject valid
programs. Warnings must not mistake reusable fragments for misplaced resources.

## Current program model

`core.ts:createElement` normalizes aliases and accepts unknown tags. The scene
compiler walks them but only interprets implemented names. `readMeshGeometry`,
`readMeshMaterial`, `readModelMaterial`, and camera/control readers search direct
children. Thus `<mesh><group><boxGeometry /></group></mesh>` silently draws no box.
Components and Svelte control-flow blocks do not themselves create host parents.

```text
compileTypeGpu -> prepareTypeGpuSource(parse + viewport lowering) -> Svelte
typegpuSvelte -> markup preprocessor -> Svelte plugin -> viewport adapter
docs generator -> compileTypeGpu -> generated scene JavaScript
```

## Proposed program shape

```diff
+ compiler/diagnostics.ts
~ compiler/index.ts (warnings from the existing parsed AST, Warning-compatible results)
~ compiler/vite.ts (route warnings through onwarn/default Vite logger)
+ src/scene-diagnostics.test.ts
+ apps/example/src/test-fixtures/InvalidScene.typegpu.svelte
~ apps/example/src/viewport-build.test.ts (real Vite warning delivery/filter tests)
~ apps/docs/scripts/compile-typegpu-scenes.ts (fail on accidental example warnings)
+ docs/scene-diagnostics-guide.md
~ docs/svelte-compatibility.md
```

```text
parse -> analyze static scene markup -> warning(code, filename, range, frame)
  -> compileTypeGpu.warnings / Vite onwarn -> build diagnostics
  -> no emitted validation code, no runtime imports
```

## Contracts and invariants

- `PreparedTypeGpuSource.warnings: Warning[]`; `compileTypeGpu` combines these
  with Svelte warnings and respects `warningFilter`.
- `typegpu_unknown_primitive`: canonical built-ins plus existing aliases; give
  a close spelling suggestion when useful. Unknown custom primitives still
  compile and can be filtered via existing warning callbacks.
- `typegpu_invalid_parent`: geometry under mesh; materials under mesh/model;
  cameraPose/cameraLens/controls under perspectiveCamera; pointerControls under
  controls; keyboardControls under controls/orbitControls. Only warn when both
  child and nearest host parent are statically known.
- Component children and snippet definitions start with unknown parent context.
  If/each/await/key/boundary blocks preserve context; static svelte:element tags
  participate, dynamic ones clear context. Root resource fragments remain valid.
- Canvas attributes are native and excluded. Texture/sampler resource nodes are
  not advertised as implemented merely because invalidation recognizes them.
- Locations refer to source supplied to the compiler/preprocessor, never lowered
  internal host offsets. Error/warning formatting is build-time only.
- Runtime mounting, resource ownership, dirty masks and scheduling are untouched.

## Vertical slices and verification

1. Static analysis: exact code/location/frame and spelling suggestions; valid
   aliases, component/snippet composition, control flow, dynamic/static tags;
   warning filtering; emitted JavaScript identical with warnings enabled/filtered.
2. Build delivery: Vite client and SSR builds surface the same original-source
   warning once; inline onwarn can handle/suppress it. All docs examples must
   compile without these warnings. Full tests include the existing 60/120/144 Hz
   frame/upload/lifecycle matrix; builds and Svelte checks remain green.

## Risks and alternatives

Runtime validation could catch computed tags and cross-component placement but
would add mutation-path work and need deduplicated diagnostic ownership. Hard
errors for unknown names would break custom nodes; warnings preserve that path.
Full attribute typing is still blocked by the documented language-tools casing
issue and is not replaced by these focused diagnostics.

Catalog entries must follow actual scene readers, not the broader invalidation
table. Future primitive changes should update diagnostics and the reader tests
together. Vite warnings use the preprocessed source if earlier preprocessors
rewrite it. Rollback removes analysis/transport only; rendering output is unchanged.
