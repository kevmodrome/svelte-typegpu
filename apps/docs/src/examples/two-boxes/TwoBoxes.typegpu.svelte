<script lang="ts">
  import SceneBox from './SceneBox.typegpu.svelte';
  import {
    boxBounds,
    type GeometryBounds,
    floorBounds,
    floorVertices,
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

  <mesh position={[0, -2, 0]} scale={[5, 1, 5]}>
    <bufferGeometry
      key="two-boxes:floor"
      vertices={floorVertices}
      bounds={floorBounds}
    ></bufferGeometry>
    <basicMaterial color={[1, 1, 1, 1]} cullMode="none"></basicMaterial>
  </mesh>

  {#each boxes as box (box.id)}
    <SceneBox
      geometryKey={box.geometryKey}
      vertices={box.vertices}
      bounds={box.bounds}
      position={box.position}
      quaternion={boxRotation}
      onDragMove={rotateBothBoxes}
    />
  {/each}
</scene>
