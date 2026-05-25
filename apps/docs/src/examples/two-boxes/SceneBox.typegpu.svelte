<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    geometry: string;
    material: string;
    position: Vector3Tuple;
    rotation?: Vector3Tuple;
    scale: Vector3Tuple;
    spinSpeed?: number;
  }

  let {
    geometry,
    material,
    position,
    rotation = [0, 0, 0],
    scale,
    spinSpeed = 0
  }: Props = $props();
</script>

<mesh
  {geometry}
  {material}
  {position}
  {rotation}
  {scale}
  {spinSpeed}
></mesh>
