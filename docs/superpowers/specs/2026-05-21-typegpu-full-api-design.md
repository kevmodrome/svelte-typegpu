# TypeGPU Full Renderer API Design

## Goal

Build a TypeGPU custom-renderer API where users compose scenes with nested transforms, meshes, geometry, and materials in Svelte, while the renderer keeps batching and GPU buffer packing internal.

## Current State

The renderer currently supports a Svelte-rendered TypeGPU scene with:

- `<scene>` scene-level scale and animation speed.
- `<perspectiveCamera>` camera settings.
- Primitive nodes such as `<box>` and `<sphere>` that pack position, color, size, phase, and spin speed directly into draw batches.
- Generic draw batches keyed by primitive geometry, with dirty instance-buffer packing.

The node tree is structurally real, but rendering treats primitives as mostly flat authored instances. Parent-child nesting is not yet meaningful for transforms or resource composition.

## Recommended Approach

Implement the full API in two layers:

1. A generic scene graph layer:
   - `<group>` and `<mesh>` are transformable nodes.
   - Child transforms inherit from parent transforms.
   - The renderer resolves world transforms while walking the Svelte-rendered node tree.

2. A render-item layer:
   - `<mesh>` owns transform and interactive attributes.
   - Geometry children such as `<boxGeometry>` and `<sphereGeometry>` describe shape.
   - Material children such as `<standardMaterial>` describe color and shading inputs.
   - The renderer turns resolved mesh + geometry + material combinations into internal draw items, then batches compatible draw items automatically.

This keeps the public API declarative and composable, while preserving the current performance strategy.

## Public API

The target authoring model is:

```svelte
<scene scale={controls.cubeScale} animationSpeed={controls.spinSpeed}>
  <perspectiveCamera
    position={controls.camera.position}
    lookAt={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={500}
  />

  <group position={[0, 0, 0]} rotation={[0, spin, 0]} scale={1}>
    <mesh position={[0, 0, 0]} phase={0.2} spinSpeed={1.2} onclick={shiftHue}>
      <boxGeometry width={1.8} height={0.8} depth={1.2} />
      <standardMaterial color={[1, 0.45, 0.25, 1]} roughness={0.35} metalness={0.15} />
    </mesh>

    <mesh position={[2, 0, 0]} phase={0.7} spinSpeed={0.6}>
      <sphereGeometry radius={0.7} />
      <standardMaterial color={[0.2, 0.9, 0.7, 1]} roughness={0.5} metalness={0.05} />
    </mesh>
  </group>
</scene>
```

Convenience components can remain:

```svelte
<Box position={position} width={1} height={1} depth={1} color={color} spinSpeed={1} />
<Sphere position={position} radius={0.5} color={color} spinSpeed={1.4} />
```

Those components should compile to the generic mesh API internally:

```svelte
<mesh {position} {phase} {spinSpeed} onclick={onclick}>
  <boxGeometry {width} {height} {depth} />
  <standardMaterial {color} />
</mesh>
```

## Node Semantics

`<scene>`:

- Provides global render settings.
- Owns camera, transform groups, and meshes.
- Does not contain primitive-specific behavior.

`<group>`:

- Applies `position`, `rotation`, and `scale` to descendants.
- Does not emit a draw item.
- Can be nested.

`<mesh>`:

- Emits one draw item if it has a supported geometry and material.
- Supports `position`, `rotation`, `scale`, `phase`, `spinSpeed`, `role`, `tabindex`, `aria-label`, and event listeners.
- Uses default geometry or material only when that default is explicit in the renderer contract.

Geometry nodes:

- `<boxGeometry width height depth>`
- `<sphereGeometry radius width height depth>`
- Geometry nodes do not emit draw items without a parent mesh.
- The first supported geometry child under a mesh is used.

Material nodes:

- `<standardMaterial color roughness metalness>`
- Material nodes do not emit draw items without a parent mesh.
- The first supported material child under a mesh is used.

## Batching Model

Batching remains automatic.

The scene-state reader should produce generic draw items:

```ts
interface TypeGpuDrawItem {
  nodeId: number;
  geometry: TypeGpuGeometryDescriptor;
  material: TypeGpuMaterialDescriptor;
  transform: TypeGpuTransform;
  phase: number;
  spinSpeed: number;
}
```

The primitive cache groups draw items by batch compatibility:

- Geometry kind and geometry parameters.
- Pipeline-compatible material kind.
- Vertex/index layout.

Per-instance material values such as color can remain instance data. That means differently colored boxes can still batch together when they share geometry and pipeline shape.

The first implementation should support one material pipeline, `standardMaterial`, and keep `roughness` and `metalness` packed per instance even if the shader only uses them lightly at first. This avoids designing a material API that immediately needs a second rewrite.

## Transform Model

Transforms should be resolved on the CPU while reading scene state.

Each transformable node accepts:

- `position`: `[x, y, z]`, default `[0, 0, 0]`.
- `rotation`: `[x, y, z]` radians, default `[0, 0, 0]`.
- `scale`: number or `[x, y, z]`, default `1`.

The world transform for a mesh is the ordered multiplication of ancestor transforms and its local transform. The instance buffer should store the resolved transform in a representation that is efficient for the shader. For the first version, store `worldPosition`, `worldRotation`, and `worldScale` as separate vectors, because current shaders already construct object transforms from scalar inputs. A later version can switch to matrices if the transform stack becomes more complex.

## Interaction

Click handling should remain node-oriented.

The renderer already dispatches clicks to an interactive primitive. The full API should map draw instances back to their source `<mesh>` node. Convenience components receive events through their underlying mesh. A geometry or material node should not receive pointer events directly.

The first implementation can keep the existing "first interactive item" behavior. Accurate GPU picking is a separate feature and should not be included in this API migration.

## Error Handling

Invalid mesh composition should not throw during rendering. The scene reader should skip unsupported draw items and expose enough structure for tests to verify the behavior.

Rules:

- A mesh with no supported geometry is skipped.
- A mesh with no supported material uses a default white `standardMaterial`.
- A geometry node outside a mesh is ignored.
- A material node outside a mesh is ignored.
- Unknown element names remain inert scene-graph nodes, matching the current renderer's permissive style.

## Migration Plan

The demo should be rewritten to use the full API directly:

- Replace direct `<Box>` and `<Sphere>` usage in the main generated field with `<mesh>` plus geometry/material children.
- Keep `Box.typegpu.svelte` and `Sphere.typegpu.svelte` as convenience components that compose the new API.
- Preserve current controls: count, hue, spin, scale, camera position, camera rotation, near/far.
- Preserve performance goals: 1k and 10k should not regress due to the API shape.

## Testing

Add renderer-core tests for:

- Reading a simple mesh with box geometry and material into a draw item.
- Applying nested group transforms to child meshes.
- Grouping compatible meshes into the same draw batch.
- Keeping different per-instance colors in the same batch.
- Skipping invalid mesh compositions without crashing.
- Convenience `Box` and `Sphere` components producing mesh nodes with geometry and material children when rendered through the TypeGPU custom renderer.

Existing tests for scene settings, camera settings, dirty packing, and draw batches should remain.

## Non-Goals

This design does not include:

- Raw WebGL.
- Multiple shader pipelines.
- Texture loading.
- GPU picking.
- Skeletal animation.
- Arbitrary custom WGSL authored from Svelte.
- Matrix-instance transforms as the first implementation.

Those can be added after the scene graph and mesh/material model are stable.

## Open Decisions Resolved

The first version should implement the fuller `<mesh><geometry/><material/></mesh>` API immediately, rather than only adding groups to current primitives. The API migration is larger, but it prevents the next round of work from being anchored to primitive-specific shortcuts.

The renderer should keep automatic batching, not expose manual batch components. Users should write scene structure; the renderer should decide which compatible draw items share GPU buffers.
