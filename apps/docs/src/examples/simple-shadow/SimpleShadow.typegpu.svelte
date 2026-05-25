<script lang="ts">
  import ShadowLights from './ShadowLights.typegpu.svelte';
  import ShadowSubject from './ShadowSubject.typegpu.svelte';
</script>

<scene clearColor={[0.05, 0.055, 0.055, 1]} animationSpeed={0.18}>
  <perspectiveCamera id="main" active={true} position={[3.4, 2.6, 4.4]} target={[0, 0.02, 0]} fov={40} near={0.1} far={100}>
    <controls mode="orbit" minDistance={2.8} maxDistance={8.5}>
      <pointerControls rotateSpeed={0.68} wheel="zoom" zoomSpeed={0.65} touch="orbit-pinch"></pointerControls>
    </controls>
  </perspectiveCamera>
  <resources>
    <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>
    <planeGeometry id="floor" width={5} height={5}></planeGeometry>
    <standardMaterial id="floorMaterial" color={[0.22, 0.18, 0.3, 1]} roughness={0.82} metalness={0}></standardMaterial>
    <standardMaterial id="subjectMaterial" color={[0.85, 0.78, 0.68, 1]} roughness={0.42} metalness={0.08}></standardMaterial>
  </resources>
  <ShadowLights />
  <mesh geometry="floor" material="floorMaterial" position={[0, -0.72, 0]}></mesh>
  <ShadowSubject material="subjectMaterial" position={[0, -0.1, 0]} scale={[1, 1, 0.3]} />
</scene>
