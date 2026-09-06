# Canvas hosting

`Canvas` is an ordinary DOM Svelte component. The scene it hosts is compiled with
the custom renderer, as before. No DOM nodes belong inside the scene itself.

```svelte
<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import Scene from './Scene.typegpu.svelte';
  let controls = $state({ x: 0, color: [1, 0, 0, 1] });
</script>

<Canvas
  scene={Scene}
  sceneProps={{ controls }}
  options={{ frameloop: 'demand' }}
  style="height: 400px"
/>
```

Mutating `controls` or replacing the `sceneProps` object updates the mounted
scene through Svelte's normal props. It does not reset the camera, attachments,
simulation, or GPU root. Changing the `scene` component intentionally unmounts
the old scene and mounts the new one on the same root. Parent Svelte context is
available to scene components, including reactive values and async children.

Interactive camera views survive unrelated keyed/conditional content updates.
Changed camera props update their own fields; use a `{#key}` block around the
camera to reset its view deliberately. Retained inactive cameras keep their views
when selected again. See [camera continuity](svelte-compatibility.md#camera-continuity).

TypeScript users get scene prop and callback inference from `scene`, including
required props and tuple values. Unknown inline `sceneProps` fields are rejected
instead of widening the scene's type. This requires TypeScript 5.4 or newer.
The package tests run Svelte's checker against valid and invalid consumer files;
`pnpm --filter svelte-typegpu check:svelte` checks the supported usage directly.

The component fills its parent; provide a definite height, as above. DOM
attributes such as `class`, `style`, and `aria-label` apply to the host div. The
canvas keeps its own scoped styling and renderer class. Server rendering emits
the shell only; WebGPU starts after the component mounts in the browser.

## Native canvas props

Use `canvasProps` for attributes and events on the actual HTMLCanvasElement,
independently of the wrapper div:

```svelte
<Canvas
  scene={Scene}
  sceneProps={{ controls }}
  style="height: 400px"
  canvasProps={{
    'aria-label': 'Interactive model preview',
    tabindex: 0,
    class: ['viewport', { shifted: controls.x !== 0 }],
    onkeydown: (event) => {
      if (event.key === 'Escape') controls.x = 0;
    }
  }}
/>
```

Native handlers receive DOM events and a canvas `currentTarget`; scene handlers still receive
`TypeGpuNodeEvent`. Top-level `onclick`, `class`, and other attributes continue to
apply to the wrapper. `Canvas`'s `onerror` remains a GPU startup callback, while
`canvasProps.onerror` is a native DOM event handler.

Canvas attributes, handlers, and Svelte class arrays/objects are reactive. Changing
them does not replace the canvas, remount the scene, initialize WebGPU, or request
a render frame. User class changes preserve the renderer class and scoped styles.
Svelte attachment-symbol props inside `canvasProps` attach to the DOM canvas and
use ordinary Svelte setup/cleanup; component-level attachments still target the
wrapper. A DOM attachment should not resize the drawing buffer or dispose the root.

The renderer owns canvas `width` and `height`; they are excluded from the prop
type and ignored at runtime. Use CSS dimensions instead. `children` is also
excluded: DOM overlays and controls stay outside the custom scene. ARIA attributes
are present during SSR, but attachments, handlers, and WebGPU do not run there.
Adding a label or tabindex does not implement keyboard navigation among 3D objects;
provide accessible DOM controls for scene interactions.

## Direct object events

Object handlers belong directly on scene primitives. They do not require
`canvasProps`, callback forwarding through `sceneProps`, or IDs. For example,
inside a `.typegpu.svelte` scene:

```svelte
<script lang="ts">
  let angle = $state(0);
  let hovered = $state(false);
</script>

<mesh
  rotation={[0, angle, 0]}
  onclick={() => angle += Math.PI / 12}
  onpointerenter={() => hovered = true}
  onpointerleave={() => hovered = false}
>
  <boxGeometry />
  <standardMaterial color={hovered ? [1, 0.85, 0.4] : [0.15, 0.76, 0.46]} />
</mesh>
```

The docs site's `/examples/native-events` example is one self-contained scene.
It owns its object state and attaches hover, click, wheel, double-click, and
context-menu handlers to each mesh. The standard host passes `sceneProps={{}}`
and uses demand mode: Svelte state changes update the affected objects and
request a frame; idle scenes do not keep rendering. Wheel cancellation over a
mesh prevents camera zoom there, while background wheel events still zoom.

The current box primitive is `mesh` plus `boxGeometry` and a material; there is
no `<box>` shorthand yet. `canvasProps` remains useful for canvas-wide DOM
attributes and keyboard/focus events, but it is not the object-event API.
This pointer-focused example does not implement keyboard object navigation.

## Root lifetime

`options` accepts `TypeGpuRootOptions`, without `target`, `canvas`, or `onFps`.
`frameloop` and `maxDevicePixelRatio` update reactively without recreating the
canvas, scene or GPU root. Removing either field restores its default (`always`
and `1.5`, respectively). Other options remain initialization-only; use reactive
scene attributes for backgrounds/depth settings, or `{#key}` to recreate the root.
The root's existing default frame loop is `always`; choose `demand` for idle
scenes, and `always` when shader time must advance continuously. Active
continuous `frameTask` nodes also keep a demand root rendering.

Switching to `manual` cancels pending renderer frames. Motion producers remain
independent: their values can continue changing, but drawing requires an explicit
`root.gpu.renderFrame()`. Switching back wakes the existing renderer. A pixel
ratio change takes effect on the next draw; it does not change CSS display size.
The Motion and Native Events examples expose both live settings.

Callbacks use current prop values: `onready(root)`, `onfps(fps)`, and
`onerror(error)`. `onready` means the GPU root and scene mount are established,
not that async model/texture loads have all finished. Startup failures use the
callback, or a local alert if no callback is supplied. Scene `{#await}` and
Svelte boundaries remain responsible for their own loading/render errors.

For manual rendering, use a raw root reference:

```svelte
<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import type { TypeGpuRoot } from 'svelte-typegpu';
  import Scene from './Scene.typegpu.svelte';
  let root = $state.raw<TypeGpuRoot | null>(null);
</script>

<Canvas scene={Scene} sceneProps={{}} options={{ frameloop: 'manual' }} bind:root />
<button onclick={() => root?.gpu.renderFrame()}>Draw</button>
```

`Canvas` owns the root. The bound reference is null until ready and after
teardown; do not dispose it separately. Unmounting the Canvas first unmounts its
Svelte scene, then disposes GPU state. A root that finishes initialization after
unmount is immediately disposed without mounting a scene or firing callbacks.
