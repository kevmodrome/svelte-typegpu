<script lang="ts">
  import SceneBox from './SceneBox.typegpu.svelte';
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  const boxes: {
    id: string;
    position: Vector3Tuple;
    rotation: Vector3Tuple;
    scale: Vector3Tuple;
    color: RgbaTuple;
    spinSpeed: number;
  }[] = [
    {
      id: 'left-box',
      position: [-1.08, 0, 0],
      rotation: [-0.18, 0.42, 0],
      scale: [0.92, 0.92, 0.92],
      color: [0.38, 0.92, 0.84, 1],
      spinSpeed: 0.24
    },
    {
      id: 'right-box',
      position: [1.08, 0.08, 0.18],
      rotation: [0.24, -0.36, 0.08],
      scale: [0.74, 1.12, 0.74],
      color: [1, 0.63, 0.32, 1],
      spinSpeed: -0.18
    }
  ];
</script>

<scene clearColor={[0.045, 0.055, 0.07, 1]} animationSpeed={0.42}>
  <perspectiveCamera id="main" active={true} position={[3.2, 2.2, 4.6]} target={[0.08, 0.04, 0]} fov={42} near={0.1} far={100}>
    <controls mode="orbit" minDistance={2.4} maxDistance={9}>
      <pointerControls rotateSpeed={0.72} wheel="zoom" zoomSpeed={0.7} touch="orbit-pinch"></pointerControls>
    </controls>
  </perspectiveCamera>
  <resources>
    <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>
    <planeGeometry id="floor" width={4.8} height={4.8}></planeGeometry>
    <standardMaterial id="floor-material" color={[0.16, 0.18, 0.18, 1]} roughness={0.82} metalness={0}></standardMaterial>
    {#each boxes as box (box.id)}
      <standardMaterial id={`${box.id}-material`} color={box.color} roughness={0.34} metalness={0.1}></standardMaterial>
    {/each}
  </resources>
  <ambientLight color={[1, 1, 1]} intensity={0.24}></ambientLight>
  <directionalLight rotation={[-0.8, 0.34, 0]} color={[1, 0.96, 0.88]} intensity={1.6}></directionalLight>
  <pointLight position={[1.8, 1.1, 1.4]} color={[0.65, 0.96, 1]} intensity={2.8} range={10}></pointLight>
  <mesh geometry="floor" material="floor-material" position={[0, -1.08, 0]}></mesh>
  {#each boxes as box (box.id)}
    <SceneBox
      geometry="box"
      material={`${box.id}-material`}
      position={box.position}
      rotation={box.rotation}
      scale={box.scale}
      spinSpeed={box.spinSpeed}
    />
  {/each}
</scene>
