<script lang="ts">
  import Tree from './Tree.typegpu.svelte';
  import Rock from './Rock.typegpu.svelte';
  import Log from './Log.typegpu.svelte';
  import type { WorldAssets } from './world';
  import type { Landscape } from './landscape';
  let { assets, landscape, forest = true }: { assets: WorldAssets; landscape: Landscape; forest?: boolean } = $props();
</script>

{#each landscape.placements as item (item.key)}
  {#if item.asset === 'pine' || item.asset === 'oak'}
    <Tree {assets} kind={item.asset} position={item.position} scale={item.scale}
      rotation={item.rotation} visible={forest} pointerEvents="none" />
  {:else if item.asset === 'rock'}
    <Rock {assets} position={item.position} scale={item.scale} rotation={item.rotation} pointerEvents="none" />
  {:else}
    <Log {assets} position={item.position} scale={item.scale} rotation={item.rotation} pointerEvents="none" />
  {/if}
{/each}
