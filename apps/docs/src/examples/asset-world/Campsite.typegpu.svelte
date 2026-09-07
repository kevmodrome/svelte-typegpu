<script lang="ts">
  import Canoe from './Canoe.typegpu.svelte';
  import Tree from './Tree.typegpu.svelte';
  import Rock from './Rock.typegpu.svelte';
  import Log from './Log.typegpu.svelte';
  import Tent from './Tent.typegpu.svelte';
  import Campfire from './Campfire.typegpu.svelte';
  import Bridge from './Bridge.typegpu.svelte';
  import Sign from './Sign.typegpu.svelte';
  import SelectionMarker from './SelectionMarker.typegpu.svelte';
  import { details, landmarks, trees, type WorldAssets } from './world';
  let { assets, paused = false, forest = true, selected = '', onselect = (_key: string) => {} }: {
    assets: WorldAssets; paused?: boolean; forest?: boolean; selected?: string;
    onselect?: (key: string) => void;
  } = $props();
  const landmarkComponents = { tent: Tent, firepit: Campfire, bridge: Bridge, sign: Sign };
  const detailComponents = { rock: Rock, log: Log };
</script>

{#each landmarks as item (item.key)}
  {@const Landmark = landmarkComponents[item.asset]}
  <Landmark {assets} name={item.key} position={item.position}
    scale={item.scale} rotation={item.rotation}
    onclick={() => onselect(item.key)} />
{/each}

<group visible={forest}>
  {#each trees as item (item.key)}
    <Tree {assets} kind={item.asset} position={item.position} scale={item.scale} rotation={item.rotation} />
  {/each}
</group>
{#each details as item (item.key)}
  {@const Detail = detailComponents[item.asset]}
  <Detail {assets} position={item.position} scale={item.scale} rotation={item.rotation} />
{/each}

<Canoe asset={assets.canoe} {paused} onselect={() => onselect('canoe')} />
<SelectionMarker {selected} />
