<script lang="ts">
  import type { Landscape } from './landscape';
  let { landscape, dusk = false }: { landscape: Landscape; dusk?: boolean } = $props();
</script>

<mesh position={[0, -0.6, 0]} receiveShadow>
  <boxGeometry width={landscape.halfWidth * 2} height={0.9} depth={landscape.halfDepth * 2} />
  <standardMaterial color={[0.26, 0.32, 0.28]} roughness={1} metalness={0} />
</mesh>
{#each [[(2 - landscape.halfWidth) / 2, landscape.halfWidth + 2], [(5 + landscape.halfWidth) / 2, landscape.halfWidth - 5]] as [x, width], bank (bank)}
  <mesh position={[x, -0.1, 0]} receiveShadow>
    <boxGeometry {width} height={0.2} depth={landscape.halfDepth * 2} />
    <standardMaterial color={[0.37, 0.58, 0.39]} roughness={1} metalness={0} />
  </mesh>
{/each}
<mesh position={[3.5, -0.1, 0]} receiveShadow>
  <planeGeometry width={3} height={landscape.halfDepth * 2} />
  <standardMaterial color={dusk ? [0.12, 0.35, 0.46] : [0.2, 0.65, 0.76]}
    roughness={0.22} metalness={0.05} cullMode="none" />
</mesh>
<mesh position={[-2.7, 0.006, 3.9]} receiveShadow>
  <planeGeometry width={6.5} height={1.25} />
  <standardMaterial color={[0.69, 0.72, 0.56]} roughness={1} metalness={0} cullMode="none" />
</mesh>
