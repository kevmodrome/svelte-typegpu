<script lang="ts">
  import Canvas from '../Canvas.svelte';
  import { untrack } from 'svelte';
  import type { TypeGpuRoot } from '../svelte-renderer';

  let { Scene, props = {}, options, callbacks = {}, canvasProps = {} } = $props();
  let scene = $state.raw(untrack(() => Scene));
  let sceneProps = $state.raw(untrack(() => props));
  let handlers = $state.raw(untrack(() => callbacks));
  let canvasAttributes = $state.raw(untrack(() => canvasProps));
  let renderOptions = $state(untrack(() => options ?? {}));
  let root = $state.raw<TypeGpuRoot | null>(null);

  export function updateProps(value) { sceneProps = value; }
  export function updateScene(value) { scene = value; }
  export function updateHandlers(value) { handlers = value; }
  export function updateCanvasProps(value) { canvasAttributes = value; }
  export function updateOptions(frameloop, maxDevicePixelRatio) { renderOptions.frameloop = frameloop; renderOptions.maxDevicePixelRatio = maxDevicePixelRatio; }
  export function replaceRoot(value: TypeGpuRoot) { root = value; }
  export function currentRoot() { return root; }
</script>

<Canvas
  {scene}
  {sceneProps}
  options={renderOptions}
  canvasProps={canvasAttributes}
  bind:root
  onready={handlers.onready}
  onerror={handlers.onerror}
  onfps={handlers.onfps}
  aria-label="GPU scene"
/>
