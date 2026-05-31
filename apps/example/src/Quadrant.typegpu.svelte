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

<group position={quadrant.position} scale={quadrant.scale}>
  {#each quadrant.instances as box, index (getKey(box, index))}
    {@const transform = getTransform(box, index)}
    <mesh position={transform.position} rotation={transform.rotation} scale={transform.scale}>
      <boxGeometry width={1} height={1} depth={1}></boxGeometry>
      <phongMaterial
        color={getColor(box, index)}
        map="/textures/checker.svg"
        sampler={{ addressModeU: 'repeat', addressModeV: 'repeat' }}
      ></phongMaterial>
    </mesh>
  {/each}
</group>
