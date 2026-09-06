<script lang="ts">
  import Canoe from './Canoe.typegpu.svelte';
  import { details, landmarks, trees, selectedPosition, type WorldAssets } from './world';
  let { assets, paused = false, forest = true, selected = '', onselect = (_key: string) => {} }: {
    assets: WorldAssets; paused?: boolean; forest?: boolean; selected?: string;
    onselect?: (key: string) => void;
  } = $props();
  const marker = $derived(selectedPosition(selected));
</script>

{#each landmarks as item (item.key)}
  <model name={item.key} asset={assets[item.asset]} position={item.position}
    scale={item.scale} rotation={item.rotation} castShadow receiveShadow
    onclick={() => onselect(item.key)} />
{/each}

<group visible={forest}>
  {#each trees as item (item.key)}
    <model asset={assets[item.asset]} position={item.position} scale={item.scale}
      rotation={item.rotation} castShadow receiveShadow />
  {/each}
</group>
{#each details as item (item.key)}
  <model asset={assets[item.asset]} position={item.position} scale={item.scale}
    rotation={item.rotation} castShadow receiveShadow />
{/each}

<Canoe asset={assets.canoe} {paused} onselect={() => onselect('canoe')} />
{#if marker}
  <mesh position={[marker[0], selected === 'canoe' ? -0.07 : 0.025, marker[2]]}>
    <planeGeometry width={2.4} height={2.4} />
    <basicMaterial color={[1, 0.83, 0.25]} cullMode="none" />
  </mesh>
{/if}
