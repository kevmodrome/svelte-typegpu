<script module>
  export { orb };
</script>

<script lang="ts">
  import Mesh from './Mesh.typegpu.svelte';
  let { editing = true } = $props();
  let canvas = $state<HTMLCanvasElement>();
  let angle = $state(0);
  let width = $state(0);
  let height = $state(0);
</script>

{#snippet clickableMesh(value)}<Mesh angle={value} onclick={() => angle += 1} />{/snippet}
{#snippet orb()}<mesh><sphereGeometry /></mesh>{/snippet}

<canvas bind:this={canvas} bind:clientWidth={width} bind:clientHeight={null, value => height = value}
  frameloop="demand" aria-label="Build test" data-size={`${width}x${height}`}>
  {#if editing}
    <scene>{@render clickableMesh(angle)}</scene>
  {:else}
    <scene>{@render orb()}</scene>
  {/if}
</canvas>

<style>
  canvas { height: 420px; }
  canvas:focus { outline: 2px solid red; }
</style>
