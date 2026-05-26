<script lang="ts">
  import type { TypeGpuDragEventDetail, Vector3Tuple, Vector4Tuple } from 'svelte-typegpu';

  interface Props {
    geometry: string;
    material: string;
    position: Vector3Tuple;
    quaternion: Vector4Tuple;
    onDragMove: (event: CustomEvent<TypeGpuDragEventDetail>) => void;
  }

  let { geometry, material, position, quaternion, onDragMove }: Props = $props();
</script>

<mesh
  {geometry}
  {material}
  {position}
  {quaternion}
  drag="rotate"
  dragButton="secondary"
  ondragmove={onDragMove}
></mesh>
