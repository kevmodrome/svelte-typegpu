<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import type { TypeGpuRoot } from 'svelte-typegpu';
  import Scene from '../Scene.svelte';
  import Empty from '../Empty.svelte';

  let root = $state.raw<TypeGpuRoot | null>(null);
  let count = $state(5);
  let message = $state('');
</script>

<Canvas scene={Empty} sceneProps={{}} />
<Canvas scene={Scene} sceneProps={{ count }} />
<Canvas
  scene={Scene}
  sceneProps={{ count, position: [1, 2, 3], onselect: (id) => message = id.toFixed() }}
  options={{ frameloop: 'manual', depth: true }}
  bind:root
  onready={(value) => value.gpu.renderFrame()}
  onfps={(fps) => message = fps.toFixed(1)}
  onerror={(error) => message = error instanceof Error ? error.message : 'Unknown error'}
  class={['canvas', { active: count > 0 }]}
  style="height: 400px"
  aria-label="Scene"
  data-count={count}
  onclick={(event) => event.currentTarget.focus()}
  canvasProps={{
    'aria-label': 'Interactive model', tabindex: 0, class: ['viewport', { active: true }],
    'data-view': 'scene',
    onkeydown: (event) => {
      message = event.key.toUpperCase();
      event.currentTarget.toDataURL();
    }
  }}
/>
<button onclick={() => root?.gpu.renderFrame()}>{message}</button>
