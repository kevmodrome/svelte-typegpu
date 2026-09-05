<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import Scene from '../Scene.svelte';
  let wrongRoot = $state(0);
</script>

<Canvas scene={Scene} sceneProps={{}} />
<Canvas scene={Scene} sceneProps={{ count: 'five' }} />
<Canvas scene={Scene} sceneProps={{ count: 1, unexpected: true }} />
<Canvas scene={Scene} sceneProps={{ count: 1, onselect: (id) => id.toUpperCase() }} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} onready={(root) => root.toFixed()} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} onfps={(fps) => fps.gpu} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} onerror={(error) => error.message} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} bind:root={wrongRoot} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} options={{ canvas: undefined }} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} options={{ target: undefined }} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} options={{ onFps: () => {} }} />
<Canvas scene={Scene} sceneProps={{ count: 1 }} frameloop="demand" />
