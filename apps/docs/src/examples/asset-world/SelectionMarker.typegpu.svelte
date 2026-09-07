<script lang="ts">
  import { selectedPosition } from './world';
  let { selected = '' }: { selected?: string } = $props();
  const position = $derived(selectedPosition(selected));
</script>

{#if position}
  <mesh position={[position[0], selected === 'canoe' ? -0.07 : 0.025, position[2]]}>
    <planeGeometry width={2.4} height={2.4} />
    <basicMaterial color={[1, 0.83, 0.25]} cullMode="none" />
  </mesh>
{/if}
