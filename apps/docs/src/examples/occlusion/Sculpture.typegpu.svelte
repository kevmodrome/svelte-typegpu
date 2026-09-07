<script lang="ts">
  let { index, segments = 32 }: { index: number; segments?: number } = $props();
  const position = $derived([(index % 60 - 30) * 0.65, Math.floor(index / 1200) * 0.58,
    -(Math.floor(index / 60) % 20) * 1.3 - 2]);
</script>

<mesh {position}>
  <sphereGeometry radius={0.27} widthSegments={segments} heightSegments={segments / 2} />
  <standardMaterial color={[0.08, 0.66, 0.48]} metalness={0.15} roughness={0.5} />
</mesh>
