<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';
  let { position, size }: { position: Vector3Tuple; size: Vector3Tuple } = $props();
</script>

<mesh {position} scale={size}>
  <boxGeometry />
  <standardMaterial color={[0.63, 0.68, 0.72]} roughness={0.85} />
</mesh>
