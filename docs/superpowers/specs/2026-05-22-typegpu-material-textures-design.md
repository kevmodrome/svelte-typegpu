# TypeGPU Material Textures Design

## Goal

Add a material system that lets Svelte-authored TypeGPU scenes render textured meshes, while keeping the API composable and the renderer free to batch compatible draw items automatically.

This is greenfield code. The implementation should move directly to the desired material-ready shape instead of preserving temporary layout or API decisions that are likely to be removed.

## Current State

The renderer already supports a declarative scene graph:

- `<scene>` for global render settings.
- `<perspectiveCamera>` for camera settings.
- `<group>` and `<mesh>` for transformable scene structure.
- `<boxGeometry>` and `<sphereGeometry>` for mesh geometry.
- `<standardMaterial>` for color, roughness, and metalness.

Internally, material values are packed into per-instance data and rendered through one TypeGPU mesh pipeline. Geometry currently carries positions and normals only. There is no texture resource layer, material bind group, or UV data.

The current renderer already uses TypeGPU schemas, bind group layouts, buffers, and render pipelines, but it also unwraps some resources and drives the render pass through raw WebGPU calls. The material texture work should not expand that escape hatch. Where TypeGPU exposes an API for a resource or draw step, the implementation should use the TypeGPU API.

## Recommended Approach

Implement texture support as a first material-system step, not as arbitrary shader authoring.

The first version should:

- Keep `standardMaterial` as the primary built-in material.
- Add URL-based base-color textures through `map`.
- Add reusable material descriptors through `createStandardMaterial(...)`.
- Move geometry and instance layouts directly to the material-ready shape.
- Treat texture identity as a batching boundary.
- Use one unified texture-capable standard shader path for textured and untextured materials.
- Prefer TypeGPU-managed textures, samplers, bind groups, pipeline binding, and draw calls over raw WebGPU equivalents.

Custom shader materials, normal maps, direct `GPUTexture` inputs, and additional material models are later features.

## TypeGPU Usage Boundary

The implementation should stay TypeGPU-first.

Use TypeGPU for:

- Vertex and instance layouts through `tgpu.vertexLayout(...)`.
- Uniform, texture, and sampler bind group layouts through `tgpu.bindGroupLayout(...)`.
- Texture schema entries through the current texture API, such as `d.texture2d()`, not deprecated legacy texture strings.
- Buffers through `root.createBuffer(...)`.
- Textures through `root.createTexture(...)`.
- Samplers through `root.createSampler(...)`.
- Bind groups through `root.createBindGroup(...)`.
- Shader texture sampling through TypeGPU functions and TypeGPU-resolved WGSL dependencies.
- Render pipeline binding and draw orchestration through `TgpuRenderPipeline.with(...)`, `withColorAttachment(...)`, `withDepthStencilAttachment(...)`, and `draw(...)` where the API supports the needed behavior.

Raw WebGPU should be limited to browser/platform boundaries that TypeGPU does not abstract, such as `navigator.gpu` availability checks, canvas context acquisition where required, image decoding APIs, and any narrow fallback that is documented in code because TypeGPU lacks the needed surface. Do not create material textures with `device.createTexture`, material samplers with `device.createSampler`, material bind groups with `device.createBindGroup`, or material render pipelines with `device.createRenderPipeline`.

## Public API

Inline Svelte materials remain the main authoring path:

```svelte
<mesh>
  <boxGeometry width={2} height={1} depth={1} />
  <standardMaterial
    color={[1, 1, 1, 1]}
    roughness={0.4}
    metalness={0.1}
    map="/textures/crate.png"
  />
</mesh>
```

Reusable material descriptors are supported for shared material setup:

```ts
import { createStandardMaterial } from './lib/typegpu-renderer/materials';

const crate = createStandardMaterial({
  color: [1, 1, 1, 1],
  roughness: 0.55,
  metalness: 0.05,
  map: '/textures/crate.png'
});
```

```svelte
<mesh>
  <boxGeometry />
  <standardMaterial material={crate} />
</mesh>
```

The renderer should not add a generic `<material value={...}>` wrapper for this first pass. `<standardMaterial material={crate}>` is enough and keeps the API specific to the built-in material type.

## Material Descriptors

Material reading normalizes inline props and reusable material objects into the same descriptor:

```ts
interface TypeGpuStandardMaterialDescriptor {
  kind: 'standard';
  color: RgbaTuple;
  roughness: number;
  metalness: number;
  opacity: number;
  map: TypeGpuTextureSource | null;
}

interface TypeGpuUrlTextureSource {
  kind: 'url';
  src: string;
}
```

Defaults:

- `color`: `[1, 1, 1, 1]`
- `roughness`: `0.45`
- `metalness`: `0.05`
- `opacity`: `1`
- `map`: `null`

The scene reader remains CPU-only. It records texture sources and stable material identity, but it does not load images or create GPU resources.

## Geometry And Instance Layouts

Move directly to material-ready layouts:

```ts
// vertex
position: vec3f
normal: vec3f
uv: vec2f

// instance
position/transform data
color: vec4f
materialParams: vec4f // roughness, metalness, opacity, reserved/effect
```

UVs are mandatory in geometry data. Boxes and spheres should generate sensible UV coordinates as part of their vertex data. Tests should assert the new vertex stride and UV attributes directly.

## Batching

Batching remains automatic.

Draw batches should group by:

- Geometry kind.
- Material pipeline kind.
- Texture identity.

Per-instance values such as color, roughness, metalness, and opacity stay in the instance buffer. Different colors can still share a batch. Different texture URLs create separate batches because they require different material resources.

Untextured materials use an internal 1x1 white texture. That is not a compatibility path; it is the clean representation of a standard material with no base-color map. The standard shader always samples a texture.

## TypeGPU Resource Model

The TypeGPU renderer owns texture loading and resource lifetime.

Add a material resource cache inside `TypeGpuSceneRenderer` that:

- Caches texture resources by stable texture key.
- Loads URL textures asynchronously.
- Creates textures with `root.createTexture(...)` and marks them for sampled usage.
- Uploads decoded image data through the `TgpuTexture.write(...)` API.
- Creates a shared sampler with `root.createSampler(...)`.
- Creates a material bind group for each texture resource with `root.createBindGroup(...)`.
- Provides a shared white fallback texture for untextured, loading, or failed textures.
- Disposes owned TypeGPU textures when the renderer is disposed.

The material bind group layout should use TypeGPU's current texture entries instead of deprecated legacy strings:

```ts
export const materialBindGroupLayout = tgpu
  .bindGroupLayout({
    baseColorTexture: { texture: d.texture2d(), visibility: ['fragment'] },
    baseColorSampler: { sampler: 'filtering', visibility: ['fragment'] }
  })
  .$idx(1);
```

The render pass should use:

1. Mesh pipeline.
2. Scene bind group at index `0`.
3. Material bind group at index `1`.
4. Geometry and instance vertex buffers.
5. Instanced draw call.

Prefer the TypeGPU pipeline flow for those steps, for example binding the scene/material bind groups and vertex buffers with `pipeline.with(...)`, attaching color/depth targets with `withColorAttachment(...)` and `withDepthStencilAttachment(...)`, then issuing `draw(...)`. If an implementation detail still requires a raw WebGPU pass, keep it isolated, explain why TypeGPU cannot cover that part yet, and do not use raw WebGPU for material resource creation.

While an image is loading or has failed, the batch renders with the white fallback texture. Scene rendering should not block on image loading.

## Shader Model

The standard material shader should become texture-capable by default.

The vertex shader passes UVs to the fragment shader. The fragment shader samples the base-color texture and multiplies it by the per-instance color:

```wgsl
let texel = textureSample(base_color_texture, base_color_sampler, in.uv);
let base_color = texel * in.color;
```

Existing roughness and metalness shading can remain simple, but the material parameter vector should be shaped so future properties can be added without another immediate layout rewrite.

## Error Handling

Invalid or missing material props normalize to defaults during scene reading.

Invalid mesh composition stays permissive:

- A mesh without supported geometry is skipped.
- A mesh without supported material uses the default `standardMaterial`.
- Unsupported geometry or material nodes are ignored.
- Texture load failures render with the white fallback texture.

The renderer should avoid throwing for ordinary authoring mistakes. Diagnostics can be added later once the authoring model stabilizes.

## Testing

Add or update tests for:

- Material reader normalization for inline props.
- Material reader normalization for `createStandardMaterial(...)` objects.
- Draw batches splitting by texture identity.
- Draw batches sharing instances for the same texture identity.
- Box and sphere geometry UV data.
- TypeGPU vertex layout including UV attributes.
- Standard shader WGSL including texture, sampler, and UV sampling.
- Renderer setting scene bind group `0` and material bind group `1`.
- Material resources being created through TypeGPU APIs rather than raw `device.createTexture`, `device.createSampler`, or `device.createBindGroup`.
- Render-pipeline usage preferring TypeGPU `.with(...)` and `.draw(...)` APIs where practical.
- Loading or failed textures using fallback resources.
- Dirty-range behavior repacking only changed mesh/material instances.

Existing scene, camera, transform, interaction, and draw-batch tests should be updated to the new layout rather than preserving old offsets for compatibility.

## Non-Goals

This design does not include:

- Arbitrary custom shader authoring.
- Normal maps.
- Environment maps.
- Direct `GPUTexture` or TypeGPU texture inputs.
- Texture atlasing.
- Mip generation controls.
- Material diagnostics UI.
- Backward compatibility with current temporary instance or vertex layouts.
- A broad raw-WebGPU renderer rewrite.

## Implementation Direction

This should be implemented as a single cohesive material-ready migration:

1. Add material descriptor helpers and `createStandardMaterial`.
2. Extend material reading to normalize inline and reusable material inputs.
3. Add UVs to geometry data and TypeGPU vertex layouts.
4. Update instance packing to the new material parameter layout.
5. Split draw batches by texture identity.
6. Add material bind group layout and standard shader texture sampling.
7. Add renderer-side TypeGPU material resource cache and fallback texture.
8. Replace raw WebGPU material/rendering escape hatches with TypeGPU APIs where the installed TypeGPU surface supports it.
9. Update the demo to show at least one textured mesh.
10. Update tests to assert the final material-ready shape and TypeGPU-first boundary.
