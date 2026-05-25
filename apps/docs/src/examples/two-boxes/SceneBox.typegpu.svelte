<script lang="ts">
  import type { TypeGpuDragEventDetail, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    geometry: string;
    material: string;
    position: Vector3Tuple;
    rotation: Vector3Tuple;
    onDragMove: (event: CustomEvent<TypeGpuDragEventDetail>) => void;
  }

  let { geometry, material, position, rotation, onDragMove }: Props = $props();
</script>

<mesh
  {geometry}
  {material}
  {position}
  {rotation}
  drag="rotate"
  ondragmove={onDragMove}
></mesh>
