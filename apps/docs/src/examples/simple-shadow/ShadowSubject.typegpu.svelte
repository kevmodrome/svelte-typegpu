<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    position: Vector3Tuple;
    scale: Vector3Tuple;
    material: string;
  }

  let { position, scale, material }: Props = $props();
</script>

<mesh
  geometry="box"
  {material}
  {position}
  {scale}
  rotation={[0, 0.24, 0]}
></mesh>
