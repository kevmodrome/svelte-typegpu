# Declarative Scene Authoring API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace registry-style scene authoring with inline declarative composition, automatic resource identity, and automatic batching through direct meshes and component-produced meshes.

**Architecture:** Keep the internal resource caches and draw-batch cache, but remove public resource registry semantics from normal authoring. The scene compiler should walk the resolved custom-renderer node tree, read inline geometry/material/model descriptors, derive canonical cache keys, and group compatible mesh draw items without needing `<resources>`, `geometry="id"`, `material="id"`, or public `<instancedMesh>`.

**Tech Stack:** Svelte custom renderer preview, TypeGPU, Vitest, pnpm workspace, docs/example apps.

---

## File Structure

- Modify `packages/svelte-typegpu/src/resources.ts` to remove public registry collection and make inline descriptor keys canonical without `id` or public `layoutKey`.
- Modify `packages/svelte-typegpu/src/scene-compiler.ts` to resolve only inline geometry/material children for mesh/model authoring and remove public `instancedMesh` compilation.
- Modify `packages/svelte-typegpu/src/primitives.ts` to stop treating removed public props/primitives as first-class dirty sources.
- Modify `packages/svelte-typegpu/src/types.ts` only if removed public concepts expose exported types that should be retired.
- Modify `packages/svelte-typegpu/src/instance-data.ts` and `packages/svelte-typegpu/src/typegpu-pipeline.ts` to remove demo-specific `phase`, `spinSpeed`, scene `animationSpeed`, scene `colorShift`, and scene `scale` if they are no longer needed by examples.
- Modify tests in `packages/svelte-typegpu/src/*.test.ts` to assert inline composition, automatic descriptor reuse, and removal of registry/instanced authoring.
- Modify `apps/example/src/*.typegpu.svelte` and `apps/example/src/Scene.typegpu.test.ts` to use direct/component mesh composition instead of `<resources>` and `<instancedMesh>`.
- Modify docs examples under `apps/docs/src/examples/**` and docs snippets in `apps/docs/src/snippets/doc-snippets.ts` to teach the new API.
- Modify docs tests in `apps/docs/src/examples/registry.test.ts` and generated sample files after running the docs generator.

## Task 1: Lock In Inline Mesh Compilation

**Files:**
- Modify: `packages/svelte-typegpu/src/scene-compiler.test.ts`
- Modify: `packages/svelte-typegpu/src/scene-compiler.ts`

- [ ] **Step 1: Add failing tests for inline-only mesh authoring**

Add these tests to `packages/svelte-typegpu/src/scene-compiler.test.ts` near the existing mesh compilation tests:

```ts
it('compiles inline mesh geometry and material without resource ids', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const mesh = createElement('mesh');
  const geometry = createElement('boxGeometry');
  const material = createElement('standardMaterial');

  setAttribute(geometry, 'width', 2);
  setAttribute(geometry, 'height', 3);
  setAttribute(geometry, 'depth', 4);
  setAttribute(material, 'color', [0.25, 0.5, 0.75, 1]);
  insert(mesh, geometry, null);
  insert(mesh, material, null);
  insert(scene, mesh, null);
  insert(root, scene, null);

  const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

  expect(state.drawBatches).toHaveLength(1);
  expect(state.drawBatches[0]).toMatchObject({
    geometryKey: 'box:2:3:4',
    materialKey: 'material:standard'
  });
  expect(state.drawBatches[0].instances).toBeInstanceOf(Float32Array);
  expect(state.liveResourceKeys.geometries.has('box:2:3:4')).toBe(true);
});

it('does not resolve mesh geometry and material from public string ids', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const geometry = createElement('boxGeometry');
  const material = createElement('standardMaterial');
  const mesh = createElement('mesh');

  setAttribute(geometry, 'id', 'box');
  setAttribute(material, 'id', 'paint');
  setAttribute(mesh, 'geometry', 'box');
  setAttribute(mesh, 'material', 'paint');
  insert(scene, geometry, null);
  insert(scene, material, null);
  insert(scene, mesh, null);
  insert(root, scene, null);

  const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

  expect(state.drawBatches).toHaveLength(0);
  expect(state.liveResourceKeys.geometries.size).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts
```

Expected: FAIL because string resource references still compile.

- [ ] **Step 3: Remove string resource resolution from mesh compilation**

In `packages/svelte-typegpu/src/scene-compiler.ts`, replace `readMeshGeometry` and `readMeshMaterial` with inline-only versions:

```ts
function readMeshGeometry(mesh: TypeGpuNode): MeshResourceResult<TypeGpuGeometryData> | null {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const geometry = readInlineGeometry(child);
    if (geometry) return { node: child, value: geometry };
  }

  return null;
}

function readMeshMaterial(mesh: TypeGpuNode): MeshResourceResult<TypeGpuMaterialDescriptor> {
  for (let child = mesh.firstChild; child; child = child.nextSibling) {
    const material = readInlineMaterial(child);
    if (material) return { node: child, value: batchMaterialDescriptor(material) };
  }

  return { node: null, value: defaultMaterial() };
}
```

Update call sites from `readMeshGeometry(mesh, resources)` to `readMeshGeometry(mesh)` and from `readMeshMaterial(mesh, resources)` to `readMeshMaterial(mesh)`.

- [ ] **Step 4: Run the focused test and verify pass**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/svelte-typegpu/src/scene-compiler.ts packages/svelte-typegpu/src/scene-compiler.test.ts
git commit -m "Remove public mesh resource references"
```

## Task 2: Replace Resource Registry With Inline Descriptor Keys

**Files:**
- Modify: `packages/svelte-typegpu/src/resources.test.ts`
- Modify: `packages/svelte-typegpu/src/resources.ts`
- Modify: `packages/svelte-typegpu/src/material-descriptors.ts`

- [ ] **Step 1: Add failing tests for public registry removal and buffer identity**

In `packages/svelte-typegpu/src/resources.test.ts`, replace tests that assert `collectSceneResources`, `resolveGeometryReference`, and `resolveMaterialReference` with:

```ts
it('ignores public id when deriving procedural geometry keys', () => {
  const first = createElement('boxGeometry');
  const second = createElement('boxGeometry');

  setAttribute(first, 'id', 'first-name');
  setAttribute(second, 'id', 'second-name');
  setAttribute(first, 'width', 2);
  setAttribute(second, 'width', 2);

  expect(readInlineGeometry(first)?.key).toBe('box:2:1:1');
  expect(readInlineGeometry(second)?.key).toBe('box:2:1:1');
});

it('reads buffer geometry without a public layoutKey', () => {
  const vertices = new Float32Array([
    -1, 0, -1, 0, 1, 0, 0, 0, 1, 1, 1, 1,
    1, 0, -1, 0, 1, 0, 1, 0, 1, 1, 1, 1,
    0, 0, 1, 0, 1, 0, 0.5, 1, 1, 1, 1, 1
  ]);
  const node = createElement('bufferGeometry');

  setAttribute(node, 'key', 'terrain:v1');
  setAttribute(node, 'vertices', vertices);
  setAttribute(node, 'bounds', { min: [-1, 0, -1], max: [1, 0, 1] });

  expect(readInlineGeometry(node)).toMatchObject({
    key: 'terrain:v1@rev:3',
    kind: 'buffer',
    vertexCount: 3
  });
});
```

- [ ] **Step 2: Run resource tests and verify failure**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- resources.test.ts
```

Expected: FAIL because `bufferGeometry` still requires `layoutKey` or `vertexLayout` and registry helpers are still expected.

- [ ] **Step 3: Remove public registry helpers from resources**

In `packages/svelte-typegpu/src/resources.ts`:

- Remove `TypeGpuResourceCollection` registry maps if no remaining call site needs them.
- Remove `collectSceneResources`, `resolveGeometryReference`, `resolveMaterialReference`, `resolveGeometryResourceReference`, and `resolveMaterialResourceReference`.
- Change `readInlineGeometry` so `bufferGeometry` accepts valid `vertices` and `bounds` without `layoutKey`.
- Keep `key` as the optional buffer identity hint.

The `bufferGeometry` branch should read:

```ts
if (node.name === 'bufferGeometry') {
  const vertices = node.attributes.vertices;
  const bounds = boundsArg(node.attributes.bounds);
  if (!(vertices instanceof Float32Array) || !bounds) {
    return null;
  }

  return createBufferGeometryData({
    key: versionedKey(stringArg(node.attributes.key) ?? `buffer:${node.uid}`, node),
    vertices,
    indices: indicesArg(node.attributes.indices),
    bounds,
    topology: node.attributes.topology === 'triangle-list' ? 'triangle-list' : undefined
  });
}
```

- [ ] **Step 4: Simplify material descriptor resource inputs**

In `packages/svelte-typegpu/src/material-descriptors.ts`, remove `TypeGpuResourceCollection` imports and make string textures always mean URL-like texture sources:

```ts
export function textureSourceFor(value: unknown): TypeGpuTextureSource | null {
  if (typeof value === 'string' && value.length > 0) {
    return { kind: 'url', key: `url:${value}`, src: value };
  }

  // keep existing object handling
}
```

Change `samplerDescriptorFor(value, resources)` to `samplerDescriptorFor(value)` and keep object descriptor canonicalization.

- [ ] **Step 5: Run resource tests and typecheck**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- resources.test.ts
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/svelte-typegpu/src/resources.ts packages/svelte-typegpu/src/resources.test.ts packages/svelte-typegpu/src/material-descriptors.ts packages/svelte-typegpu/src/scene-compiler.ts
git commit -m "Use inline resource descriptor identity"
```

## Task 3: Remove Public InstancedMesh Authoring

**Files:**
- Modify: `packages/svelte-typegpu/src/scene-compiler.test.ts`
- Modify: `packages/svelte-typegpu/src/component-renderer.test.ts`
- Modify: `packages/svelte-typegpu/src/scene-compiler.ts`
- Modify: `packages/svelte-typegpu/src/primitives.test.ts`
- Modify: `packages/svelte-typegpu/src/primitives.ts`

- [ ] **Step 1: Add failing tests that direct meshes batch automatically**

Add this test to `packages/svelte-typegpu/src/scene-compiler.test.ts`:

```ts
it('batches repeated inline meshes without public instancedMesh', () => {
  const root = createFragment();
  const scene = createElement('scene');

  for (let index = 0; index < 3; index += 1) {
    const mesh = createElement('mesh');
    const geometry = createElement('boxGeometry');
    const material = createElement('standardMaterial');
    setAttribute(mesh, 'position', [index, 0, 0]);
    setAttribute(material, 'color', [index / 3, 0.5, 1, 1]);
    insert(mesh, geometry, null);
    insert(mesh, material, null);
    insert(scene, mesh, null);
  }

  insert(root, scene, null);

  const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

  expect(state.drawBatches).toHaveLength(1);
  expect(state.drawBatches[0].geometryKey).toBe('box:1:1:1');
  expect(state.drawBatches[0].instanceCount).toBe(3);
});
```

Add this test for removed public `instancedMesh`:

```ts
it('does not compile public instancedMesh nodes', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const instanced = createElement('instancedMesh');
  const geometry = createElement('boxGeometry');

  setAttribute(instanced, 'instances', [{ id: 1 }]);
  insert(instanced, geometry, null);
  insert(scene, instanced, null);
  insert(root, scene, null);

  const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

  expect(state.drawBatches).toHaveLength(0);
});
```

- [ ] **Step 2: Add a component-loop batching test**

Add this test to `packages/svelte-typegpu/src/component-renderer.test.ts`:

```ts
it('renders each-loop component meshes as ordinary batchable mesh nodes', () => {
  const Scene = compileTypeGpuSource(`
    <script>
      const cubes = [
        { id: 'a', position: [0, 0, 0], color: [1, 0, 0, 1] },
        { id: 'b', position: [1, 0, 0], color: [0, 1, 0, 1] },
        { id: 'c', position: [2, 0, 0], color: [0, 0, 1, 1] }
      ];
    </script>

    {#snippet Cube(cube)}
      <mesh position={cube.position}>
        <boxGeometry width={1} height={1} depth={1}></boxGeometry>
        <standardMaterial color={cube.color}></standardMaterial>
      </mesh>
    {/snippet}

    <scene>
      {#each cubes as cube (cube.id)}
        {@render Cube(cube)}
      {/each}
    </scene>
  `);
  const root = createFragment();

  renderer.render(Scene, { target: root });

  const scene = onlyElement(root);
  const meshes = scene.children.filter((node) => node.name === 'mesh');

  expect(meshes).toHaveLength(3);
  for (const mesh of meshes) {
    expect(mesh.children.map((child) => child.name)).toEqual(['boxGeometry', 'standardMaterial']);
  }
});
```

This proves component/snippet composition resolves to normal mesh nodes before scene compilation. The draw-batch behavior is covered by the previous direct mesh compiler test because the compiler only sees the resolved node tree.

- [ ] **Step 3: Run tests and verify failure**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts component-renderer.test.ts primitives.test.ts
```

Expected: FAIL because `instancedMesh` still compiles and is still treated as a primitive.

- [ ] **Step 4: Remove instancedMesh scene compiler branch**

In `packages/svelte-typegpu/src/scene-compiler.ts`:

- Remove the `else if (node.name === 'instancedMesh')` branch in `collectDrawItemsFromNode`.
- Remove `readInstancedMeshDrawItems`.
- Remove helper functions only used by `readInstancedMeshDrawItems`, such as instance callback readers, if unused elsewhere.

Keep draw-batch grouping unchanged. Direct repeated meshes should still batch because `createDrawBatchCache` groups compatible `TypeGpuMeshDrawItem`s.

- [ ] **Step 5: Remove instancedMesh primitive dirty behavior**

In `packages/svelte-typegpu/src/primitives.ts`:

- Remove `['instanced-mesh', 'instancedMesh']` alias.
- Remove `instancedMesh` from mesh-name sets.
- Remove `instanceBatchAttributes` and `instanceDataAttributes` handling if no longer used by `mesh` or `model`.

Update `packages/svelte-typegpu/src/primitives.test.ts` to stop expecting `instancedMesh` aliasing or dirty behavior.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts component-renderer.test.ts primitives.test.ts draw-batch-cache.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/svelte-typegpu/src/scene-compiler.ts packages/svelte-typegpu/src/scene-compiler.test.ts packages/svelte-typegpu/src/component-renderer.test.ts packages/svelte-typegpu/src/primitives.ts packages/svelte-typegpu/src/primitives.test.ts
git commit -m "Remove public instanced mesh authoring"
```

## Task 4: Remove Demo-Specific Core Animation Props

**Files:**
- Modify: `packages/svelte-typegpu/src/types.ts`
- Modify: `packages/svelte-typegpu/src/scene-compiler.ts`
- Modify: `packages/svelte-typegpu/src/instance-data.ts`
- Modify: `packages/svelte-typegpu/src/typegpu-layouts.ts`
- Modify: `packages/svelte-typegpu/src/typegpu-pipeline.ts`
- Modify: `packages/svelte-typegpu/src/gpu-renderer.ts`
- Modify: related tests under `packages/svelte-typegpu/src/*.test.ts`

- [ ] **Step 1: Add failing tests that removed props no longer affect scene state**

In `packages/svelte-typegpu/src/scene-compiler.test.ts`, add:

```ts
it('ignores removed demo-specific scene and mesh animation props', () => {
  const root = createFragment();
  const scene = createElement('scene');
  const mesh = createElement('mesh');
  const geometry = createElement('boxGeometry');

  setAttribute(scene, 'scale', 3);
  setAttribute(scene, 'animationSpeed', 9);
  setAttribute(scene, 'colorShift', 120);
  setAttribute(mesh, 'phase', 4);
  setAttribute(mesh, 'spinSpeed', 5);
  setAttribute(mesh, 'color', [1, 0, 0, 1]);
  insert(mesh, geometry, null);
  insert(scene, mesh, null);
  insert(root, scene, null);

  const state = createSceneState(root, createTypeGpuSceneCache(), { dirty: Dirty.All });

  expect('scale' in state).toBe(false);
  expect('animationSpeed' in state).toBe(false);
  expect('colorShift' in state).toBe(false);
  expect(state.drawBatches[0].instanceCount).toBe(1);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts typegpu-layouts.test.ts typegpu-pipeline.test.ts gpu-renderer.test.ts
```

Expected: FAIL because scene state and shader layout still include demo uniforms.

- [ ] **Step 3: Remove scene demo uniform state**

In `packages/svelte-typegpu/src/types.ts`, remove `scale`, `animationSpeed`, and `colorShift` from `TypeGpuSceneState`.

In `packages/svelte-typegpu/src/scene-compiler.ts`, remove those fields from `readRenderSettings` and the returned scene state.

In `packages/svelte-typegpu/src/gpu-renderer.ts`, remove renderer fields and uniform writes for scene scale, animation speed, animation offset, and color shift.

- [ ] **Step 4: Remove mesh demo instance fields**

In `packages/svelte-typegpu/src/types.ts`, remove `phase` and `spinSpeed` from `TypeGpuMeshDrawItem`.

In `packages/svelte-typegpu/src/scene-compiler.ts`, stop reading `mesh.attributes.phase`, `mesh.attributes.spinSpeed`, and `mesh.attributes.color`.

In `packages/svelte-typegpu/src/instance-data.ts`, remove instance offsets dedicated only to phase/spin. Keep transform, material color, material scalar params, shadow flags, and interaction id data.

In `packages/svelte-typegpu/src/typegpu-pipeline.ts`, remove spin/pulse/color-shift shader code. The vertex shader should apply the resolved transform and scene camera matrices; material color should come from material/instance data.

- [ ] **Step 5: Update dirty tracking**

In `packages/svelte-typegpu/src/primitives.ts`, remove dirty handling for scene `scale`, `animationSpeed`, `colorShift`, and mesh `phase`, `spinSpeed`, `color`.

Update `packages/svelte-typegpu/src/primitives.test.ts` to assert those attributes return `Dirty.None`.

- [ ] **Step 6: Run focused tests**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test -- scene-compiler.test.ts primitives.test.ts typegpu-layouts.test.ts typegpu-pipeline.test.ts gpu-renderer.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/svelte-typegpu/src packages/svelte-typegpu/src/*.test.ts
git commit -m "Remove demo animation props from core renderer"
```

## Task 5: Migrate Example App To Descriptive Components

**Files:**
- Modify: `apps/example/src/Scene.typegpu.svelte`
- Modify: `apps/example/src/Quadrant.typegpu.svelte`
- Modify: `apps/example/src/Cube.typegpu.svelte`
- Modify: `apps/example/src/FeatureSphere.typegpu.svelte`
- Modify: `apps/example/src/Scene.typegpu.test.ts`
- Modify: supporting demo data files if needed

- [ ] **Step 1: Replace old authoring assertions with new API assertions**

In `apps/example/src/Scene.typegpu.test.ts`, change the public API source test to assert:

```ts
expect(source).not.toContain('<resources>');
expect(source).not.toContain('<instancedMesh');
expect(source).not.toMatch(/\sgeometry=/);
expect(source).not.toMatch(/\smaterial=/);
expect(source).not.toContain('animationSpeed');
expect(source).not.toContain('colorShift');
expect(quadrantSource).not.toContain('<instancedMesh');
expect(cubeSource).toContain('<boxGeometry');
expect(cubeSource).toContain('<standardMaterial');
expect(sphereSource).toContain('<sphereGeometry');
expect(sphereSource).toContain('<standardMaterial');
```

Change render-tree assertions to look for many `mesh` nodes with inline child geometry/material nodes instead of `<resources>` and `<instancedMesh>`.

- [ ] **Step 2: Run example tests and verify failure**

Run:

```bash
pnpm --filter example --fail-if-no-match test -- Scene.typegpu.test.ts
```

Expected: FAIL because the example still uses resources and `instancedMesh`.

- [ ] **Step 3: Rewrite feature components inline**

In `apps/example/src/Cube.typegpu.svelte`, replace `geometry="cube"` and `material="featureMaterial"` with:

```svelte
<mesh
  role="button"
  tabindex="0"
  aria-label={ariaLabel}
  {position}
  {scale}
  onclick={onActivate}
  onkeydown={activateFromKeyboard}
>
  <boxGeometry width={1} height={1} depth={1}></boxGeometry>
  <standardMaterial {color} roughness={0.18} metalness={0.28}></standardMaterial>
</mesh>
```

Remove `spinSpeed` from this component's props.

In `apps/example/src/FeatureSphere.typegpu.svelte`, use:

```svelte
<mesh
  role="button"
  tabindex="0"
  aria-label={ariaLabel}
  {position}
  onclick={onActivate}
>
  <sphereGeometry radius={0.5} widthSegments={24} heightSegments={12}></sphereGeometry>
  <standardMaterial {color} roughness={0.18} metalness={0.28}></standardMaterial>
</mesh>
```

- [ ] **Step 4: Rewrite quadrants as normal Svelte loops**

In `apps/example/src/Quadrant.typegpu.svelte`, replace `<instancedMesh>` with:

```svelte
{#each quadrant.cubes as cube (getKey(cube))}
  {@const transform = getTransform(cube)}
  <mesh position={transform.position} scale={transform.scale}>
    <boxGeometry width={1} height={1} depth={1}></boxGeometry>
    <phongMaterial
      color={getColor(cube)}
      map="/textures/checker.svg"
      sampler={{ addressModeU: 'repeat', addressModeV: 'repeat' }}
    ></phongMaterial>
  </mesh>
{/each}
```

- [ ] **Step 5: Remove scene-level resources and demo animation props**

In `apps/example/src/Scene.typegpu.svelte`:

- Delete the `<resources>` block.
- Remove `scale={sceneScale}`, `{animationSpeed}`, and `colorShift={controls.hue}` from `<scene>`.
- Remove `spinSpeed` props from `<Cube>` and `<FeatureSphere>`.
- If the scene still needs visible animation, compute `rotation` values in Svelte state and pass them as ordinary `rotation` props.

- [ ] **Step 6: Run example tests**

Run:

```bash
pnpm --filter example --fail-if-no-match test -- Scene.typegpu.test.ts App.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/example/src
git commit -m "Migrate example app to inline scene authoring"
```

## Task 6: Migrate Docs Examples And Snippets

**Files:**
- Modify: `README.md`
- Modify: `apps/docs/src/snippets/doc-snippets.ts`
- Modify: `apps/docs/src/examples/**/*.typegpu.svelte`
- Modify: `apps/docs/src/examples/**/*.ts` only where geometry data no longer needs public `layoutKey`
- Modify: `apps/docs/src/examples/registry.test.ts`
- Modify generated docs files after running generator

- [ ] **Step 1: Update docs tests to forbid removed public API**

In `apps/docs/src/examples/registry.test.ts`, add these assertions inside the metadata loop:

```ts
expect(example.code).not.toContain('<resources>');
expect(example.code).not.toContain('<instancedMesh');
expect(example.code).not.toMatch(/\sgeometry="[^"]+"/);
expect(example.code).not.toMatch(/\smaterial="[^"]+"/);
expect(example.code).not.toContain('layoutKey=');
```

Update the two-boxes assertion from:

```ts
expect(twoBoxes).toContain('layoutKey="position:normal:uv:color"');
```

to:

```ts
expect(twoBoxes).not.toContain('layoutKey=');
```

- [ ] **Step 2: Run docs tests and verify failure**

Run:

```bash
pnpm --filter docs --fail-if-no-match test -- registry.test.ts
```

Expected: FAIL because docs examples still use resources, string references, or `layoutKey`.

- [ ] **Step 3: Rewrite README and overview snippet**

In `README.md` and `apps/docs/src/snippets/doc-snippets.ts`, replace the example scene with:

```svelte
<scene clearColor={[0.067, 0.078, 0.102, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[4, 3, 6]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={100}
  ></perspectiveCamera>

  <ambientLight color={[1, 1, 1]} intensity={0.25}></ambientLight>
  <directionalLight rotation={[-0.8, 0.4, 0]} intensity={1.4}></directionalLight>

  <mesh position={[0, 1, 0]}>
    <boxGeometry width={1} height={1} depth={1}></boxGeometry>
    <standardMaterial color={color} roughness={0.3} metalness={0.1}></standardMaterial>
  </mesh>
</scene>
```

- [ ] **Step 4: Rewrite docs scene meshes inline**

For each docs example:

- Replace `<resources>` geometry/material declarations with inline children on each `<mesh>`.
- Replace `geometry="..."` and `material="..."` with child geometry/material nodes.
- Replace `layoutKey="position:normal:uv:color"` with no layout prop.
- Keep declarative features such as drag handlers, model `src`, shadows, and shader passes.

For two boxes, each `SceneBox` should render:

```svelte
<mesh {position} quaternion={boxRotation} drag="rotate" ondragmove={onDragMove}>
  <bufferGeometry key={geometryKey} vertices={vertices} bounds={boxBounds}></bufferGeometry>
  <basicMaterial color={[1, 1, 1, 1]} cullMode="none"></basicMaterial>
</mesh>
```

For simple shadow, the floor should render:

```svelte
<mesh position={[0, 0, 0]} castShadow receiveShadow>
  <planeGeometry width={5} height={5}></planeGeometry>
  <phongMaterial color={[0.5, 0.4, 0.7, 1]} roughness={0.68} metalness={0} cullMode="none"></phongMaterial>
</mesh>
```

- [ ] **Step 5: Regenerate docs samples**

Run:

```bash
pnpm --filter docs --fail-if-no-match run generate:typegpu
```

Expected: generated `apps/docs/src/generated/**` files update with inline authoring output.

- [ ] **Step 6: Run docs tests**

Run:

```bash
pnpm --filter docs --fail-if-no-match test
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add README.md apps/docs/src apps/docs/public apps/docs/scripts
git commit -m "Migrate docs to declarative inline authoring"
```

## Task 7: Clean Public Exports And Type Surface

**Files:**
- Modify: `packages/svelte-typegpu/src/index.ts`
- Modify: `packages/svelte-typegpu/src/types.ts`
- Modify: package tests as needed

- [ ] **Step 1: Search for removed public concepts**

Run:

```bash
rg "resources|instancedMesh|instanced-mesh|geometry=|material=|layoutKey|spinSpeed|phase|animationSpeed|colorShift" README.md apps packages docs/superpowers/specs/2026-05-30-declarative-scene-authoring-api-design.md
```

Expected: only the approved design spec and historical plan/spec files mention removed concepts as removed concepts. Active README, app, docs, and package code should not expose them publicly.

- [ ] **Step 2: Remove stale exported types**

In `packages/svelte-typegpu/src/types.ts`, remove types that only supported removed public APIs. Keep internal types if still used by renderer caches.

In `packages/svelte-typegpu/src/index.ts`, stop exporting removed public types.

- [ ] **Step 3: Run package tests**

Run:

```bash
pnpm --filter svelte-typegpu --fail-if-no-match test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/svelte-typegpu/src/index.ts packages/svelte-typegpu/src/types.ts packages/svelte-typegpu/src/*.test.ts
git commit -m "Clean declarative renderer public type surface"
```

## Task 8: Full Verification

**Files:**
- No planned source edits.

- [ ] **Step 1: Run full test suite**

Run:

```bash
pnpm test
```

Expected: PASS.

- [ ] **Step 2: Run full build if available**

Run:

```bash
pnpm build
```

Expected: PASS. If no root build script exists, record the package scripts that were run instead.

- [ ] **Step 3: Run docs smoke test**

Run:

```bash
pnpm --filter docs --fail-if-no-match dev
```

Open the docs app and verify these routes render without console errors:

- `/examples/two-boxes`
- `/examples/phong-reflection`
- `/examples/simple-shadow`
- `/examples/interactive-orbit-field`

Expected: examples render with inline declarative authoring and no public resource registry.

- [ ] **Step 4: Final search**

Run:

```bash
rg "<resources|<instancedMesh|geometry=\"|material=\"|layoutKey=|spinSpeed|phase|animationSpeed|colorShift" README.md apps packages
```

Expected: no matches in active public examples/docs/source, except internal implementation names that are still deliberately private.

- [ ] **Step 5: Commit any verification-only updates**

If generated files or snapshots changed during verification:

```bash
git add README.md apps packages
git commit -m "Verify declarative scene authoring migration"
```

If nothing changed, do not create an empty commit.
