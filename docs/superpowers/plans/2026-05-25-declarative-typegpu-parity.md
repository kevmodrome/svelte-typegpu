# Declarative TypeGPU Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the docs examples express the official TypeGPU scenes declaratively through `svelte-typegpu` nodes, without falling back to pure TypeGPU orchestration in example components.

**Architecture:** Keep Svelte as the scene orchestration layer. Add renderer primitives for the missing GPU concepts: vertex colors, object drag callbacks, OBJ model loading, shadow maps, and fullscreen shader passes. Example files may import shader functions or static geometry data, but render orchestration must remain declarative markup.

**Tech Stack:** Svelte custom renderer PR build, TypeGPU 0.11.6, Vitest, Mochi docs app, WebGPU browser smoke tests.

---

## File Structure

- Modify `packages/svelte-typegpu/src/typegpu-layouts.ts` for vertex-color layout and shadow bind group layout.
- Modify `packages/svelte-typegpu/src/typegpu-pipeline.ts` for vertex color multiplication and optional shadow sampling.
- Modify `packages/svelte-typegpu/src/instance-data.ts`, `packages/svelte-typegpu/src/box-data.ts`, `packages/svelte-typegpu/src/sphere-data.ts`, `packages/svelte-typegpu/src/geometries.ts`, and `packages/svelte-typegpu/src/glb-loader.ts` so all geometry emits the same vertex layout.
- Add `packages/svelte-typegpu/src/obj-loader.ts` and extend `packages/svelte-typegpu/src/model-cache.ts` so `<model src="*.obj">` works.
- Modify `packages/svelte-typegpu/src/lights.ts`, `packages/svelte-typegpu/src/types.ts`, `packages/svelte-typegpu/src/lighting-data.ts`, `packages/svelte-typegpu/src/gpu-renderer.ts`, and `packages/svelte-typegpu/src/resource-caches.ts` for declarative shadow maps.
- Add `packages/svelte-typegpu/src/shader-pass.ts` and extend renderer state for `<shaderPass fragment={...}>`.
- Modify `packages/svelte-typegpu/src/primitives.ts`, `packages/svelte-typegpu/src/scene-compiler.ts`, and interaction modules for new node semantics.
- Rewrite docs example files under `apps/docs/src/examples/*` and copy required public assets into `apps/docs/public/assets`.

## Task 1: Vertex Colors

**Files:**
- Modify: `packages/svelte-typegpu/src/instance-data.ts`
- Modify: `packages/svelte-typegpu/src/typegpu-layouts.ts`
- Modify: `packages/svelte-typegpu/src/typegpu-pipeline.ts`
- Modify: `packages/svelte-typegpu/src/box-data.ts`
- Modify: `packages/svelte-typegpu/src/sphere-data.ts`
- Modify: `packages/svelte-typegpu/src/geometries.ts`
- Test: `packages/svelte-typegpu/src/resources.test.ts`
- Test: `packages/svelte-typegpu/src/typegpu-layouts.test.ts`

- [x] **Step 1: Add failing tests**

Add tests that assert generated geometries use 12 floats per vertex and that the color channel defaults to `[1, 1, 1, 1]`. Add a `bufferGeometry` test with `vertexFloats={12}` and per-vertex colors.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- resources.test.ts typegpu-layouts.test.ts`

Expected: FAIL because the layout still has 8 floats.

- [x] **Step 2: Implement vertex color layout**

Set `MESH_VERTEX_FLOATS` to `12`, add `color: d.location(3, d.float32x4)` to `typegpuMeshVertexSchema`, move instance attributes to higher locations, and update shader input/output to multiply `in.color * in.vertexColor`.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- resources.test.ts typegpu-layouts.test.ts typegpu-pipeline.test.ts`

Expected: PASS.

## Task 2: Declarative Object Drag

**Files:**
- Modify: `packages/svelte-typegpu/src/primitives.ts`
- Modify: `packages/svelte-typegpu/src/types.ts`
- Modify: `packages/svelte-typegpu/src/scene-compiler.ts`
- Modify: `packages/svelte-typegpu/src/svelte-renderer.ts`
- Test: `packages/svelte-typegpu/src/camera-interaction.test.ts`
- Test: `packages/svelte-typegpu/src/scene-compiler.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests for `<mesh ondragmove={handler} drag="rotate">` so the renderer dispatches drag deltas to the mesh hit target while orbit controls keep normal camera dragging.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- camera-interaction.test.ts scene-compiler.test.ts`

Expected: FAIL because mesh drag listeners are not tracked.

- [ ] **Step 2: Implement drag events**

Track `dragstart`, `dragmove`, and `dragend` as pointer events. When a pointerdown hits an interaction target with drag handlers, capture the pointer and dispatch deltas to that node instead of camera controls until release.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- camera-interaction.test.ts scene-compiler.test.ts`

Expected: PASS.

## Task 3: OBJ Model Loading

**Files:**
- Add: `packages/svelte-typegpu/src/obj-loader.ts`
- Modify: `packages/svelte-typegpu/src/model-cache.ts`
- Modify: `packages/svelte-typegpu/src/scene-compiler.test.ts`
- Test: `packages/svelte-typegpu/src/obj-loader.test.ts`

- [ ] **Step 1: Add failing tests**

Test parsing an OBJ with vertices, normals, triangular faces, and quad triangulation into `TypeGpuLoadedModel`. Test that `model-cache` chooses OBJ loading for `.obj` URLs.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- obj-loader.test.ts model-cache.test.ts`

Expected: FAIL because `obj-loader.ts` does not exist.

- [ ] **Step 2: Implement OBJ parser**

Parse `v`, `vn`, and `f` records. Triangulate polygon faces with a fan. Emit `TypeGpuGeometryData` with the standard 12-float vertex layout and a default material.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- obj-loader.test.ts model-cache.test.ts`

Expected: PASS.

## Task 4: Declarative Shadow Maps

**Files:**
- Modify: `packages/svelte-typegpu/src/types.ts`
- Modify: `packages/svelte-typegpu/src/lights.ts`
- Modify: `packages/svelte-typegpu/src/lighting-data.ts`
- Modify: `packages/svelte-typegpu/src/typegpu-layouts.ts`
- Modify: `packages/svelte-typegpu/src/typegpu-pipeline.ts`
- Modify: `packages/svelte-typegpu/src/gpu-renderer.ts`
- Test: `packages/svelte-typegpu/src/lighting-data.test.ts`
- Test: `packages/svelte-typegpu/src/gpu-renderer.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests for `<directionalLight castShadow shadowMapSize={2048} shadowBias={1} shadowSlopeBias={4}>` and `<mesh receiveShadow>`. Assert light state records `castsShadow`, map size, and bias values.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- lighting-data.test.ts gpu-renderer.test.ts`

Expected: FAIL because lights always set `castsShadow: false`.

- [ ] **Step 2: Implement first directional-light shadow map**

Allocate one depth texture and comparison sampler for the first shadow-casting directional light. Render shadow-casting draw batches into the shadow map before the main pass. Add a shadow bind group and sample it in the main fragment shader when a receiving mesh is lit by the shadowed directional light.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- lighting-data.test.ts gpu-renderer.test.ts typegpu-pipeline.test.ts`

Expected: PASS.

## Task 5: Declarative Fullscreen Shader Pass

**Files:**
- Add: `packages/svelte-typegpu/src/shader-pass.ts`
- Modify: `packages/svelte-typegpu/src/types.ts`
- Modify: `packages/svelte-typegpu/src/primitives.ts`
- Modify: `packages/svelte-typegpu/src/scene-compiler.ts`
- Modify: `packages/svelte-typegpu/src/gpu-renderer.ts`
- Test: `packages/svelte-typegpu/src/scene-compiler.test.ts`
- Test: `packages/svelte-typegpu/src/gpu-renderer.test.ts`

- [ ] **Step 1: Add failing tests**

Add tests for `<shaderPass fragment={fragmentFn} uniforms={{ time: 'time', resolution: 'resolution' }} active={true}>`. Assert scene state contains one fullscreen pass and no mesh draw batch.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts gpu-renderer.test.ts`

Expected: FAIL because `shaderPass` is inert.

- [ ] **Step 2: Implement shader pass state and rendering**

Collect active shader pass nodes, create the corresponding TypeGPU pipeline inside the renderer, bind built-in time/resolution uniforms, and draw six fullscreen vertices before or instead of mesh batches according to `renderOrder`.

Run: `pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts gpu-renderer.test.ts`

Expected: PASS.

## Task 6: Docs Example Parity Rewrite

**Files:**
- Modify: `apps/docs/src/examples/two-boxes/*`
- Modify: `apps/docs/src/examples/phong-reflection/*`
- Modify: `apps/docs/src/examples/simple-shadow/*`
- Modify: `apps/docs/src/examples/interactive-orbit-field/*`
- Modify: `apps/docs/src/examples/example-definitions.ts`
- Add: `apps/docs/public/assets/phong/teapot.obj`

- [ ] **Step 1: Add failing docs tests**

Extend `apps/docs/src/examples/registry.test.ts` to assert examples use `dragmove`, OBJ model source, `castShadow`, `receiveShadow`, and `shaderPass`.

Run: `pnpm --filter docs --fail-if-no-match test`

Expected: FAIL because examples are still adapted.

- [ ] **Step 2: Rewrite examples declaratively**

Rewrite the four docs examples to use the new renderer nodes. Keep orchestration in `.typegpu.svelte` markup. Shader math can live in imported TypeGPU shader modules, but canvas/root/pipeline setup must not appear in the examples.

Run: `pnpm --filter docs --fail-if-no-match run generate:typegpu && pnpm --filter docs --fail-if-no-match test`

Expected: PASS.

## Task 7: Verification

**Files:**
- No new files.

- [ ] **Step 1: Run full test suite**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run full build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 3: Browser smoke test**

Run docs dev server and open `/examples/two-boxes`, `/examples/phong-reflection`, `/examples/simple-shadow`, and `/examples/interactive-orbit-field`. Verify previews render without console errors and controls remain interactive.

Expected: all four examples render through declarative renderer nodes.
