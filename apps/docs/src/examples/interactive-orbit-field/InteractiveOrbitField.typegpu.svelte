<script lang="ts">
  import OrbitLights from './OrbitLights.typegpu.svelte';
  import OrbitSatellites from './OrbitSatellites.typegpu.svelte';
  import {
    createOrbitItems,
    getOrbitItemColor,
    getOrbitItemKey,
    getOrbitItemSpinSpeed,
    getOrbitItemTransform
  } from './orbit-data';

  const orbitItems = createOrbitItems();
</script>

<scene clearColor={[0.035, 0.044, 0.048, 1]} animationSpeed={0.92} colorShift={28}>
  <perspectiveCamera id="main" active={true} position={[3.7, 2.35, 5.1]} target={[0, 0, 0]} fov={42} near={0.1} far={100}>
    <controls mode="orbit" minDistance={2.4} maxDistance={8.2}>
      <pointerControls rotateSpeed={0.78} wheel="zoom" zoomSpeed={0.72} touch="orbit-pinch"></pointerControls>
    </controls>
  </perspectiveCamera>
  <resources>
    <boxGeometry id="satellite" width={1} height={1} depth={1}></boxGeometry>
    <sphereGeometry id="core" radius={1} widthSegments={32} heightSegments={18}></sphereGeometry>
    <planeGeometry id="deck" width={4.8} height={4.8}></planeGeometry>
    <standardMaterial id="orbitMaterial" color={[1, 1, 1, 1]} roughness={0.26} metalness={0.12}></standardMaterial>
    <standardMaterial id="coreMaterial" color={[0.92, 0.96, 0.86, 1]} roughness={0.18} metalness={0.24}></standardMaterial>
    <standardMaterial id="deckMaterial" color={[0.12, 0.15, 0.145, 1]} roughness={0.88} metalness={0.02}></standardMaterial>
  </resources>
  <OrbitLights />
  <mesh geometry="deck" material="deckMaterial" position={[0, -0.76, 0]}></mesh>
  <mesh geometry="core" material="coreMaterial" scale={[0.42, 0.42, 0.42]} phase={0.35} spinSpeed={0.22}></mesh>
  <OrbitSatellites
    items={orbitItems}
    getKey={getOrbitItemKey}
    getTransform={getOrbitItemTransform}
    getColor={getOrbitItemColor}
    getSpinSpeed={getOrbitItemSpinSpeed}
  />
</scene>
