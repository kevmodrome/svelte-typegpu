<script lang="ts">
  import Mesh from './Mesh.typegpu.svelte';
  let { editing = true } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let angle = $state(0);
</script>

<canvas bind:this={canvas} frameloop="demand" aria-label="Build test">
  {#if editing}
    <scene><Mesh {angle} onclick={() => angle += 1} /></scene>
  {:else}
    <scene><mesh><sphereGeometry /></mesh></scene>
  {/if}
</canvas>

<style>
  canvas { height: 420px; }
  canvas:focus { outline: 2px solid red; }
</style>
