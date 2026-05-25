<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    material: string;
    position: Vector3Tuple;
    scale: Vector3Tuple;
  }

  let { material, position, scale }: Props = $props();
</script>

<mesh
  geometry="orb"
  {material}
  {position}
  {scale}
  rotation={[0, 0.28, 0]}
></mesh>
