# Building with the TypeGPU renderer

This is a consumer-oriented snapshot of the current branch, based on the public
exports, compiler, scene/resource readers, examples and compatibility tests.
It is not a claim that every feature in a general-purpose 3D engine exists here.

**In short:** we have a declarative, reactive scene renderer with useful Svelte
composition, interaction, static assets and TypeGPU shader integration. We do not
yet have a complete game engine, asset pipeline or arbitrary declarative WebGPU
render graph.

## 1. The mental model

```text
App.svelte                  Ordinary DOM controls, layout and application state
  World.typegpu.svelte       One native canvas and its renderer lifetime
    scene                   Render settings and scene content
      perspectiveCamera     View of the world
      lights                Illumination
      group                 Shared spatial transform
        mesh                An object: geometry + material + transform + events
        model               Imported static geometry and materials
      frameTask             Optional synchronous simulation behavior
```

- A lowercase primitive describes renderer-owned data, not a DOM element.
- A capitalized component is your reusable Svelte abstraction. `Tree`, `House`,
  `Player`, `Box` and `GravityFrameTask` can be components you write.
- There is no built-in `<box>`, `<shape>`, `<world>` or `<meshCollection>` API.
  A box is currently `<mesh><boxGeometry /><standardMaterial /></mesh>`.
- You connect components with props, callbacks, bindings, context and snippets.
  No renderer IDs are needed. Svelte list keys are ordinary application identity.
- Svelte updates the scene's values. The renderer determines affected data and
  prepares TypeGPU resources and draws. You do not upload buffers for each click.
- Coordinates are scene units, not pixels. The examples use Y as up. Mesh Euler
  rotations use radians; camera `fov` uses degrees. `planeGeometry` lies in XZ.
- A scene does not define a bounded volume, terrain or physics space. Those are
  application concepts assembled from geometry, assets and behavior.

## 2. Setup and boundaries

Use the repository's pinned Svelte custom-renderer preview. The current pin is
`17e37a51bc539cdb6a923b424e5746fc6505ba89` (package version 5.57.0); this is the
branch's dependency, not a statement about the newest upstream release. The
package uses TypeGPU 0.11.6 and is still experimental (`svelte-typegpu` 0.0.1).
See the [README](../README.md#using-the-svelte-pr-preview) for installation.

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { typegpuSvelte } from 'svelte-typegpu/vite';

export default defineConfig({ plugins: [typegpuSvelte()] });
```

This replaces the ordinary Svelte Vite plugin. It selects DOM versus GPU
compilation and handles the canvas boundary. HMR is currently disabled.

Author a viewport in a dedicated `.typegpu.svelte` file and import it directly
from ordinary Svelte. A viewport has exactly one unconditional top-level canvas;
put `{#if}` scene switching inside it. At most one scene may be mounted at once.
Scene-only components have no canvas and can be composed inside that viewport.

The canvas is real HTML: CSS sizing, native events, accessibility attributes,
attachments, `bind:this`, and read-only size bindings work. DOM buttons, headings,
loading labels and overlays belong in the ordinary `.svelte` parent. CSS sizes
the canvas; the renderer owns its physical drawing-buffer dimensions and DPR.

SSR emits the canvas shell, not a server-rendered picture of the world. Hydration
retains that canvas. The scene has its own Svelte mount with inherited context;
parent error boundaries and async pending counts do not span that mount.

## 3. Supported renderer features

| Area | Current authoring API | Important qualification |
| --- | --- | --- |
| Structure | `scene`, `group`, `mesh`, `model` | Nested transforms and hierarchy visibility; not DOM layout |
| Transforms | `position`, `rotation`, `quaternion`, `scale`, `matrix` on spatial objects | Small reactive values; changing a group affects its descendants |
| Geometry | `boxGeometry`, `planeGeometry`, `sphereGeometry`, `bufferGeometry` | Triangle lists; no built-in cylinder, torus, lines, points or text |
| Custom geometry | Float32 vertex data, optional Uint16/Uint32 indices, explicit bounds | Fixed 12-float vertex layout: position 3, normal 3, UV 2, color 4 |
| Materials | `basicMaterial`, `phongMaterial`, `standardMaterial`, `shaderMaterial` | Unlit, Phong, roughness/metalness shading, or a custom TypeGPU fragment |
| Material values | Color, opacity, roughness, metalness, specular exponent, custom uniforms | Not a complete glTF PBR material system |
| Material state | Blend mode, culling, depth testing/writes, render order | Opaque/transparent changes can require rebuilding batches/pipelines |
| Textures | Material `map` URL or texture descriptor; `sampler` descriptor | URL, embedded and raw data textures; not a full texture-map suite |
| Cameras | `perspectiveCamera`, `orthographicCamera` | One active view per scene; live camera state survives unrelated scene edits |
| Controls | `orbitControls`; nested `controls`, `pointerControls`, `keyboardControls` | Orbit and fly mode available; fly is not a collision-aware player controller |
| Camera decomposition | `cameraPose`, `cameraLens` inside perspective cameras | Optional existing syntax; ordinary camera props usually suffice |
| Lights | Ambient, hemisphere, directional, point, spot | Maximum 32 collected lights |
| Shadows | Mesh/model `castShadow` and `receiveShadow`, directional-light shadow settings | Only the first eligible directional light casts shadows; no point/spot shadows |
| Assets | `model src`, `model data`, or `model asset`; exported `loadModel` | Static GLB 2.0 subset and OBJ geometry, detailed below |
| Interaction | Click, double-click, context menu, wheel, pointer and drag events | CPU bounding-box picking, not triangle-accurate or alpha-aware picking |
| Event composition | Capture, target, bubble; group hover boundaries; stop/cancel methods | Scene events wrap browser events; they are not DOM PointerEvents |
| Attachments | `{@attach}` on scene nodes or the native canvas | Scene attachment target is a TypeGpuNode; canvas target is HTMLCanvasElement |
| Event subscriptions | `onNodeEvent` with capture, once, passive, AbortSignal | Ordinary event props remain the normal consumer API |
| Animation | Reactive props with Tween/Spring; `frameTask` for simulation | No independent renderer-specific motion adapter needed |
| Custom GPU shading | TypeGPU fragments on mesh materials and fullscreen `shaderPass` | No public custom vertex stage, compute primitive or render-target graph |
| Scheduling | `demand`, `always`, `manual`; reactive DPR cap | Demand defaults to idle when settled; manual never requests renderer RAF |
| Lifecycle | Async startup cleanup, disposal, shared-resource retention/pruning | No automatic GPU device-loss recovery |
| Diagnostics | Unknown-primitive and definitely invalid-parent warnings; unsupported-directive errors | Comprehensive original-source scene-element editor typing is still missing |

`texture` and `sampler` occur in internal invalidation code, but they are **not
currently consumed as declarative resource elements**. Write
`<standardMaterial map="/textures/stone.png" sampler={{ minFilter: 'linear' }} />`,
not a nested `<texture>` element.

### Svelte compatibility

Supported and covered by existing tests:

- `$state`, `$derived`, `$effect`, component props and ordinary lifecycle.
- Small deep-state vectors, colors, material descriptors and uniforms.
- `{#if}`, keyed `{#each}`, `{#key}`, `{#await}`, `{#snippet}` and `{@render}`.
- Scene components, snippet props, children snippets, context, prop spreads.
- Component `$bindable` and component `bind:this`.
- Dynamic `<svelte:element>` for geometry/material selection.
- Store auto-subscriptions, `SvelteMap`, `SvelteSet`.
- Tween, Spring, their `.of` factories, reduced-motion and media-query signals.
- Native canvas attributes, scoped CSS, focus/keyboard events and size bindings.
- Attachment forwarding and cleanup on replacement/unmount.

Important limits:

- No actions (`use:`), by design. Use attachments.
- No scene CSS or `class:` / `style:` directives. Native canvas class/style
  attributes are supported; direct scene props express appearance.
- `<mesh bind:this>`, host `transition:`, `in:`, `out:` and `animate:` are rejected
  by the pinned compiler. Retain a scene node with an attachment when necessary.
- Scene snippets must be authored in `.typegpu.svelte`, not DOM components.
- `<svelte:window>`, `<svelte:document>` and `<svelte:body>` belong in the DOM parent.
  Reactive window values can still drive scene props, subject to the documented
  upstream subscription/SSR limitations.
- Use ordinary promise-based `{#await}` today. Async expressions and boundary
  pending snippets remain gated on unresolved pinned-preview lifecycle issues.
- Error boundaries have a tested restricted form: declare `failed` outside the
  boundary and pass it as a prop. Inline failure snippets hit an upstream bug.
- Canvas keyboard events work, but scene objects do not have automatic focus,
  tab navigation or accessible DOM counterparts.

The detailed contract is in [Svelte compatibility](svelte-compatibility.md).

## 4. Example: a clickable box

```svelte
<!-- SimpleViewport.typegpu.svelte -->
<script>
  let selected = $state(false);
</script>

<canvas frameloop="demand" aria-label="Selectable box">
  <scene clearColor={[0.08, 0.09, 0.11, 1]}>
    <perspectiveCamera active position={[4, 3, 6]} target={[0, 0, 0]} />
    <ambientLight intensity={0.6} />
    <directionalLight position={[3, 5, 4]} lookAt={[0, 0, 0]} intensity={1.2} />
    <mesh onclick={() => selected = !selected}>
      <boxGeometry />
      <standardMaterial
        color={selected ? [1, 0.3, 0.2] : [0.2, 0.7, 0.5]}
        roughness={0.5} metalness={0}
      />
    </mesh>
  </scene>
</canvas>

<style>
  canvas { width: 100%; height: 400px; }
</style>
```

```svelte
<!-- SimplePage.svelte -->
<script>
  import SimpleViewport from './SimpleViewport.typegpu.svelte';
</script>

<h1>Box preview</h1>
<SimpleViewport />
```

The click changes Svelte state, the material value changes, and demand rendering
wakes. No manual invalidation, canvasProps, sceneProps or event attachment.

## 5. Example: reusable objects, motion and snippets

You can make `<Box />` an ordinary scene component. It owns its hover behavior
and can be used in lists or snippets without adding a wrapper host node.

```svelte
<!-- Box.typegpu.svelte -->
<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Spring } from 'svelte/motion';
  import type { Vector3Tuple } from 'svelte-typegpu';

  let { position = [0, 0, 0], selected = false, onclick = () => {} }: {
    position?: Vector3Tuple;
    selected?: boolean;
    onclick?: () => void;
  } = $props();

  const lift = new Spring(0);
  onDestroy(() => { void lift.set(lift.current, { instant: true }); });
</script>

<mesh
  position={[position[0], position[1] + lift.current, position[2]]}
  onpointerenter={() => lift.target = 0.4}
  onpointerleave={() => lift.target = 0}
  {onclick}
>
  <boxGeometry />
  <standardMaterial
    color={selected ? [1, 0.3, 0.2] : [0.2, 0.7, 0.5]}
    roughness={0.5} metalness={0}
  />
</mesh>
```

There is no `let:item`. Svelte 5 snippet parameters provide composition:

```svelte
<!-- ObjectList.typegpu.svelte -->
<script lang="ts" generics="Item">
  import type { Snippet } from 'svelte';
  let { items, children }: {
    items: readonly Item[];
    children: Snippet<[Item]>;
  } = $props();
</script>

{#each items as item (item)}
  {@render children(item)}
{/each}
```

```svelte
<!-- GalleryViewport.typegpu.svelte -->
<script>
  import Box from './Box.typegpu.svelte';
  import ObjectList from './ObjectList.typegpu.svelte';

  const items = $state([
    { x: -2, selected: false },
    { x: 0, selected: false },
    { x: 2, selected: false }
  ]);
</script>

<canvas aria-label="Interactive box gallery">
  <scene>
    <perspectiveCamera active position={[0, 3, 9]} />
    <ambientLight intensity={0.8} />
    <ObjectList {items}>
      {#snippet children(item)}
        <Box position={[item.x, 0, 0]} selected={item.selected}
          onclick={() => item.selected = !item.selected} />
      {/snippet}
    </ObjectList>
  </scene>
</canvas>

<style>
  canvas { width: 100%; height: 420px; }
</style>
```

For lists whose records are replaced, key by a stable application key instead
of object identity. Compatible geometry/material configurations are batched
automatically; a Svelte component per object does not necessarily mean a draw
call per object. Per-component reactive work still has CPU cost.

For reduced-motion behavior, use `prefersReducedMotion` to choose immediate
targets as in the existing Svelte Motion example. Stop active motion producers
on destruction; stopping drawing does not stop Svelte's own animation producer.

## 6. Example: reusable per-frame behavior

A component can wrap a `frameTask` and a child scene snippet. This spins a group,
so it works with a procedural mesh, imported asset or larger assembly.

```svelte
<!-- Spin.typegpu.svelte -->
<script lang="ts">
  import type { Snippet } from 'svelte';
  import type { TypeGpuFrameContext } from 'svelte-typegpu';
  let { children, speed = 0.5, paused = false }: {
    children: Snippet;
    speed?: number;
    paused?: boolean;
  } = $props();
  let angle = $state(0);

  function update({ delta }: TypeGpuFrameContext) {
    angle = (angle + delta * speed) % (Math.PI * 2);
  }
</script>

<frameTask {update} active={!paused && speed !== 0} />
<group rotation={[0, angle, 0]}>
  {@render children()}
</group>
```

The renderer runs tasks, flushes Svelte updates, synchronizes the scene and draws
in that frame. Active continuous tasks keep demand rendering awake. Pausing or
unmounting the task lets it settle. No extra RAF loop is needed.

`delta` is seconds, starts at zero, and is capped at 0.05. Tasks are synchronous,
ordered by priority then tree order. `continuous={false}` means run only on
frames requested for other reasons. For real physics, integrate a physics engine
through this hook; `frameTask` is scheduling, not a physics solver.

## 7. Example: a small asset-based world

This uses the APIs we have now, not proposed `<terrain>`, `<physics>` or
`<assetLoader>` primitives. It combines a ground mesh, a house, repeated trees,
a moving landmark, orbit controls, shadows, loading states and DOM controls.

The URLs below are **application-supplied assets**, not files included in this
repository. Put compatible static GLBs at those public URLs. Author their origins
at ground level, Y-up, and at a consistent scale; transforms may need adjustment
for the actual models. This is an illustrative world, not a tested visual scene
with those particular assets. `Spin` is the complete component above.

```svelte
<!-- WorldViewport.typegpu.svelte -->
<script lang="ts">
  import { getAbortSignal } from 'svelte';
  import { loadModel } from 'svelte-typegpu';
  import Spin from './Spin.typegpu.svelte';

  let {
    treeUrl = '/models/tree.glb',
    houseUrl = '/models/house.glb',
    night = false,
    paused = false,
    onselect = (_name: string) => {},
    onloaderror = (_error: unknown) => {}
  } = $props();

  const assets = $derived.by(() => {
    const signal = getAbortSignal();
    return Promise.all([
      loadModel(treeUrl, { signal }),
      loadModel(houseUrl, { signal })
    ]);
  });

  const trees = [
    { key: 'west', x: -5, z: -3 },
    { key: 'east', x: 5, z: -3 },
    { key: 'north', x: 0, z: -7 }
  ];
</script>

<canvas aria-label="Small interactive world" frameloop="demand"
  maxDevicePixelRatio={1.5}>
  <scene clearColor={night ? [0.025, 0.03, 0.05, 1] : [0.5, 0.72, 0.9, 1]}>
    <perspectiveCamera active position={[12, 9, 16]} target={[0, 1, 0]}
      near={0.1} far={200}>
      <controls mode="orbit" minDistance={3} maxDistance={40}>
        <pointerControls wheel="zoom" touch="orbit-pinch" />
      </controls>
    </perspectiveCamera>

    <hemisphereLight skyColor={[0.8, 0.9, 1]} groundColor={[0.2, 0.25, 0.2]}
      intensity={night ? 0.15 : 0.6} />
    <directionalLight position={[8, 12, 6]} lookAt={[0, 0, 0]}
      intensity={night ? 0.2 : 1.4} castShadow shadowMapSize={2048} />
    <pointLight position={[0, 3, 2]} color={[1, 0.75, 0.4]}
      intensity={night ? 8 : 0} range={12} />

    <mesh receiveShadow>
      <planeGeometry width={30} height={30} />
      <standardMaterial color={[0.25, 0.48, 0.3]} roughness={0.95}
        metalness={0} cullMode="none" />
    </mesh>

    {#await assets}
      <mesh position={[0, 1, 0]}>
        <boxGeometry />
        <basicMaterial color={[0.45, 0.45, 0.45]} />
      </mesh>
    {:then [tree, house]}
      <model asset={house} castShadow receiveShadow
        onclick={() => onselect('House')} />
      {#each trees as placement (placement.key)}
        <model asset={tree} position={[placement.x, 0, placement.z]}
          castShadow receiveShadow
          onclick={() => onselect(`Tree: ${placement.key}`)} />
      {/each}
    {:catch error}
      <mesh position={[0, 1, 0]} onclick={() => onloaderror(error)}>
        <boxGeometry />
        <basicMaterial color={[1, 0.1, 0.1]} />
      </mesh>
    {/await}

    <group position={[0, 1, 5]}>
      <Spin {paused}>
        <mesh castShadow onclick={() => onselect('Landmark')}>
          <boxGeometry width={0.6} height={2} depth={0.6} />
          <standardMaterial color={[0.8, 0.2, 0.4]} metalness={0} />
        </mesh>
      </Spin>
    </group>
  </scene>
</canvas>

<style>
  canvas { display: block; width: 100%; height: 560px; }
  @media (max-width: 600px) { canvas { height: 400px; } }
</style>
```

```svelte
<!-- WorldPage.svelte -->
<script>
  import WorldViewport from './WorldViewport.typegpu.svelte';
  let night = $state(false);
  let paused = $state(false);
  let selected = $state('Nothing selected');
  let failure = $state('');
</script>

<label><input type="checkbox" bind:checked={night} /> Night</label>
<label><input type="checkbox" bind:checked={paused} /> Pause landmark</label>
<p aria-live="polite">{selected}</p>
{#if failure}<p role="alert">{failure}</p>{/if}
<WorldViewport {night} {paused}
  onselect={(name) => selected = name}
  onloaderror={(error) => failure = String(error)} />
```

The tree is loaded once and shared across three models. `loadModel` itself is
not a global cache: sharing the promise/result is intentional. URL changes or
component destruction abort these component-owned fetches. Parsing is synchronous;
it cannot be interrupted midway. `{#await}` ignores obsolete results.

The red error object reports the loader error when clicked. For production,
also expose loading/error state in DOM UI without requiring a 3D click, and
provide retry. A resolved CPU model is not a guarantee that every GPU texture is
decoded; textures can initially render with the white fallback.

While the landmark spins, demand mode intentionally renders continuously. Pause
it and the world idles after input/loading work settles. Switching day/night
changes props; it does not recreate the canvas. Camera controls retain their live
view through these changes. No collision prevents the camera entering a house.

For a simpler asset path, `<model src="/models/house.glb" />` works. Identical
URLs share a request within a root. The explicit loader is useful when you need
Svelte loading/error branches or caller-owned asset retention across unmounts.

### Composing the playable example

The runnable asset world now has `Tree`, `Rock`, `Log`, `Tent`, `Campfire`,
`Bridge` and `Sign` scene components. Import them from their `.typegpu.svelte`
files and pass the already-loaded, shared `WorldAssets` object:

```svelte
<Tree {assets} kind="pine" position={[-8, 0.15, -6]} scale={3} />
<Tree {assets} kind="oak" position={[-5, 0.12, -6]} scale={2.4} />
<Rock {assets} position={[1.7, 0.075, 0]} scale={1.5} />
<Tent {assets} position={[-3.8, 0.15, -1.8]} scale={3}
  rotation={[0, Math.PI, 0]} onclick={() => selected = 'tent'} />
```

Each leaf selects its asset and forwards transforms, visibility and click events
to a single `<model>`, with overridable cast/receive-shadow defaults. `Tree` selects
pine or oak. `Terrain`, `WorldLighting` and `SelectionMarker` encapsulate other
world features; `Canoe`, `Player` and `WorldCamera` retain their existing behavior.
Svelte component boundaries add no scene groups or GPU draws by themselves.

The entry still loads each asset once and prepares LOD families once. Do not
load models or call `createModelLod` inside every tree. The large landscape uses
keyed `{#each}` blocks containing the same components as the campsite; geometry
sharing and renderer instancing cross component boundaries.

### What GLB/OBJ support actually means

- GLB: static triangle meshes, positions, normals, UV0, supported indices, node
  transforms baked into geometry, base-color factors/embedded base-color images,
  and numeric roughness/metalness factors.
- OBJ: positions, normals, UVs and triangulated faces. No MTL material import.
- Not implemented: skeletal animation, animation clips, morph targets, live
  imported hierarchy/joint control, external `.gltf` dependency loading, Draco/
  Meshopt decoding, sparse accessors, full glTF material extensions, normal maps,
  metallic-roughness maps, occlusion/emissive maps and imported alpha-mode parity.
- Unsupported GLB primitives can be skipped rather than failing the whole load.
  Check that `asset.meshes.length > 0` and visually verify real production assets;
  a resolved request is not proof that the entire source asset was supported.
- Model loading currently expands/bakes static vertex data. It is not a streaming,
  compressed-mesh or zero-copy asset pipeline. Budget large assets accordingly.

## 8. Where TypeGPU enters the picture

Ordinary scenes do not require shader code. For custom shading, author TypeGPU
fragment functions in `.ts` modules and pass them to `shaderMaterial` or
`shaderPass`. Keep the function identity stable and animate uniform values.

Mesh fragments use the renderer's fixed input signature (color, normal, material,
world position, UV, vertex color and material extras). The exported
`materialBindGroupLayout` gives access to eight vec4 value slots, `value0` through
`value7`. Scalars fill the first lane. Different shader materials with authored
uniforms own separate bindings, which can split draws even for equal values.

Existing complete examples:

- [Motion marker fragment](../apps/docs/src/examples/svelte-motion/marker-fragment.ts)
  and [its component](../apps/docs/src/examples/svelte-motion/MotionMarker.typegpu.svelte):
  reactive material uniforms with TypeGPU shading.
- [Smoky mesh material](../apps/docs/src/examples/multiple-smoky-triangles/smoky-triangle-material.ts):
  custom mesh fragment and TypeGPU noise.
- [Fullscreen shader](../apps/docs/src/examples/disco-shader-pass/disco-fragment.ts)
  and [shader-pass scene](../apps/docs/src/examples/disco-shader-pass/DiscoShaderPass.typegpu.svelte).

Use exported typed layouts, not hard-coded bind-group numbers. A fullscreen
`shaderPass` does not automatically receive the previous scene color/depth as
textures. It is not yet a bloom/SSAO/compositor stack. Shader time alone does not
wake an idle demand scene: use `always` or an active continuous frame task.

## 9. Performance rules for consumers

Scenes now enable conservative camera-frustum culling automatically. Use
`<scene frustumCulling={false}>` for raw workload comparisons. The asset-world
example keeps that raw default and provides a Frustum culling checkbox.
`root.gpu.getRenderStats?.()` reports retained/candidate/submitted instances,
rejected instances, actual color draws/triangles, shadow triangles, culling CPU
time, bounds tests and range-budget fallbacks from the last rendered frame.

Culling retains component state, attachments, simulation, picking and resources.
It selects color-pass instance ranges from existing buffers; it does not stop
frame tasks or remove shadow casters. Large opaque batches are spatially ordered
on structural compilation and culled conservatively in clusters. Transparent
and depth-disabled draws retain authored order. Moving an object refits only
affected bounds; moving a camera never repacks instances. Missing/invalid bounds
remain visible. `bufferGeometry` bounds must enclose the actual geometry.
Custom vertex displacement also needs bounds enclosing its full motion, or
scene-level frustum culling must be disabled.

This is frustum culling, not occlusion culling. Cluster edges can submit
some off-screen instances. Highly fragmented selections fall back to a full
batch rather than unbounded draw calls. An overview containing the entire world
still submits every visible instance; authored LOD can reduce its geometry cost.

### Authored asset LOD

Prepare one shared asset with `createModelLod`, then use the existing `<model>`
primitive. This viewport receives already-loaded high/medium/low assets:

```svelte
<script lang="ts">
  import { createModelLod, type TypeGpuLoadedModel, type Vector3Tuple } from 'svelte-typegpu';
  let { high, medium, low, positions }: {
    high: TypeGpuLoadedModel; medium: TypeGpuLoadedModel; low: TypeGpuLoadedModel;
    positions: Vector3Tuple[];
  } = $props();
  const tree = $derived(createModelLod(high, [
    { maxScreenHeight: 80, asset: medium },
    { maxScreenHeight: 28, asset: low }
  ]));
</script>

<canvas>
  <scene>
    <perspectiveCamera position={[8, 6, 12]} target={[0, 0, 0]} />
    <ambientLight intensity={0.8} />
    {#each positions as position, index (index)}
      <model asset={tree} {position} onclick={() => console.log(index)} />
    {/each}
  </scene>
</canvas>
```

Thresholds are descending conservative projected heights in CSS pixels, not world
distances or physical framebuffer pixels. Object scale, field of view and
orthographic zoom affect selection. The optional third argument sets hysteresis
(default `0.1`): refine immediately above a threshold, coarsen below 90% of it.
Up to three alternatives are supported, in addition to the base asset.

Variants must preserve mesh count, names/order, transforms, vertex layout and
alpha mode. Their triangle counts must not increase. The base materials remain
active; this is geometry LOD, not material or component-subtree LOD. Geometry
bounds are unioned across levels. Advanced asset construction can use
`createGeometryLod` on individual loaded-model mesh geometries.

Levels are prewarmed and resident. Camera movement selects ordered ranges in the
same instance buffer, without Svelte remounts, transform uploads or resource
creation. Large batches conservatively choose detail per spatial cluster, so
some instances retain finer detail than strictly necessary. Fragmented selections
fall back to full-detail frustum ranges, not missing objects. Shadow geometry and
picking remain independent of color LOD. There is no built-in simplification,
crossfade, streaming or automatic generation of low-detail assets.

`getRenderStats()` adds `lodInstances`, `lodTrianglesSaved`, `lodCpuMs` and
`lodRangeFallbacks`. The asset-world LOD checkbox uses its shared 16x/4x/1x
flat-subdivision variants, preserving the original appearance. Its separate
**Distant meshes** checkbox appends an opt-in, simplified level below the original
GLB at 12 CSS pixels. This also makes LOD useful at 1x density. The example prepares
trees, rocks and logs once per shared asset with meshoptimizer, before assigning
the resulting families to existing components:

```ts
// Asset-world preparation, outside the placement loop and frame tasks.
const distant = await prepareDistantWorldAssets(originals);
const assets = lodWorldAssets(originals, 2, distant);
```

```svelte
<Tree {assets} kind="pine" position={[10, 0, -20]} />
```

These two preparation helpers belong to the example, not the renderer package.
No camera distance conditions or component unmounts are needed. Simplification
changes appearance slightly; it is not HLOD or a textured impostor. Unsupported
textured/alpha meshes keep their original geometry. See the
[distant-mesh measurements and limitations](./distant-meshes-results.md).

### Animation costs

1. Animate position/rotation/scale, colors and existing uniform values. Avoid
   rebuilding geometry, replacing shader functions or changing material types
   each frame. Scaling a box is different from rebuilding its dimensions.
2. Use keyed lists and stable assets. Compatible draw items share geometry,
   pipelines and instance storage; sharing an asset does not mean every imported
   material/primitive can collapse into one draw call.
3. Keep hot simulation state reasonably local. Svelte's targeted reactivity does
   not make rebuilding a world-sized array every frame free.
4. A parent transform necessarily affects all descendants. Large structural
   changes, resource changes, lighting changes and transparency-state changes
   can still take a full scene compilation path.
5. Treat bulk typed arrays and loaded assets as opaque, immutable resource inputs.
   In-place typed-array writes are not reactive. Replace inputs, and change an
   explicit resource key when replacing the contents it identifies.
6. Demand sleeps only when there is no work. Active continuous simulation is
   work. Manual mode stops renderer RAF, not independent Tween/Spring producers.
7. Hidden attached objects keep resources and component state. `{#if}` unmounts
   them and can release the last asset/texture owner. Choose deliberately.
8. Picking is input-driven and linear over eligible bounding boxes, not every
   frame. Attach interaction only where needed; scene-wide handlers can make
   every descendant eligible. Hover under a stationary pointer waits for input.
9. Monitor rendered FPS, browser callback cadence, CPU cost and GPU throughput
   separately. The canvas `onfps` callback measures delivered frames, not the
   monitor's refresh rate; a static demand scene correctly reports zero.

Existing regression suites exercise real compiled Tween/Spring components at
60/120/144 Hz, both external-producer/renderer callback orders, demand settling,
manual scheduling, disposal, exact upload ranges and GPU resource reuse. That
coverage is not a promise that any arbitrary world will sustain 144 FPS.

Concurrent camera, transform, material-value and listener updates also use the
incremental path when their dirty hints and resource state permit it. Camera
discovery is cached until the scene structure changes. Regression tests and a
desktop/mobile WebGPU probe cover this path; not all scene updates are incremental.

## 10. What's missing, and what should come next?

### Deliberately outside the current API

Actions, scene CSS, DOM elements inside the GPU tree and mandatory renderer-ID
wiring are not goals. Domain components can provide convenient names without
inventing a second reactive system.

### Gaps that matter for richer worlds

- **Asset reliability:** explicit supported-format diagnostics, visible loading/
  errors/retry, richer materials, animation clips/skinning and compressed assets.
- **World scale:** no built-in occlusion culling, automatic mesh simplification, world streaming,
  terrain system or spatially accelerated/triangle-accurate picking.
- **Visual rendering:** no environment lighting/HDR pipeline, built-in fog,
  cascaded/multiple shadow lights, full post-processing or built-in MSAA controls.
  Transparent rendering lacks general camera-depth sorting of instances.
- **Simulation:** no built-in physics/collision system, character controller,
  particle system or declarative GPU-compute/task-resource API.
- **Interaction/accessibility:** no general scene pointer-capture API, automatic
  object keyboard focus, accessible object tree, or browser-native 3D drag/drop.
- **Tooling/platform:** complete scene-element types, HMR, full upstream async/
  boundary compatibility, automatic device-loss recovery and WebGL fallback.
- **Rendering architecture:** one view per scene, not a multi-camera viewport
  compositor or arbitrary render-target/pass dependency graph.

The Asset World example at `/examples/asset-world` now provides a small world
with bundled GLB assets, selection, motion, loading and retry. Use it to prioritize
asset diagnostics/loading UX,
editor typing, picking/culling and material coverage. Add animation/physics only
when the target experience needs them. For the broader goal of declarative
TypeGPU itself, design typed resources, compute and pass dependencies as a
separate deliberate extension, not pretend that `frameTask` already provides it.

## Source map

- [Viewport contract](declarative-canvas-guide.md)
- [Svelte compatibility and limitations](svelte-compatibility.md)
- [Animation and frame tasks](scene-animation-guide.md)
- [Scene events](scene-events-guide.md)
- [Actual primitive inventory](../packages/svelte-typegpu/compiler/diagnostics.ts)
- [Geometry readers](../packages/svelte-typegpu/src/resources.ts)
- [Material readers](../packages/svelte-typegpu/src/material-descriptors.ts)
- [GLB importer](../packages/svelte-typegpu/src/glb-loader.ts)
- [OBJ importer](../packages/svelte-typegpu/src/obj-loader.ts)
- [Light and shadow limits](../packages/svelte-typegpu/src/lights.ts)
- [Picking implementation](../packages/svelte-typegpu/src/interaction-index.ts)
- [Render queue](../packages/svelte-typegpu/src/gpu-renderer.ts)

## Verification of this guide

All eight complete Svelte examples compile against the installed pinned compiler
in client/server and development/production modes: 32 successful checks, zero
warnings. All 19 local documentation/source links resolve. This is compiler
verification, not a full application build, TypeScript consumer check or rerun
of the renderer test suite. The world assets are illustrative; no live visual or
physical-refresh-rate claim is made for that example.
