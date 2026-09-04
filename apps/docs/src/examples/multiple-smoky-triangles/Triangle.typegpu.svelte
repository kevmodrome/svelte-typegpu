<script lang="ts">
  import type { Vector3Tuple, RgbaTuple } from 'svelte-typegpu';
  import { smokyTriangleMaterialFragment } from './smoky-triangle-material';
  import { triangleBounds, triangleVertices } from './triangle-geometry';

  interface Props {
    id: string;
    position: Vector3Tuple;
    scale?: Vector3Tuple;
    rotation?: Vector3Tuple;
    color: RgbaTuple;
    smoky?: boolean;
  }

  let {
    id,
    position,
    scale = [1, 1, 1],
    rotation = [0, 0, 0],
    color,
    smoky = true
  }: Props = $props();

  let displayColor = $derived(smoky ? color : [1, 1, 1, 1] satisfies RgbaTuple);
</script>

<mesh {position} {rotation} {scale} color={displayColor}>
  <bufferGeometry
    key={`multiple-smoky-triangles:${id}`}
    vertices={triangleVertices}
    bounds={triangleBounds}
  ></bufferGeometry>
  {#if smoky}
    <shaderMaterial fragment={smokyTriangleMaterialFragment} cullMode="none"></shaderMaterial>
  {:else}
    <basicMaterial color={[1, 1, 1, 1]} cullMode="none"></basicMaterial>
  {/if}
</mesh>
