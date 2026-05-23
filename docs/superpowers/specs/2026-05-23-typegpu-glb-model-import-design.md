# TypeGPU GLB Model Import Design

## Goal

Add first-class static GLB model import to the Svelte TypeGPU renderer so applications can place imported 3D assets in the declarative scene graph without building model-specific UI or converting files ahead of time.

The first version should support practical static model rendering from URL-loaded GLB files and app-provided GLB bytes. It should fit the existing renderer architecture: Svelte owns the scene graph, the scene reader produces internal draw items, and the TypeGPU renderer batches compatible geometry and material work.

## Current State

The renderer currently supports:

- Declarative Svelte scene nodes such as `<scene>`, `<group>`, `<mesh>`, and `<perspectiveCamera>`.
- Procedural geometry nodes: `<boxGeometry>` and `<sphereGeometry>`.
- A built-in `<standardMaterial>` with color, roughness, metalness, opacity, and optional base-color texture map.
- CPU scene reading into draw batches.
- TypeGPU-managed vertex buffers, instance buffers, materials, textures, lighting uniforms, and render pipelines.
- Nested transform resolution for groups and meshes.

The renderer does not yet have a model asset loader, arbitrary vertex geometry descriptors, imported submesh support, or any way to pass loaded model bytes into the scene graph.

## Recommended Approach

Implement a small renderer-native GLB loader rather than pulling in a full Three.js or Babylon-style glTF runtime loader.

The loader should parse only the subset needed for static GLB rendering and convert that subset directly into the renderer's existing geometry, material, and transform concepts. This keeps the dependency surface small, avoids runtime object models that the renderer cannot draw yet, and gives clear behavior for unsupported glTF features.

V1 should support:

- Static `.glb` files only.
- Renderer-owned URL loading.
- App-owned `ArrayBuffer` loading for uploads or custom fetch pipelines.
- Mesh primitives with positions, normals, optional UVs, optional indices, transforms, and basic materials.
- Embedded GLB buffers and embedded base-color textures.

V1 should not support animation clips, skeletons, skinning, morph targets, external `.gltf` sidecar files, Draco compression, meshopt compression, or full glTF extension coverage.

## Public API

Add a declarative model node:

```svelte
<model src="/models/chair.glb" position={[0, 0, 0]} scale={1} />
```

Support an app-owned data path:

```svelte
<model data={modelArrayBuffer} position={[0, 0, 0]} />
```

`<model>` is a transformable scene node. It accepts the same transform attributes as `<group>` and `<mesh>`:

- `position`: `[x, y, z]`, default `[0, 0, 0]`.
- `rotation`: `[x, y, z]` radians, default `[0, 0, 0]`.
- `scale`: number or `[x, y, z]`, default `1`.

Input rules:

- `src` accepts GLB URLs. The renderer owns fetching, parsing, caching, and resource lifetime.
- `data` accepts a self-contained GLB `ArrayBuffer`. This is the path for file uploads and custom application fetching.
- If both `src` and `data` are passed, `data` wins.
- Callers should pass a stable `ArrayBuffer` instance when they want stable cache behavior.
- A model node with neither `src` nor `data` contributes no draw items.

`<model>` should expand into internal model draw items, not generated Svelte child `<mesh>` nodes. That avoids asking Svelte to instantiate large imported model hierarchies and keeps the imported asset path under the renderer's batching and cache control.

## Loaded Model Shape

The GLB loader should produce an internal loaded-model representation:

```ts
interface TypeGpuLoadedModel {
  key: string;
  meshes: TypeGpuLoadedModelMesh[];
}

interface TypeGpuLoadedModelMesh {
  geometry: TypeGpuGeometryData;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
}
```

`key` should be stable for URL-loaded assets and stable enough for app-provided data to support cache reuse when the same `ArrayBuffer` object is passed again.

Each loaded mesh represents one renderable glTF primitive after applying the local node transform chain inside the model file. Because glTF nodes use matrices and quaternion rotations while the current renderer instance layout uses Euler-based `TypeGpuTransform`, v1 should bake model-internal node transforms into imported vertex positions and normals during loading. The loaded mesh transform can then remain `IDENTITY_TRANSFORM` unless a primitive can safely reuse an existing TRS transform without losing correctness.

The scene reader composes the `<model>` node's world transform after model-local transforms have been applied. This keeps imported assets compatible with the current procedural mesh pipeline without introducing matrix instance attributes in the first model-import feature.

## GLB Loader Scope

The loader should support:

- GLB version 2 container parsing.
- JSON chunk and binary chunk extraction.
- glTF buffer views and accessors backed by the embedded binary chunk.
- Accessor component types needed for common static mesh data:
  - `FLOAT` for `POSITION`, `NORMAL`, and `TEXCOORD_0`.
  - Unsigned integer index accessors where present.
- Mesh primitives with `mode: TRIANGLES` or omitted mode.
- Indexed and non-indexed primitives.
- `POSITION` as required geometry input.
- `NORMAL` when present.
- `TEXCOORD_0` when present.
- Node transforms from either `matrix` or `translation` / quaternion `rotation` / `scale`.
- Basic material fields from metallic-roughness PBR materials:
  - `baseColorFactor` to material color.
  - `roughnessFactor` to roughness.
  - `metallicFactor` to metalness.
  - `baseColorTexture` to material map when the texture is embedded in the GLB.

Unsupported features should be skipped or ignored predictably:

- Non-triangle primitive modes are skipped.
- Primitives without `POSITION` are skipped.
- Sparse accessors are unsupported in v1.
- Animation, skin, skeleton, morph target, camera, and extension data is ignored.
- Draco and meshopt compressed primitives are skipped.

## Geometry Conversion

Imported model geometry should use the same vertex shape as procedural meshes:

```ts
position: vec3f
normal: vec3f
uv: vec2f
```

For indexed primitives, the loader should expand indices into triangle-list vertex data because the current renderer draws non-indexed batches. Indexed drawing can be a later optimization.

Fallbacks:

- Missing normals should generate usable normals where feasible. Flat normals are acceptable for v1.
- If normal generation is not possible for malformed geometry, use a stable fallback normal such as `[0, 1, 0]`.
- Missing UVs should use `[0, 0]`.

Geometry data should carry a unique key that identifies the loaded model and submesh. Procedural geometry can keep the existing `box` and `sphere` keys.

## Scene Reading And Batching

The scene reader should collect two kinds of renderable items:

- Existing procedural `<mesh>` items.
- Imported model mesh items from `<model>` nodes.

`<model>` reading is asynchronous-aware:

- While a model is loading, it contributes no draw items.
- If loading fails, it contributes no draw items.
- When loading completes, the runtime schedules another scene sync so the model appears without a full app remount.

Draw batch grouping should include:

- Geometry key.
- Geometry kind or equivalent imported-geometry identity.
- Material kind.
- Texture identity.

Procedural boxes and spheres continue to batch as they do now. Imported model submeshes can batch when they share compatible loaded geometry and material identity, but v1 does not need cross-model geometry deduplication beyond caching the loaded model result.

## Model Cache

Add a model cache to `TypeGpuSceneCache`, created by the TypeGPU runtime with an async-completion callback that schedules a scene sync. Keeping the cache beside the draw-batch cache lets scene reading remain the place where model nodes become draw items, while the runtime still owns invalidation when async loading finishes.

The cache should track:

- `loading`: a fetch or parse is in progress.
- `ready`: parsed model data is available.
- `failed`: the model could not be fetched or parsed.

URL entries should be keyed by `src`.

Data entries should be keyed by `ArrayBuffer` object identity, preferably with a `WeakMap<ArrayBuffer, ModelCacheEntry>`. This keeps uploaded-file workflows possible without hashing large buffers on every render. Applications that create a new `ArrayBuffer` every render should not expect stable caching.

The cache should expose a way to notify the runtime when an async load completes so draw batches are invalidated and resynced.

## Material And Texture Handling

GLB materials should map into the existing `standardMaterial` descriptor.

Defaults:

- Missing material uses the existing default white standard material.
- Missing base-color factor uses `[1, 1, 1, 1]`.
- Missing roughness uses the existing standard material default.
- Missing metalness uses the existing standard material default.

Embedded base-color textures should become texture sources understood by the existing material resource layer. Add an internal texture source kind for embedded image bytes:

```ts
interface TypeGpuEmbeddedTextureSource {
  kind: 'embedded';
  key: string;
  mimeType: string;
  data: Uint8Array;
}
```

The material resource layer should decode embedded texture sources through the existing image decode path without fetching a URL. The `key` should include the loaded model key and image index so material resources can cache embedded textures stably.

Texture failures should use the existing white fallback texture behavior. A failed embedded texture should not fail the whole model.

## Error Handling

The renderer should avoid throwing for ordinary authoring or asset issues after startup.

Failure behavior:

- Bad GLB magic, unsupported GLB version, missing JSON chunk, missing binary chunk, or malformed chunks: mark the model cache entry as failed and skip the model.
- Unsupported primitive mode: skip that primitive.
- Unsupported accessor or component type: skip the affected primitive.
- Missing required `POSITION`: skip the affected primitive.
- Unsupported compressed primitive: skip the affected primitive.
- Texture decode failure: render affected material with fallback texture.
- A model with no supported primitives renders nothing.

Diagnostics can be added later. V1 only needs deterministic failure states that tests can assert.

## Testing

Use tiny generated GLB fixtures in tests rather than checking binary assets into the repository.

Add tests for:

- GLB header and chunk parsing.
- Rejecting unsupported GLB versions and malformed chunks.
- Accessor decoding for positions, normals, UVs, and indices.
- Indexed primitive expansion into triangle-list vertex data.
- Non-indexed primitive loading.
- Transform composition from node hierarchy.
- Matrix transform reading.
- Material normalization from metallic-roughness fields.
- Embedded base-color texture extraction.
- Skipping unsupported primitive modes and missing-position primitives.
- Scene reading for `<model src>`.
- Scene reading for `<model data>`.
- Loading states contributing no draw items.
- Ready model states contributing imported draw items.
- Draw batch creation for imported geometry with stable geometry keys.
- Existing procedural geometry, material texture, camera, light, and interaction tests remaining green.

Manual verification can use a small GLB asset if needed, but adding model upload UI is outside this feature.

## Non-Goals

This design does not include:

- `.gltf` files with external `.bin` or image sidecars.
- OBJ, FBX, STL, USD, or other model formats.
- Animation clips.
- Skeletons or skinning.
- Morph targets.
- Draco compression.
- Meshopt compression.
- Tangents, normal maps, occlusion maps, emissive maps, or environment maps.
- Per-submesh GPU picking.
- Model upload UI for the demo app.
- Full glTF extension support.
- Indexed GPU draw calls.

## Implementation Direction

Implement the feature in small vertical slices:

1. Add internal model and imported geometry types.
2. Add GLB parsing for header, chunks, JSON, buffer views, and accessors.
3. Add primitive conversion into renderer vertex data.
4. Add material conversion and embedded texture source support.
5. Add model cache and async load notification.
6. Add `<model>` scene reading and transform composition.
7. Add draw-batch support for imported geometry keys.
8. Add focused tests for the loader, scene reader, and batch integration.

The implementation should preserve the current declarative renderer model and keep imported assets as data consumed by the renderer, not as a separate Three.js-style runtime graph.
