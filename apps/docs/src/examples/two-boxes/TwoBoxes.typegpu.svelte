<script lang="ts">
  import SceneBox from './SceneBox.typegpu.svelte';
  import {
    boxBounds,
    floorBounds,
    floorVertices,
    leftBoxVertices,
    rightBoxVertices
  } from './box-geometry';
  import { rotateBoxesFromDrag } from './box-interaction';
  import type { TypeGpuDragEventDetail, Vector3Tuple } from 'svelte-typegpu';

  const boxes: {
    id: string;
    geometry: string;
    position: Vector3Tuple;
  }[] = [
    {
      id: 'left-box',
      geometry: 'left-box-geometry',
      position: [-2, 0, 0]
    },
    {
      id: 'right-box',
      geometry: 'right-box-geometry',
      position: [2, 0, 0]
    }
  ];

  let boxRotation = $state<Vector3Tuple>([0, 0, 0]);

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

  <resources>
    <bufferGeometry
      id="left-box-geometry"
      key="two-boxes:left"
      vertices={leftBoxVertices}
      bounds={boxBounds}
      layoutKey="position:normal:uv:color"
    ></bufferGeometry>
    <bufferGeometry
      id="right-box-geometry"
      key="two-boxes:right"
      vertices={rightBoxVertices}
      bounds={boxBounds}
      layoutKey="position:normal:uv:color"
    ></bufferGeometry>
    <bufferGeometry
      id="floor-geometry"
      key="two-boxes:floor"
      vertices={floorVertices}
      bounds={floorBounds}
      layoutKey="position:normal:uv:color"
    ></bufferGeometry>
    <basicMaterial id="vertex-colors" color={[1, 1, 1, 1]} cullMode="none"></basicMaterial>
  </resources>

  <mesh
    geometry="floor-geometry"
    material="vertex-colors"
    position={[0, -2, 0]}
    scale={[5, 1, 5]}
  ></mesh>

  {#each boxes as box (box.id)}
    <SceneBox
      geometry={box.geometry}
      material="vertex-colors"
      position={box.position}
      rotation={boxRotation}
      onDragMove={rotateBothBoxes}
    />
  {/each}
</scene>
