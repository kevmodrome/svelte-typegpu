# Scene authoring diagnostics

`typegpuSvelte()` and `compileTypeGpu()` check static scene markup at build time.
Warnings include a stable code, filename, source range, and code frame. They do
not change generated component code or add runtime validation to the frame loop.
Both scene-only components and canvas-owning viewports are checked, including SSR.

## Unknown primitives

`typegpu_unknown_primitive` flags names the built-in renderer does not interpret.
For example, `<boxGeomtry />` suggests `<boxGeometry />`. Existing kebab-case
aliases such as `<box-geometry />` are accepted. Svelte component names are not
primitive names and are not checked against this list.

This remains a warning, not an error: applications can intentionally use custom
nodes. Merely rendering an unknown tag does not add a geometry or behavior to the
built-in renderer. Inline `<texture>` and `<sampler>` nodes are not implemented;
use material `map` and `sampler` props instead.

## Resource placement

`typegpu_invalid_parent` flags a resource or control that its statically known
parent will ignore:

| Child | Required direct parent |
| --- | --- |
| `boxGeometry`, `planeGeometry`, `sphereGeometry`, `bufferGeometry` | `mesh` |
| `basicMaterial`, `phongMaterial`, `standardMaterial`, `shaderMaterial` | `mesh` or `model` |
| `cameraPose`, `cameraLens`, `controls` | `perspectiveCamera` |
| `pointerControls` | `controls` |
| `keyboardControls` | `controls` or `orbitControls` |

For example, `<mesh><group><boxGeometry /></group></mesh>` does not give the mesh
geometry. Put the resource directly inside the mesh. Svelte control-flow blocks
do not introduce host nodes, so conditional geometry is still a direct child:

```svelte
<script>
  let { rounded = false } = $props();
</script>

<mesh>
  {#if rounded}
    <sphereGeometry />
  {:else}
    <boxGeometry />
  {/if}
  <standardMaterial color={[0.2, 0.8, 0.5]} />
</mesh>
```

The analyzer preserves parent context through if/each/await/key/boundary blocks.
It does not guess where a component will render its children or where a snippet
will be called. Root-level resource fragments are therefore allowed. Definite
relationships inside those fragments are still checked.

Literal `<svelte:element this={'boxGeometry'} />` tags are checked. Computed tags,
their immediate children's parentage, cross-component placement, and arbitrary
primitive attributes are not validated. No warning does not prove a scene is
valid; these checks complement runtime tests and do not replace element typing.

## Build integration

Custom build tools should consume `compileTypeGpu(...).warnings` alongside its
JavaScript and CSS results. Vite reports the warnings automatically. Its inline
`typegpuSvelte({ onwarn(warning, defaultHandler) { ... } })` callback can collect,
suppress, or forward them in the same way as Svelte warnings.

The standard compiler `warningFilter` also applies. For example, an application
deliberately extending the primitive set can disable unknown-name warnings while
retaining parent checks and ordinary Svelte diagnostics:

```ts
typegpuSvelte({
  compilerOptions: {
    warningFilter: (warning) => warning.code !== 'typegpu_unknown_primitive'
  }
});
```

The same filter can be passed directly to `compileTypeGpu`. Use build-level
filtering for these warnings; `svelte-ignore` comments do not suppress them.
Locations refer to the input at the TypeGPU preprocessing step, so an earlier
preprocessor that rewrites markup can change those locations.

This repository's docs generator treats TypeGPU diagnostics as errors to keep
its published examples warning-free. Consumer builds emit warnings by default.
