<script lang="ts">
  import type { TypeGpuDragEventDetail, Vector3Tuple, Vector4Tuple } from 'svelte-typegpu';
  import type { GeometryBounds } from './box-geometry';

  interface Props {
    geometryKey: string;
    vertices: Float32Array;
    bounds: GeometryBounds;
    position: Vector3Tuple;
    quaternion: Vector4Tuple;
    onDragMove: (event: CustomEvent<TypeGpuDragEventDetail>) => void;
  }

  let { geometryKey, vertices, bounds, position, quaternion, onDragMove }: Props = $props();
</script>

<mesh
  {position}
  {quaternion}
  drag="rotate"
  dragButton="secondary"
  ondragmove={onDragMove}
>
  <bufferGeometry key={geometryKey} {vertices} {bounds}></bufferGeometry>
  <basicMaterial color={[1, 1, 1, 1]} cullMode="none"></basicMaterial>
</mesh>
