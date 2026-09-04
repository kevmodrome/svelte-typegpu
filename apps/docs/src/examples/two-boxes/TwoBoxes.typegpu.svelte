<script lang="ts">
  import Floor from './Floor.typegpu.svelte';
  import SceneBox from './SceneBox.typegpu.svelte';
  import {
    boxBounds,
    type GeometryBounds,
    leftBoxVertices,
    rightBoxVertices
  } from './box-geometry';
  import { rotateBoxesFromDrag } from './box-interaction';
  import type { TypeGpuDragEventDetail, Vector3Tuple, Vector4Tuple } from 'svelte-typegpu';

  const boxes: {
    id: string;
    geometryKey: string;
    vertices: Float32Array;
    bounds: GeometryBounds;
    position: Vector3Tuple;
  }[] = [
    {
      id: 'left-box',
      geometryKey: 'two-boxes:left',
      vertices: leftBoxVertices,
      bounds: boxBounds,
      position: [-2, 0, 0]
    },
    {
      id: 'right-box',
      geometryKey: 'two-boxes:right',
      vertices: rightBoxVertices,
      bounds: boxBounds,
      position: [2, 0, 0]
    }
  ];

  let boxRotation = $state<Vector4Tuple>([0, 0, 0, 1]);

  function rotateBothBoxes(event: CustomEvent<TypeGpuDragEventDetail>) {
    boxRotation = rotateBoxesFromDrag(boxRotation, event);
  }
</script>

<scene clearColor={[0.02, 0.02, 0.025, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[12, 5, 12]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={1000}
  >
    <controls mode="orbit" minDistance={1} maxDistance={40}>
      <pointerControls
        dragButton="primary"
        rotateSpeed={1}
        wheel="zoom"
        zoomSpeed={0.9}
        touch="orbit-pinch"
      ></pointerControls>
    </controls>
  </perspectiveCamera>

  <group quaternion={boxRotation}>
    <Floor />

    {#each boxes as box (box.id)}
      <SceneBox
        geometryKey={box.geometryKey}
        vertices={box.vertices}
        bounds={box.bounds}
        position={box.position}
        onDragMove={rotateBothBoxes}
      />
    {/each}
  </group>
</scene>
