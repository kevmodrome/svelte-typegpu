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

## Canvas contract

- Exactly one unconditional top-level canvas per viewport file. Put scene
  composition inside it and DOM controls in an ordinary `.svelte` component.
- At most one mounted scene, including hidden scenes. Multiple scenes report an
  error and dispose the scene/root rather than silently combining them. Removing
  the last scene clears once and idles in demand mode.
- Canvas event attributes receive native browser events and an HTMLCanvasElement
  currentTarget. Scene event attributes receive hit-tested TypeGpuNodeEvent
  values. Canvas keyboard focus does not create scene-object focus navigation.
- `bind:this` returns the actual native canvas, never the internal host component.
  Attachments receive that same canvas and clean up normally.
- Native attributes, prop spreads, class/style values, and canvas-scoped CSS
  update without remounting the scene. CSS owns display size; the renderer owns
  drawing-buffer width/height and DPR. Explicit width/height attributes are rejected.
- Native bindings other than `bind:this`, class/style directives, actions,
  transitions and animations on this canvas boundary are not yet supported and
  produce compile errors. Scene attachments/actions retain their existing support.
- `frameloop` defaults to `demand`. `frameloop` and `maxDevicePixelRatio` are
  creation-only; changing them warns without recreating GPU resources. Remount
  deliberately with a parent `{#key}` when changing these settings.
- Optional `onready(root)`, `onfps(number)`, and `onrenderererror(error)` callbacks
  report renderer state. `onerror` remains a native canvas event. Unhandled startup
  failures log an error; `data-typegpu-status` is pending, ready, or error. Retry by
  remounting the viewport. GPU device-loss recovery is not implemented.
- SSR emits the accessible canvas shell without mounting scene content or
  starting WebGPU. Hydration retains that exact canvas. Startup after removal
  disposes a late root without mounting content or firing readiness.

The scene uses a separately owned Svelte mount with inherited context. Parent
error boundaries and pending counts are not joined across that mount. Existing
async-expression restrictions still apply. Original-source primitive editor
typing remains a separate [upstream/tooling limitation](svelte-compatibility.md).

## Verification

Tests exercise the real compiled boundary and Tween/Spring at 60, 120 and 144 Hz
in both RAF callback orders, along with manual rendering, demand idle, native
attribute updates, targeted uploads and GPU resource reuse. Vite client/SSR
builds and server-canvas hydration are tested separately. Synthetic clocks do
not establish a physical display refresh rate; live callback rate, rendered
frames and GPU throughput must be measured separately.

The legacy [Canvas host](canvas-guide.md) and low-level root API remain available.
