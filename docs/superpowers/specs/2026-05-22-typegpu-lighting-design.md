# TypeGPU Lighting Design

## Goal

Add broad, transformable light-node support to the Svelte TypeGPU renderer while keeping scene authoring declarative and keeping GPU resource management as renderer internals.

The first lighting pass should expose several useful light types immediately. It should not implement shadows yet, but it must choose public API and internal light records that can gain shadow data later without replacing the model.

## Current State

The renderer already supports:

- A declarative Svelte scene graph with `<scene>`, `<perspectiveCamera>`, `<group>`, `<mesh>`, geometry nodes, and `<standardMaterial>`.
- CPU-resolved group and mesh transforms.
- Vertex normals for box and sphere geometry.
- A TypeGPU mesh pipeline with TypeGPU vertex layouts, bind group layouts, buffers, and shader functions.
- A hard-coded directional light in the fragment shader.
- Per-instance `standardMaterial` color, roughness, and metalness.

Lighting is currently not authored as scene data. The shader owns the light direction and intensity, so users cannot compose or animate lights in Svelte.

## Decisions

Use a broad public lighting API in v1:

- `<ambientLight>`
- `<hemisphereLight>`
- `<directionalLight>`
- `<pointLight>`
- `<spotLight>`

All lights are scene-graph nodes. Non-ambient lights are transformable and inherit transforms from groups. `lookAt` is supported where direction matters and wins over rotation-derived direction when present.

Do not implement shadows in v1. The internal light schema reserves shadow-ready fields so later shadow work can attach to the same light nodes and packed records.

## Public API

Users author lights as Svelte scene nodes:

```svelte
<scene>
  <ambientLight color={[1, 1, 1]} intensity={0.15} />

  <hemisphereLight
    skyColor={[0.55, 0.7, 1]}
    groundColor={[0.25, 0.18, 0.12]}
    intensity={0.5}
  />

  <directionalLight
    rotation={[-0.8, 0.4, 0]}
    color={[1, 0.96, 0.9]}
    intensity={2}
  />

  <group rotation={[0, spin, 0]}>
    <pointLight
      position={[2, 3, 1]}
      color={[1, 0.55, 0.35]}
      intensity={6}
      range={12}
      decay={2}
    />
  </group>

  <spotLight
    position={[0, 5, 4]}
    lookAt={[0, 0, 0]}
    color={[0.6, 0.8, 1]}
    intensity={8}
    range={18}
    angle={0.45}
    penumbra={0.35}
  />
</scene>
```

Common props:

- `color`: RGB tuple, default `[1, 1, 1]`.
- `intensity`: scalar, default `1`.
- `position`, `rotation`, `scale`: existing transform props. Scale has no lighting effect in v1 except through inherited transform composition.
- `lookAt`: world-space target for directional and spot lights.

Light-specific props:

- `hemisphereLight.skyColor`, `hemisphereLight.groundColor`.
- `pointLight.range`, default `0` meaning no explicit cutoff.
- `pointLight.decay`, default `2`.
- `spotLight.range`, default `0`.
- `spotLight.decay`, default `2`.
- `spotLight.angle`, default `Math.PI / 6`.
- `spotLight.penumbra`, default `0`.

Future shadow props should attach to the same light nodes, for example `castShadow`, `shadowBias`, `shadowMapSize`, and `shadowCamera`. They are non-goals for v1 and should either be ignored or left undocumented until implemented.

## Scene Semantics

Light nodes do not emit draw items and do not affect mesh batching. The scene reader walks the same tree used for meshes, composes group transforms, and collects lights into `TypeGpuLight` records.

`ambientLight` and `hemisphereLight` are accepted anywhere in the scene tree for API consistency, but their transform is ignored in v1.

`directionalLight` direction is resolved by:

1. `lookAt - worldPosition` when `lookAt` is present.
2. The node's world rotation applied to a default forward vector when `lookAt` is absent.

`spotLight` uses the same direction rule. `pointLight` only needs world position.

Unsupported or malformed light attributes fall back to defaults. Unknown light-like element names remain inert scene-graph nodes.

## Internal Light Model

Normalize all light types into one internal record shape:

```ts
type TypeGpuLightKind = 'ambient' | 'hemisphere' | 'directional' | 'point' | 'spot';

interface TypeGpuLight {
  id: number;
  revision: number;
  kind: TypeGpuLightKind;
  color: Vector3Tuple;
  intensity: number;
  position: Vector3Tuple;
  direction: Vector3Tuple;
  range: number;
  decay: number;
  angle: number;
  penumbra: number;
  groundColor: Vector3Tuple;
  castsShadow: boolean;
  shadowIndex: number;
}
```

The record keeps shadow fields even though v1 always writes `castsShadow: false` and `shadowIndex: -1`. That makes the future shadow path an extension of the same record instead of a second lighting model.

Set `MAX_LIGHTS` to `32` for v1. The scene reader returns the first 32 supported lights in scene order. Overflow lights are ignored for rendering and should be testable as a graceful clamp.

## TypeGPU Usage Boundary

Lighting must stay TypeGPU-first.

Use TypeGPU for:

- Light schemas with `d.struct`, `d.arrayOf`, `d.vec4f`, `d.u32`, and related schema helpers.
- Lighting bind group layout creation with `tgpu.bindGroupLayout(...)`.
- Lighting buffers through `root.createBuffer(...).$usage('uniform')` or `.$usage('storage')`.
- Lighting bind groups through `root.createBindGroup(...)`.
- Shader logic through `tgpu.fn`, `tgpu.fragmentFn`, and `.$uses(...)`.
- Pipeline integration through TypeGPU layouts and resource declarations.

Do not create lighting resources with raw `device.createBindGroup`, `device.createRenderPipeline`, or hand-authored standalone WGSL modules. The renderer may continue to unwrap final TypeGPU resources for render-pass submission where the existing renderer already does that, but lighting should not expand the raw WebGPU surface area.

## GPU Layout

Prefer one fixed-size TypeGPU uniform struct:

```ts
const MAX_LIGHTS = 32;

const typegpuLightSchema = d.struct({
  kind: d.u32,
  flags: d.u32,
  shadowIndex: d.u32,
  reserved0: d.u32,
  position_range: d.vec4f,
  direction_angle: d.vec4f,
  color_intensity: d.vec4f,
  secondary_color: d.vec4f,
  params: d.vec4f
});

const typegpuLightingSchema = d.struct({
  count: d.u32,
  reserved0: d.u32,
  reserved1: d.u32,
  reserved2: d.u32,
  lights: d.arrayOf(typegpuLightSchema, MAX_LIGHTS)
});
```

Field packing:

- `kind`: numeric light kind.
- `flags`: reserved for future booleans such as shadow enabled.
- `shadowIndex`: reserved for future shadow-map lookup.
- `position_range.xyz`: world position, `.w`: range.
- `direction_angle.xyz`: normalized world direction, `.w`: spot angle.
- `color_intensity.rgb`: color, `.w`: intensity.
- `secondary_color.rgb`: hemisphere ground color, otherwise `[0, 0, 0]`; `.w` reserved.
- `params.x`: decay.
- `params.y`: penumbra.
- `params.zw`: reserved padding.

If uniform buffer indexing or size becomes awkward in TypeGPU/WebGPU, use the same TypeGPU schema as a read-only storage buffer. That fallback is still TypeGPU-native and should not change public API.

## Shading Model

Use an intentionally simple standard-material lighting model:

- Sum ambient and hemisphere contribution first.
- Evaluate directional, point, and spot lights in a fixed loop up to `MAX_LIGHTS`.
- Use Lambert diffuse plus a modest Blinn-Phong style specular term.
- Continue using `roughness` and `metalness` from `standardMaterial` as approximations, not full PBR.
- Clamp final color to avoid explosive over-bright output in demos.

This keeps API breadth high while leaving physically based lighting, image-based lighting, tone mapping, and shadows as later renderer upgrades.

## Renderer Data Flow

`createSceneState(...)` should return both draw batches and lighting state:

```ts
interface TypeGpuSceneState {
  camera: TypeGpuCameraSettings;
  scale: number;
  animationSpeed: number;
  colorShift: number;
  lights: TypeGpuLight[];
  drawBatches: TypeGpuDrawBatch[];
}
```

The runtime should track lighting dirtiness separately from draw-batch dirtiness. Changing a light prop or transform updates the lighting buffer but does not repack mesh instances. Changing only scene settings or camera settings should not repack lights unless those settings become relevant later.

The GPU renderer owns one lighting buffer and bind group. On each scene update, it packs the current lights into a reusable typed buffer payload and writes it only when lighting data changed.

## Svelte Reactivity

Light props must behave like existing mesh, material, scene, and camera props. When Svelte updates a light attribute such as `position`, `color`, `intensity`, `lookAt`, `range`, `angle`, or `penumbra`, the custom renderer's normal `setAttribute(...)` path updates the underlying `TypeGpuNode`, increments its revision, and schedules a scene sync.

The runtime should classify dirty nodes into at least three independent invalidation paths:

- Draw-batch dirtiness for mesh, geometry, material, and transform changes that affect mesh instances.
- Lighting dirtiness for light node changes and ancestor transform changes that affect descendant lights.
- Scene uniform dirtiness for camera and scene-level settings.

Lighting dirtiness must be raised when:

- A supported light node's attributes change.
- A supported light node is inserted, removed, or reordered.
- A transformable ancestor such as `<group>` changes and that subtree contains one or more supported lights.
- A `lookAt` value changes on a directional or spot light.

On the next scheduled sync, `createSceneState(...)` rereads the current scene graph and returns updated `lights`. The GPU renderer then repacks and writes only the lighting buffer. This is the path that makes ordinary Svelte state changes propagate into rendered lighting:

```svelte
<script lang="ts">
  let lightIntensity = $state(4);
  let lightPosition = $state<[number, number, number]>([2, 3, 1]);
</script>

<pointLight
  position={lightPosition}
  color={[1, 0.55, 0.35]}
  intensity={lightIntensity}
  range={12}
/>
```

The user should not need to call an imperative renderer API, touch TypeGPU buffers, or manually mark lights dirty.

## Batching And Performance

Lights are global scene inputs for v1. They do not split draw batches by material or geometry.

The shader loop cost is bounded by `MAX_LIGHTS`. If needed, the shader can loop to `count` with an upper bound so empty light slots are skipped. The first implementation should keep `MAX_LIGHTS` conservative and simple, then increase or specialize later if real scenes need it.

## Error Handling

Rules:

- Missing color defaults to white.
- Missing intensity defaults to `1`.
- Negative intensity is clamped to `0`.
- Negative range is treated as `0`.
- `penumbra` is clamped to `[0, 1]`.
- `angle` is clamped to a practical range above `0` and below `Math.PI / 2`.
- Zero-length light directions fall back to a stable default direction.
- More than `MAX_LIGHTS` supported lights are ignored after the limit.

Rendering should not throw for invalid light composition or unsupported light nodes.

## Demo Migration

Update the demo scene to include a mix of light types:

- Low ambient light for baseline visibility.
- One directional light for broad shape definition.
- A moving or grouped point light to prove transform inheritance.
- One spot light aimed with `lookAt` to prove direction authoring.

Keep the existing cube count, hue, spin, scale, and camera controls. Lighting should enhance the current field without becoming a separate demo app.

## Testing

Add focused tests for:

- Reading each light type into normalized `TypeGpuLight` records.
- Applying nested group transforms to point and spot lights.
- Resolving `lookAt` direction ahead of rotation-derived direction.
- Clamping malformed light props without throwing.
- Clamping scenes to `MAX_LIGHTS`.
- Propagating Svelte-updated light attributes through `setAttribute(...)`, scene sync, and lighting buffer writes.
- Marking lighting dirty when a parent group transform changes under a light subtree.
- Keeping light-only changes out of mesh instance repacking.
- Verifying TypeGPU lighting schemas, bind group layout index, and buffer sizing.
- Resolving shader code that references the lighting bind group and light evaluator functions.
- Rendering the demo scene into light nodes through the custom Svelte renderer.

Existing mesh, material, camera, and batching tests should remain.

## Non-Goals

This design does not include:

- Shadow maps.
- Physically based rendering.
- Image-based lighting.
- Texture or normal-map material work.
- Custom shader materials.
- Per-object light masks.
- GPU picking for lights.
- Light helper meshes or debug gizmos.
