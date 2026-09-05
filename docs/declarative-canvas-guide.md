# Declarative canvas viewports

The experimental viewport compiler lets a dedicated `.typegpu.svelte` component
own its native canvas. Import that component directly from an ordinary Svelte
page. Scene-only `.typegpu.svelte` components remain reusable inside it.

## Vite setup

Install the pinned Svelte preview from the README, then use the shared integration
instead of configuring the renderer filename rule yourself:

```ts
import { defineConfig } from 'vite';
import { typegpuSvelte } from 'svelte-typegpu/vite';

export default defineConfig({ plugins: [typegpuSvelte()] });
```

This replaces the ordinary `svelte()` plugin, not supplements it. It accepts its
options, but owns renderer selection and disables HMR for this experimental
integration. Custom build tools can use `compileTypeGpu` from
`svelte-typegpu/compiler`; consume both its JavaScript and CSS results, as with
the Svelte compiler. The docs generator uses this same compilation path.
Both integrations produce [scene authoring warnings](scene-diagnostics-guide.md)
for misspelled primitives and definitely misplaced resources or controls.

## Authoring

```svelte
<!-- Viewport.typegpu.svelte -->
<script>
  import { Spring } from 'svelte/motion';
  let { editing = true } = $props();
  const lift = new Spring(0);
  let angle = $state(0);
</script>

<canvas frameloop="demand" aria-label="Model preview">
  {#if editing}
    <scene>
      <perspectiveCamera active position={[4, 3, 6]} />
      <ambientLight intensity={0.8} />
      <mesh position={[0, lift.current, 0]} rotation={[0, angle, 0]}
        onpointerenter={() => lift.target = 0.5}
        onpointerleave={() => lift.target = 0}
        onclick={() => angle += Math.PI / 4}>
        <boxGeometry />
        <standardMaterial color={[0.2, 0.8, 0.5]} />
      </mesh>
    </scene>
  {:else}
    <scene>
      <perspectiveCamera active position={[0, 0, 6]} />
      <mesh><sphereGeometry /><basicMaterial color={[0.2, 0.6, 0.9]} /></mesh>
    </scene>
  {/if}
</canvas>

<style>
  canvas { height: 420px; }
</style>
```

```svelte
<!-- App.svelte -->
<script>
  import Viewport from './Viewport.typegpu.svelte';
  let editing = $state(true);
</script>

<label><input type="checkbox" bind:checked={editing} /> Editing</label>
<Viewport {editing} />
```

The scene branches unmount normally; state belonging to removed child components
is reset on recreation. State in the viewport's script survives scene switches.
The native canvas and GPU root survive both. No IDs, public `sceneProps`, or
`canvasProps` object is required. A DOM parent can conditionally mount the entire
viewport; that intentionally creates a new canvas/root lifetime when shown again.

## Snippet composition

Declare scene snippets at the top level or inside the scene, and render them with
ordinary Svelte 5 `{@render}`. Parameters remain reactive. Scene components can
accept typed snippet props, including `children`:

```svelte
<!-- MeshList.typegpu.svelte -->
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
<!-- Viewport.typegpu.svelte -->
<script>
  import MeshList from './MeshList.typegpu.svelte';
  let items = $state([
    { x: -2, selected: false },
    { x: 0, selected: false },
    { x: 2, selected: false }
  ]);
</script>

{#snippet box(item)}
  <mesh position={[item.x, 0, 0]} onclick={() => item.selected = !item.selected}>
    <boxGeometry />
    <basicMaterial color={item.selected ? [0.9, 0.3, 0.2] : [0.2, 0.7, 0.5]} />
  </mesh>
{/snippet}

<canvas aria-label="Selectable boxes">
  <scene>
    <perspectiveCamera active position={[0, 0, 8]} />
    <MeshList {items}>
      {#snippet children(item)}{@render box(item)}{/snippet}
    </MeshList>
  </scene>
</canvas>
```

The list uses each item's identity as its Svelte key; no renderer connection IDs
are required. Reordering retained items preserves their mesh nodes, and changing
snippet parameters updates the existing nodes instead of recreating them.

Author scene snippets in `.typegpu.svelte` files. Ordinary DOM-authored snippets
cannot be rendered into a TypeGPU scene. Module-exported scene snippets follow
Svelte's usual export restrictions. The server keeps their declarations but
omits GPU markup; it still emits only the canvas shell.

## Canvas contract

- Exactly one unconditional top-level canvas per viewport file. Top-level snippet
  declarations are allowed alongside it. Put rendered scene content inside the
  canvas and DOM controls in an ordinary `.svelte` component.
- At most one mounted scene, including hidden scenes. Multiple scenes report an
  error and dispose the scene/root rather than silently combining them. Removing
  the last scene clears once and idles in demand mode.
- Canvas event attributes receive native browser events and an HTMLCanvasElement
  currentTarget. Scene event attributes receive hit-tested TypeGpuNodeEvent
  values. Canvas keyboard focus does not create scene-object focus navigation.
- `bind:this` returns the actual native canvas, never the internal host component.
  Attachments receive that same canvas and clean up normally.
- Read-only native size bindings work directly on the canvas: `clientWidth`,
  `clientHeight`, `offsetWidth`, `offsetHeight`, `contentRect`, `contentBoxSize`,
  `borderBoxSize`, and `devicePixelContentBoxSize`. Assignable targets and
  `{null, setter}` function bindings follow Svelte's native measurement and cleanup
  behavior. Observers are shared, with no per-frame layout polling.
- Native attributes, prop spreads, class/style values, and canvas-scoped CSS
  update without remounting the scene. CSS owns display size; the renderer owns
  drawing-buffer width/height and DPR. Explicit width/height attributes are rejected.
- Other native bindings, class/style directives, transitions and animations on
  this canvas boundary are not yet supported and produce compile errors.
  Use attachments for reusable behavior; `use:` actions are not a supported API.
- `frameloop` defaults to `demand`. It and `maxDevicePixelRatio` update reactively
  without replacing the canvas, scene or GPU root. Removing a prop restores its
  default (`demand` and `1.5`). Equal settings do no scheduling work. Switching to
  `manual` cancels pending renderer frames; switching back wakes the renderer.
  Resolution changes apply on the next draw, replacing only size-dependent GPU
  targets when physical dimensions change. CSS display dimensions stay unchanged.
- Optional `onready(root)`, `onfps(number)`, and `onrenderererror(error)` callbacks
  report renderer state. `onfps` reports delivered render frames and emits `0`
  after 500 ms without a frame, without requesting another render frame.
  `onerror` remains a native canvas event. Unhandled startup
  failures log an error; `data-typegpu-status` is pending, ready, or error. Retry by
  remounting the viewport. GPU device-loss recovery is not implemented.
- SSR emits the accessible canvas shell without mounting scene content or
  starting WebGPU. Hydration retains that exact canvas. Startup after removal
  disposes a late root without mounting content or firing readiness.

The scene uses a separately owned Svelte mount with inherited context. Parent
error boundaries and pending counts are not joined across that mount. Existing
async-expression restrictions still apply. Original-source primitive editor
typing remains a separate [upstream/tooling limitation](svelte-compatibility.md).

## Live render settings

Forward ordinary Svelte props to change the existing viewport:

```svelte
<script>
  let { mode = 'demand', pixelRatio = 1.5, onready } = $props();
</script>

<canvas frameloop={mode} maxDevicePixelRatio={pixelRatio} {onready}>
  <scene>
    <perspectiveCamera active position={[0, 0, 6]} />
    <mesh><boxGeometry /><basicMaterial color={[0.2, 0.7, 0.4]} /></mesh>
  </scene>
</canvas>
```

In `manual` mode, call `root.gpu.renderFrame()` explicitly using the root received
by `onready`. This does not pause independent Tween/Spring producers; it stops
automatic drawing. In `demand` mode, ordinary reactive scene updates and active
frame tasks wake rendering, which stops when their work settles.

The pixel ratio is a cap on the browser device pixel ratio, not a multiplier.
Positive fractions support reduced-resolution rendering; `Infinity` uses the
native device pixel ratio without a cap. Zero, negative values and `NaN` use the
default cap of `1.5`. Hidden canvases retain their last measured CSS size, rather
than repeatedly scaling their already-scaled drawing buffer.

## Responsive scenes

Size bindings measure CSS layout, not the renderer's DPR-scaled drawing buffer.
Use their values in ordinary derived state or scene props:

```svelte
<script>
  let width = $state(0);
  let height = $state(0);
  const portrait = $derived(width > 0 && height > width);
</script>

<canvas bind:clientWidth={width} bind:clientHeight={height} aria-label="Responsive scene">
  <scene>
    <perspectiveCamera active position={[0, 0, 8]} fov={portrait ? 60 : 42} />
    <mesh><boxGeometry /><basicMaterial /></mesh>
  </scene>
</canvas>
```

These bindings do not run during SSR. Element dimensions receive an initial
client measurement; ResizeObserver entry bindings receive their first value
when the browser delivers an entry. Resizing does not remount the canvas or
scene. Avoid sizing the canvas from its own bound measurement, which can create
a browser resize feedback loop.

## Verification

Tests exercise the real compiled boundary and Tween/Spring at 60, 120 and 144 Hz
in both RAF callback orders, along with manual rendering, demand idle, native
attribute updates, targeted uploads and GPU resource reuse. Vite client/SSR
builds and server-canvas hydration are tested separately. Synthetic clocks do
not establish a physical display refresh rate; live callback rate, rendered
frames and GPU throughput must be measured separately.

The legacy [Canvas host](canvas-guide.md) and low-level root API remain available.
