# TypeGPU Primitives Completion Design

## Goal

Complete the Svelte custom renderer's immediate TypeGPU primitive surface and move the internals to the architecture described in the primitives guide: Svelte owns declarative scene authoring and coarse reactivity, while the renderer compiles a scene IR and manages TypeGPU resources, batching, dirty tracking, picking, and render submission.

This branch should not treat public primitives as thin WebGPU wrappers. The public API should stay scene-level and declarative:

```svelte
<scene>
  <perspectiveCamera />
  <orbitControls />
  <group>
    <mesh>
      <boxGeometry />
      <phongMaterial />
    </mesh>
  </group>
</scene>
```

Internally, that tree should compile into render data:

```txt
host tree -> scene IR -> resource keys/caches -> render pass draw batches
```

## Current State

The renderer already supports the core shape of the scene renderer:

- A Svelte custom renderer host tree.
- `<scene>`, `<group>`, `<mesh>`, `<model>`, `<perspectiveCamera>`, camera controls, several light nodes, `<boxGeometry>`, `<sphereGeometry>`, and `<standardMaterial>`.
- GLB model loading and imported model draw batches.
- URL and embedded material textures.
- Draw-batch caching with dirty instance ranges.
- TypeGPU-managed vertex buffers, instance buffers, material bind groups, lighting uniforms, scene uniforms, and one main render pass.

The renderer is not yet aligned with the full guide in these areas:

- Dirty tracking is still split across coarse draw-batch and light booleans.
- Primitive-specific dirtiness is inferred by helper functions instead of descriptor metadata.
- `TypeGpuSceneState` does not yet include render settings, interaction data, or live resource keys.
- Click dispatch still uses the first interactive mesh instead of a hit-test index.
- Pipeline, material, texture, and sampler resources are not consistently keyed and pruned from compiled live-resource sets.
- Async texture loads are not protected by generation tokens.
- The MVP primitive set is incomplete: plane and buffer geometry, basic and phong material aliases, explicit texture and sampler resources, instanced mesh, and orthographic camera support are missing.

## Scope

Implement both the immediate internals and the immediate public primitives from the guide. The implementation may replace existing renderer internals wholesale when that produces a simpler and more coherent result. Existing modules, helper boundaries, and tests are useful reference material, not constraints.

In scope:

- Dirty bitmask and primitive descriptor registry.
- Scene compilation into camera, render settings, lights, draw batches, interaction index, and live resource keys.
- Pipeline/material/texture/sampler key separation.
- Pipeline cache and resource pruning.
- Texture generation tokens for async load races.
- Bounds-based CPU interaction picking.
- Public primitives: `scene`, `group`, `perspectiveCamera`, `orthographicCamera`, `orbitControls`, ambient/directional/point lights plus hemisphere/spot lights, `mesh`, `instancedMesh`, `boxGeometry`, `planeGeometry`, `sphereGeometry`, `bufferGeometry`, `basicMaterial`, `phongMaterial`, `standardMaterial`, `texture`, and `sampler`.
- A rebuilt demo and test suite that prove the target API and renderer behavior, even if that means deleting or rewriting older implementation files.

Out of scope for this branch:

- GPU pick IDs.
- Triangle-accurate mesh raycasting.
- Shadow maps.
- Multiple render passes beyond preparing a single-pass render-plan shape.
- Custom shader material implementation.
- Compute passes and low-level buffer/bind-group/pipeline public primitives.
- Skeletal animation, morph targets, or expanded GLB feature coverage.

Those escape hatches should be represented by boundaries and key shapes where useful, but not implemented as public behavior in this branch.

## Rebuild Strategy

The implementation should prefer a clean renderer core over incremental preservation. Keep existing code only when it fits the target architecture without contortions. Delete or replace code that bakes in obsolete assumptions such as first-interactive-mesh picking, draw-batch-only scene state, nested camera child nodes as the primary API, or material handling coupled directly to one texture path.

The end-state contract is the guide-aligned public API and renderer behavior described in this spec. Passing old tests is not a requirement. Tests should be rewritten around the new contract when old tests assert obsolete internals or compatibility paths.

## Public API

The renderer should support the guide's MVP public API using scene-level primitives:

```svelte
<scene clearColor={[0.067, 0.078, 0.102, 1]} animationSpeed={speed}>
  <perspectiveCamera
    id="main"
    active
    position={[9, 7, 13]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={100}
  />

  <orbitControls camera="main" />

  <ambientLight intensity={0.25} />
  <directionalLight position={[4, 8, 6]} intensity={1.5} />

  <mesh position={[0, 0, 0]} onclick={select}>
    <boxGeometry width={1} height={1} depth={1} />
    <phongMaterial color={[1, 0.8, 0.4, 1]} map="/textures/checker.svg" />
  </mesh>
</scene>
```

The target authored names are the guide-level scene primitives. CamelCase names are acceptable where Svelte custom-renderer ergonomics make them simpler or where they cost almost nothing to support:

- `perspectiveCamera`, `orthographicCamera`, `orbitControls`.
- `ambientLight`, `hemisphereLight`, `directionalLight`, `pointLight`, `spotLight`.
- `boxGeometry`, `planeGeometry`, `sphereGeometry`, `bufferGeometry`.
- `basicMaterial`, `phongMaterial`, `standardMaterial`.
- `instancedMesh`.

Kebab-case aliases should be supported where Svelte compilation allows them:

- `perspective-camera`, `orthographic-camera`, `orbit-controls`.
- `ambient-light`, `directional-light`, `point-light`.
- `box-geometry`, `plane-geometry`, `sphere-geometry`, `buffer-geometry`.
- `basic-material`, `phong-material`, `standard-material`.
- `instanced-mesh`.

The current demo components may be rewritten or removed. The finished demo should exercise the target renderer API directly and should remain useful for manual verification.

## Primitive Semantics

`scene` owns renderer-wide state:

- `scale`, `animationSpeed`, `colorShift`.
- `clearColor`.
- `activeCamera`.
- `background` as an alias for clear color when it is an RGBA tuple.

`group`, `mesh`, `model`, and lights are transformable:

- `position`: `[x, y, z]`, default `[0, 0, 0]`.
- `rotation`: `[x, y, z]` in radians, default `[0, 0, 0]`.
- `scale`: scalar or `[x, y, z]`, default `1`.
- `visible`: false removes descendants from draw batches and interaction.
- `renderOrder`: contributes to sort key and batch ordering.

`perspectiveCamera` uses the direct guide form. A camera node with `position`, `target`, `fov`, `near`, and `far` is the target API.

`orthographicCamera` should compile into camera state with a `projection` discriminator and `zoom`, `near`, and `far`. The GPU renderer should produce an orthographic view-projection matrix when that camera is active.

`orbitControls` should be the public camera interaction primitive. It owns camera interaction settings through its own props rather than requiring nested `controls`, `pointerControls`, or `keyboardControls` nodes. Camera interaction stays renderer-owned and must not force per-frame Svelte updates.

Lights compile into packed lighting data, not GPU resources:

- `ambientLight`.
- `hemisphereLight`.
- `directionalLight`.
- `pointLight`.
- `spotLight`.

Geometry nodes produce CPU geometry descriptors and live geometry keys:

- `boxGeometry`.
- `planeGeometry`.
- `sphereGeometry`.
- `bufferGeometry` from provided vertex data and optional bounds.

Material nodes produce material descriptors and separate material, bind-group, texture, sampler, and pipeline keys:

- `basicMaterial`: unlit-style material descriptor.
- `phongMaterial`: lit material descriptor using the renderer's lighting data.
- `standardMaterial`: PBR-inspired descriptor with the existing color, roughness, metalness, opacity, and map semantics.

`texture` and `sampler` are resource declarations. A material can reference them by id:

```svelte
<resources>
  <texture id="checker" src="/textures/checker.svg" />
  <sampler id="repeatLinear" addressModeU="repeat" addressModeV="repeat" />
  <phongMaterial id="crate" map="checker" sampler="repeatLinear" />
</resources>

<mesh geometry="cube" material="crate" />
```

`resources` is an inert grouping node for reusable resources. Resource nodes do not draw by themselves.

`instancedMesh` accepts array-shaped instance data and compiles it without creating one Svelte host node per instance:

```svelte
<instancedMesh
  geometry="cube"
  material="crate"
  instances={cubes}
  getKey={(cube) => cube.id}
  getTransform={(cube) => cube.transform}
  getColor={(cube) => cube.color}
  getSpinSpeed={(cube) => cube.spinSpeed}
/>
```

## Scene Compiler

Build a compiler that produces a full scene state:

```ts
interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  cameraNode: TypeGpuNode | null;
  cameraControllerNode: TypeGpuNode | null;
  cameraController: TypeGpuCameraController | null;
  renderSettings: TypeGpuRenderSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  lightsChanged: boolean;
  drawBatches: TypeGpuDrawBatch[];
  drawBatchesChanged: boolean;
  interaction: TypeGpuInteractionIndex;
  interactionChanged: boolean;
  liveResourceKeys: TypeGpuLiveResourceKeys;
}
```

The compiler should collect reusable resources before renderable meshes so references by `id` are deterministic. It should then walk visible scene nodes, compose transforms, compile lights, compile meshes/models/instanced meshes, create draw items, batch compatible draw items, and build an interaction index from interactive renderables.

Unknown nodes remain inert. Invalid mesh composition should not throw:

- Mesh without geometry is skipped.
- Mesh without material uses a default white material.
- Unknown resource references use defaults or skip only the affected renderable.
- Malformed `bufferGeometry` contributes no draw item.

## Dirty Tracking And Descriptors

Introduce a dirty bitmask:

```ts
export const enum Dirty {
  None = 0,
  Tree = 1 << 0,
  Transform = 1 << 1,
  InstanceData = 1 << 2,
  DrawBatches = 1 << 3,
  Geometry = 1 << 4,
  Material = 1 << 5,
  MaterialUniform = 1 << 6,
  Texture = 1 << 7,
  BindGroup = 1 << 8,
  Pipeline = 1 << 9,
  Lights = 1 << 10,
  Camera = 1 << 11,
  Interaction = 1 << 12,
  RenderSettings = 1 << 13,
  All = 0xffff_ffff
}
```

Host-tree mutation functions should schedule sync with a dirty mask:

- `setAttribute` and `removeAttribute` ask the node descriptor for `dirtyForAttribute`.
- `insert` and `remove` ask descriptors for tree-level dirty behavior.
- `addEventListener` and `removeEventListener` mark interaction dirty for pointer/click events.

Primitive descriptors should own these concerns:

- Supported aliases.
- Attribute normalization where useful.
- Dirty behavior.
- Resource and scene compilation hooks.

Runtime scheduling should use `Dirty`. The old `invalidatesDrawBatches` and `invalidatesLights` approach can be deleted instead of migrated.

## Draw Batches And Resource Keys

`TypeGpuDrawBatch` should carry explicit key components:

```ts
interface TypeGpuDrawBatch {
  key: string;
  passKey: string;
  pipelineKey: string;
  materialKey: string;
  bindGroupKey: string;
  geometryKey: string;
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  instances: Float32Array;
  instanceIds: TypeGpuInstanceId[];
  instanceCount: number;
  floatsPerInstance: number;
  dirtyRanges: TypeGpuInstanceDirtyRange[];
  instancesChanged: boolean;
  sortKey: number;
}
```

Batch compatibility should include pass, pipeline, material resource identity, geometry identity, vertex layout, instance layout, topology, blend/depth state, and render order bucket. Per-instance values such as color and transform should not split batches unless they require a different material resource or pipeline.

The first render plan can stay one hardcoded main screen pass, but the compiled data should have a `passKey` and `sortKey` so adding shadow, pick, outline, or postprocess passes later does not require rewriting batch identity.

## Resource Caches

The GPU renderer should formalize resource ownership into explicit caches:

- Geometry buffers keyed by geometry key.
- Instance buffers keyed by batch key.
- Material resources keyed by material/bind-group key.
- Texture resources keyed by texture key.
- Sampler resources keyed by sampler key.
- Pipeline resources keyed by pipeline key.
- Render target resources reserved for later render-plan work.

`scene.liveResourceKeys` should drive pruning:

```ts
interface TypeGpuLiveResourceKeys {
  geometries: Set<string>;
  materials: Set<string>;
  textures: Set<string>;
  samplers: Set<string>;
  pipelines: Set<string>;
}
```

Pruning rules:

- Removed draw batches destroy instance buffers.
- Unused geometry resources destroy vertex buffers.
- Unused material resources release bind groups and texture references.
- Unused texture resources destroy owned textures.
- Unused sampler resources can be removed from the sampler map.
- Unused pipelines can be removed from the pipeline map.

Async texture loading must use generation tokens. If a material changes from one texture to another while the first image is still decoding, the stale load must close its decoded image and must not overwrite the newer resource state.

## Interaction

Replace first-interactive-mesh click routing with a compiled CPU interaction index:

```ts
interface TypeGpuInteractionTarget {
  node: TypeGpuNode;
  instanceId: TypeGpuInstanceId;
  bounds: TypeGpuBounds;
  worldTransform: TypeGpuTransform;
  hitTest: 'none' | 'bounds' | 'mesh';
  handlers: Set<string>;
}
```

For this branch, `hitTest="bounds"` is the supported hit-test mode. `hitTest="mesh"` should degrade to bounds until triangle raycasting is implemented. `pointerEvents="none"` removes a target from the interaction index.

Canvas event dispatch should:

- Ignore a click suppressed by camera dragging.
- Convert canvas event coordinates to normalized device coordinates.
- Build a ray from the active camera and viewport.
- Pick the nearest bounds hit.
- Dispatch to the hit node with `originalEvent`, `instanceId`, and point data when available.

Pointer movement should reuse the same index to dispatch `pointerenter` and `pointerleave` when the hovered target changes.

## Rendering

The GPU renderer should use TypeGPU-backed resources and render submission, but it may be rebuilt around clearer ownership boundaries:

- `setScene` receives scene IR and updates only dirty resource classes.
- Pipeline lookup goes through a pipeline cache keyed by `batch.pipelineKey`.
- Material lookup goes through material/texture/sampler caches keyed by compiled resource keys.
- The render loop draws batches ordered by `sortKey`.
- The main pass reads `scene.renderSettings.clearColor`.

Root creation should accept the guide's root settings:

- `frameloop`.
- `maxDevicePixelRatio`.
- `clearColor`.
- `depth`.
- `alphaMode`.

`frameloop: 'always'` preserves the current behavior. `frameloop: 'demand'` renders after scene sync, camera interaction, resize, texture/model settlement, or an explicit `root.invalidate()`. `frameloop: 'manual'` renders only when `root.renderFrame()` is called; scene sync still updates CPU and GPU resources without scheduling an animation loop.

## Testing

Use TDD for implementation. Each subsystem should get failing tests before production changes.

Required test coverage:

- Descriptor dirty masks for scene, transform, camera, lights, geometry, material, texture, sampler, interaction listeners, insert, and remove.
- Runtime scheduling passes dirty masks into scene compilation and reuses clean draw batches, lights, and interaction indexes.
- Scene compiler emits render settings, draw-batch changed flags, live resource keys, and interaction index.
- Direct camera props compile into camera state.
- Orthographic camera state is preserved.
- Plane geometry and buffer geometry compile into geometry data and bounds.
- Basic, phong, and standard material descriptors normalize color, opacity, map, sampler, and pipeline-relevant fields.
- Explicit texture and sampler resources can be referenced by material id.
- Texture resource generation tokens prevent stale async loads from overwriting newer textures.
- Removed material/texture/sampler/pipeline keys are pruned.
- Bounds-based click picking dispatches the nearest interactive mesh, not the first interactive mesh.
- `pointerEvents="none"` and `hitTest="none"` remove targets from picking.
- `instancedMesh` compiles many instances into one draw batch with stable instance ids and dirty ranges.
- GLB model import, material override, camera controls, lighting, and renderer behavior are covered by target-behavior tests. Older tests may be rewritten or removed when they assert obsolete internal details.
- Component-renderer tests cover new primitive aliases where Svelte accepts the tag names.

Manual verification should include running the demo and confirming:

- The rebuilt demo renders procedural meshes and at least one GLB model.
- Texture changes do not leak visible stale resources.
- Clicking a visible object selects the object under the cursor rather than always the first interactive mesh.

## Migration Strategy

Implement in this order:

1. Establish the new renderer module boundaries and descriptor registry.
2. Scene state expansion with render settings, live resource keys, and changed flags.
3. Geometry/material/resource descriptor compilation for target primitives.
4. New geometry and material primitives.
5. Texture and sampler resources, pruning, and generation tokens.
6. Pipeline cache and explicit batch key components.
7. Interaction index and bounds picking.
8. Instanced mesh.
9. Orthographic camera and root options.
10. Demo rebuild and verification.

Each step should preserve the target behavior introduced by earlier steps. It does not need to preserve obsolete implementation behavior.

## Non-Goals And Follow-Ups

The design intentionally leaves the lower-level TypeGPU escape hatches for later:

- `shaderMaterial`.
- `renderPass`, `computePass`, and render targets.
- `storageBuffer`, `uniformBuffer`, `vertexBuffer`, `indexBuffer`.
- Raw bind groups and pipelines.
- Full render-plan scheduling across multiple passes.

The implementation should leave extension points for these primitives through descriptor registration, resource key separation, and render-plan-friendly batch metadata.
