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

The component fills its parent; provide a definite height, as above. DOM
attributes such as `class`, `style`, and `aria-label` apply to the host div. The
canvas keeps its own scoped styling and renderer class. Server rendering emits
the shell only; WebGPU starts after the component mounts in the browser.

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
