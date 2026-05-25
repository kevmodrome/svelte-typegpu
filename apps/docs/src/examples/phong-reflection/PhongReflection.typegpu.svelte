<script lang="ts">
  import PhongLights from './PhongLights.typegpu.svelte';
  import PhongOrb from './PhongOrb.typegpu.svelte';
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  const orbs: {
    id: string;
    position: Vector3Tuple;
    scale: Vector3Tuple;
    color: RgbaTuple;
    metalness: number;
    roughness: number;
  }[] = [
    {
      id: 'matte',
      position: [-1.2, 0.06, 0],
      scale: [0.78, 0.78, 0.78],
      color: [0.28, 0.78, 0.95, 1],
      metalness: 0.04,
      roughness: 0.72
    },
    {
      id: 'polished',
      position: [0, 0.18, 0.08],
      scale: [0.96, 0.96, 0.96],
      color: [0.95, 0.92, 0.82, 1],
      metalness: 0.22,
      roughness: 0.22
    },
    {
      id: 'warm',
      position: [1.26, -0.02, -0.04],
      scale: [0.72, 0.72, 0.72],
      color: [1, 0.55, 0.28, 1],
      metalness: 0.12,
      roughness: 0.38
    }
  ];
</script>

<scene clearColor={[0.052, 0.047, 0.058, 1]} animationSpeed={0.28}>
  <perspectiveCamera id="main" active={true} position={[3.8, 2.15, 4.9]} target={[0, 0.1, 0]} fov={38} near={0.1} far={100}>
    <controls mode="orbit" minDistance={3.2} maxDistance={10}>
      <pointerControls rotateSpeed={0.62} wheel="zoom" zoomSpeed={0.68} touch="orbit-pinch"></pointerControls>
    </controls>
  </perspectiveCamera>
  <resources>
    <sphereGeometry id="orb" radius={1} widthSegments={32} heightSegments={18}></sphereGeometry>
    <planeGeometry id="floor" width={5.2} height={3.4}></planeGeometry>
    <phongMaterial id="floorMaterial" color={[0.16, 0.18, 0.2, 1]} roughness={0.5}></phongMaterial>
    {#each orbs as orb (orb.id)}
      <phongMaterial id={`${orb.id}-material`} color={orb.color} metalness={orb.metalness} roughness={orb.roughness}></phongMaterial>
    {/each}
  </resources>
  <PhongLights />
  <mesh geometry="floor" material="floorMaterial" position={[0, -0.8, 0]}></mesh>
  {#each orbs as orb (orb.id)}
    <PhongOrb material={`${orb.id}-material`} position={orb.position} scale={orb.scale} />
  {/each}
</scene>
