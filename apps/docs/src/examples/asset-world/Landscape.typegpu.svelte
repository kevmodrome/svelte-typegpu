<script lang="ts">
  import type { WorldAssets } from './world';
  import type { Landscape } from './landscape';
  let { assets, landscape, forest = true }: { assets: WorldAssets; landscape: Landscape; forest?: boolean } = $props();
</script>

{#each landscape.placements as item (item.key)}
  <model asset={assets[item.asset]} position={item.position} scale={item.scale} rotation={item.rotation}
    visible={forest || (item.asset !== 'pine' && item.asset !== 'oak')}
    pointerEvents="none" castShadow receiveShadow />
{/each}
