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

## Complete native-event example

The docs site's `/examples/native-events` playground pairs
`NativeEvents.typegpu.svelte` with `NativeEventsPreview.svelte`. The DOM wrapper
accepts the scene component, so it can be server-rendered before Canvas mounts
the client-only scene:

```svelte
<script lang="ts">
  import NativeEvents from './NativeEvents.typegpu.svelte';
  import NativeEventsPreview from './NativeEventsPreview.svelte';
</script>

<NativeEventsPreview scene={NativeEvents} />
```

It demonstrates `canvasProps.onkeydown`, `onfocus`, `onblur`, and `onpointerdown`
alongside scene `onclick`, `onclickcapture`, `onpointerenter`, `onpointerleave`,
`onwheel`, `ondblclick`, and `oncontextmenu`. DOM controls offer the same object
selection, rotation, and size changes as keyboard/pointer input. Only recognized
unmodified keys are canceled, and wheel events over objects resize them without
zooming the camera. Wheel events over the background retain camera zoom.

## Root lifetime

`options` are initialization-only `TypeGpuRootOptions`, without `target`, `canvas`,
or `onFps`. Use reactive scene attributes for backgrounds/depth settings. To
change initialization options, recreate the canvas explicitly with `{#key}`.
The root's existing default frame loop is `always`; choose `demand` for idle
scenes, and `always` when shader time must advance continuously. Active
continuous `frameTask` nodes also keep a demand root rendering.

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
