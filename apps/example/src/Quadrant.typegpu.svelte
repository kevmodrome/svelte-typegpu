<script lang="ts">
  import type { CubeQuadrant, QuadrantCubeInstance } from './lib/cube-quadrants';
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface InstanceTransform {
    position: Vector3Tuple;
    rotation?: Vector3Tuple;
    scale: Vector3Tuple;
  }

  interface Props {
    quadrant: CubeQuadrant;
    getKey: (box: QuadrantCubeInstance, index: number) => number;
    getTransform: (box: QuadrantCubeInstance, index: number) => InstanceTransform;
    getColor: (box: QuadrantCubeInstance, index: number) => RgbaTuple;
  }

  let { quadrant, getKey, getTransform, getColor }: Props = $props();
</script>

<instancedMesh
  geometry="cube"
  material="fieldMaterial"
  position={quadrant.position}
  scale={quadrant.scale}
  instances={quadrant.instances}
  {getKey}
  {getTransform}
  {getColor}
  phase={quadrant.phase}
  spinSpeed={quadrant.spinSpeed}
></instancedMesh>
