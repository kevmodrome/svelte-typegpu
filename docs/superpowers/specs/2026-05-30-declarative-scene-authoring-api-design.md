# Declarative Scene Authoring API Design

## Goal

Make `svelte-typegpu` feel like Svelte for TypeGPU scenes: authors describe objects,
relationships, and state; the renderer decides resource reuse, draw batching,
instancing, buffer packing, and GPU cache lifetime.

The public API should no longer require users to define reusable renderer resources
up front or choose between normal meshes and instanced meshes. Those are internal
optimization concerns.

## Problem

The current API exposes renderer internals as authoring concepts:

```svelte
<resources>
  <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>
  <standardMaterial id="warm" color={[0.94, 0.9, 0.82, 1]}></standardMaterial>
</resources>

<mesh geometry="box" material="warm" position={[0, 1, 0]}></mesh>
```

This works, but it teaches users to think in registries, IDs, and manual reuse.
That is not the main value of a Svelte custom renderer. The user should be able to
write a scene that looks like the scene itself.

The API also exposes `instancedMesh` as a user-authored primitive even though
ordinary repeated meshes can be grouped into instanced draw batches after Svelte
has rendered the component tree.

## Recommended Approach

Use inline composition as the only primary authoring model.

```svelte
<scene clearColor={[0.02, 0.02, 0.025, 1]}>
  <perspectiveCamera position={[4, 3, 6]} target={[0, 0, 0]} fov={45}></perspectiveCamera>

  {#each cubes as cube (cube.id)}
    <mesh position={cube.position} rotation={cube.rotation} scale={cube.scale}>
      <boxGeometry width={1} height={1} depth={1}></boxGeometry>
      <standardMaterial color={cube.color}></standardMaterial>
    </mesh>
  {/each}
</scene>
```

The renderer walks the resolved TypeGPU node tree, turns every drawable into a
draw item, derives canonical resource keys, and groups compatible draw items into
instanced draw batches.

## Public API Shape

### Scene

`<scene>` owns render settings and scene children.

Keep:

- `clearColor`
- `background` as an alias if already supported
- `depth`
- `alphaMode`
- `activeCamera`

Remove from the core public API:

- `scale`
- `animationSpeed`
- `colorShift`

Those are demo-specific shader uniforms. Users should animate ordinary Svelte
state such as transforms or material values.

### Mesh

`<mesh>` describes one drawable object.

```svelte
<mesh position={[0, 1, 0]} rotation={[0, angle, 0]} scale={[1, 1, 1]}>
  <boxGeometry></boxGeometry>
  <standardMaterial color={color}></standardMaterial>
</mesh>
```

Keep:

- transform props: `position`, `rotation`, `quaternion`, `scale`, `matrix`
- visibility and ordering: `visible`, `renderOrder`
- interaction props/listeners: pointer events, drag events, ARIA attributes
- shadow flags: `castShadow`, `receiveShadow`

Remove from the core public API:

- `geometry="id"`
- `material="id"`
- `color`
- `phase`
- `spinSpeed`

Mesh color belongs on material. Animation belongs in Svelte state or future
general animation helpers.

### Geometry

Geometry nodes describe the parent mesh shape. They do not define reusable public
resources.

```svelte
<mesh>
  <sphereGeometry radius={0.7} widthSegments={32} heightSegments={16}></sphereGeometry>
  <standardMaterial color={[0.2, 0.9, 0.7, 1]}></standardMaterial>
</mesh>
```

Supported inline geometry nodes:

- `boxGeometry`
- `planeGeometry`
- `sphereGeometry`
- `bufferGeometry`

`bufferGeometry` may accept an optional `key` prop as a cache identity hint:

```svelte
<bufferGeometry key="terrain:v4" vertices={vertices} indices={indices} bounds={bounds}></bufferGeometry>
```

This `key` is not a public resource ID. It says "this expensive geometry should
keep the same GPU identity while the semantic resource is unchanged." If `key` is
omitted, the renderer can use object identity for large arrays and content-derived
keys only where cheap enough.

Remove public `layoutKey` from the normal authoring path. The renderer owns the
supported vertex layout contract.

### Materials

Material nodes describe the parent mesh surface.

```svelte
<mesh>
  <boxGeometry></boxGeometry>
  <phongMaterial
    color={[1, 1, 1, 1]}
    map="/textures/checker.svg"
    sampler={{ addressModeU: 'repeat', addressModeV: 'repeat' }}
  ></phongMaterial>
</mesh>
```

Supported material nodes:

- `basicMaterial`
- `phongMaterial`
- `standardMaterial`

Textures and samplers should be material inputs, not top-level named resources.
The preferred syntax is value-based props:

```svelte
<standardMaterial
  map="/textures/wood.png"
  sampler={{ minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' }}
></standardMaterial>
```

Optional child syntax can be added if it proves clearer:

```svelte
<standardMaterial>
  <texture src="/textures/wood.png"></texture>
  <sampler addressModeU="repeat" addressModeV="repeat"></sampler>
</standardMaterial>
```

Top-level `<texture id="...">` and `<sampler id="...">` should not be part of the
primary public API.

### Models

`<model>` is a drawable scene object, not a resource declaration.

```svelte
<model src="/assets/teapot.obj" position={[0, 0, 0]} castShadow receiveShadow>
  <phongMaterial color={[0.8, 0.7, 0.6, 1]}></phongMaterial>
</model>
```

The renderer keys loaded model data by `src` or by an optional identity key for
embedded data. Material children are overrides for the model meshes.

### Reusable Components

Svelte components are the primary reuse mechanism.

```svelte
<!-- Cube.typegpu.svelte -->
<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  let {
    position,
    color
  }: {
    position: Vector3Tuple;
    color: RgbaTuple;
  } = $props();
</script>

<mesh {position}>
  <boxGeometry></boxGeometry>
  <standardMaterial {color}></standardMaterial>
</mesh>
```

Consumers write normal Svelte:

```svelte
{#each cubes as cube (cube.id)}
  <Cube position={cube.position} color={cube.color}></Cube>
{/each}
```

Components are transparent to batching. The batching boundary is the resolved
mesh draw item, not the component boundary.

## Automatic Resource Identity

Every inline resource descriptor should produce a canonical internal key.

Examples:

- `<boxGeometry width={1} height={1} depth={1}>` -> `box:1:1:1`
- `<sphereGeometry radius={0.5} widthSegments={16} heightSegments={8}>` -> `sphere:0.5:16:8`
- `map="/textures/wood.png"` -> `url:/textures/wood.png`
- sampler descriptor -> canonical sampler descriptor key
- `<model src="/teapot.obj">` -> `model:url:/teapot.obj`
- material descriptor -> material/pipeline/bind-group keys derived from shading-relevant props

Equivalent descriptors must reuse GPU resources automatically. Users should not
need public IDs to get reuse.

For large buffers, avoid expensive content hashing as the default. Use this order:

1. Explicit `key` when provided.
2. Stable object identity for array/data objects.
3. Content-derived key only for small or explicitly hashable data.

## Automatic Batching And Instancing

The renderer should automatically group compatible mesh draw items into instanced
draw batches.

This source:

```svelte
{#each cubes as cube (cube.id)}
  <mesh position={cube.position}>
    <boxGeometry></boxGeometry>
    <standardMaterial color={cube.color}></standardMaterial>
  </mesh>
{/each}
```

and this source:

```svelte
{#each cubes as cube (cube.id)}
  <Cube cube={cube}></Cube>
{/each}
```

should produce the same kind of renderer work after component composition:

```ts
{
  geometryKey: 'box:1:1:1',
  pipelineKey: 'material:standard|blend:opaque|depthWrite:true|depthTest:true|cull:back',
  bindGroupKey: 'solid:white|sampler:default',
  instances: [
    { position, rotation, scale, color },
    { position, rotation, scale, color }
  ]
}
```

Batching should happen after the Svelte custom renderer has produced the TypeGPU
node tree. The compiler does not need to know whether meshes came from direct
markup, an `{#each}` loop, a component, or a nested component tree.

Compatible draw items share a batch when they have the same:

- render pass
- pipeline key
- bind group key
- geometry key
- render order
- shadow pass compatibility

Per-object values go into instance data when possible:

- transform
- color/material scalar values that do not alter pipeline or bind group layout
- object id for interaction
- shadow receive flags where supported by the instance layout

If meshes differ in pipeline or bind group compatibility, they naturally split
into separate batches.

## Removed Public Concepts

Remove these from the primary public API:

- `<resources>`
- `geometry="id"`
- `material="id"`
- top-level named `<texture id="...">`
- top-level named `<sampler id="...">`
- user-authored `<instancedMesh>`
- public `layoutKey`
- demo-specific `<scene animationSpeed colorShift scale>`
- demo-specific `<mesh phase spinSpeed color>`

The renderer may keep internal caches, resource records, draw batches, and
instanced drawing. Those should not shape ordinary scene authoring.

## Transitional Compatibility

This is a hard cleanup, but implementation can still be staged safely:

1. Add tests that assert inline component composition batches automatically.
2. Migrate examples and docs to inline composition.
3. Remove or fail tests that require `<resources>`, `geometry="id"`, `material="id"`, and public `instancedMesh`.
4. Remove public registry parsing after examples no longer depend on it.
5. Keep internal resource caches and draw batch caches.

If backward compatibility is needed for one release, old primitives can emit
development warnings. The final target API should not document them.

## Error Handling

Invalid composition should be non-fatal:

- A mesh with no geometry is skipped.
- A mesh with no material uses a default white `standardMaterial`.
- Geometry outside a mesh is ignored.
- Material outside a mesh or model is ignored.
- Multiple geometry children: first supported geometry wins.
- Multiple material children: first supported material wins.
- Unknown nodes remain inert scene graph nodes unless registered as primitives.

## Testing

Add or update tests for:

- Inline mesh geometry/material compilation.
- Equivalent inline geometries sharing `geometryKey`.
- Equivalent inline texture and sampler descriptors sharing resource keys.
- `{#each}` direct meshes batching into one draw batch.
- `{#each}` component meshes batching into one draw batch.
- Nested component meshes batching across component boundaries.
- Different geometry descriptors splitting into separate batches.
- Different pipeline-affecting material props splitting into separate batches.
- Large `bufferGeometry` honoring explicit `key`.
- `layoutKey`, `<resources>`, `geometry="id"`, `material="id"`, and public `instancedMesh` no longer appearing in docs examples.
- Demo-specific scene and mesh animation props removed from public examples.

## Non-Goals

This design does not include:

- A general animation system.
- Custom user-defined vertex layouts.
- Manual GPU resource registry authoring.
- Manual draw batch or instancing controls as the primary API.
- A full shader graph.
- GPU picking beyond the existing interaction model.

## Open Decisions

1. Whether to support child `<texture>` and `<sampler>` syntax under materials, or only value-based `map` and `sampler` props.
2. Whether to reserve a mesh-level `key` prop for dirty-range stability if keyed `{#each}` does not preserve enough identity in practice.
3. Whether fullscreen shader passes should remain `<shaderPass>` directly under `<scene>` or move under a clearer render-stage primitive such as `<postProcess>`.
