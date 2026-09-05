<script lang="ts">
  import Canvas from '../Canvas.svelte';
  import { untrack } from 'svelte';
  import type { TypeGpuRoot } from '../svelte-renderer';

  let { Scene, props = {}, options, callbacks = {} } = $props();
  let scene = $state.raw(untrack(() => Scene));
  let sceneProps = $state.raw(untrack(() => props));
  let handlers = $state.raw(untrack(() => callbacks));
  let root = $state.raw<TypeGpuRoot | null>(null);

  export function updateProps(value) { sceneProps = value; }
  export function updateScene(value) { scene = value; }
  export function updateHandlers(value) { handlers = value; }
  export function currentRoot() { return root; }
</script>

<Canvas
  {scene}
  {sceneProps}
  {options}
  bind:root
  onready={handlers.onready}
  onerror={handlers.onerror}
  onfps={handlers.onfps}
  aria-label="GPU scene"
/>
