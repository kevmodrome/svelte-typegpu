<script lang="ts">
  import ShadowLights from './ShadowLights.typegpu.svelte';
  import ShadowSubject from './ShadowSubject.typegpu.svelte';
</script>

<scene clearColor={[0.1, 0.1, 0.1, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[0, 2, 5]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={100}
  >
    <controls mode="orbit" minDistance={2} maxDistance={12}>
      <pointerControls
        dragButton="primary"
        rotateSpeed={0.7}
        wheel="zoom"
        zoomSpeed={0.7}
        touch="orbit-pinch"
      ></pointerControls>
    </controls>
  </perspectiveCamera>

  <resources>
    <boxGeometry id="cuboid" width={1} height={1} depth={0.3}></boxGeometry>
    <planeGeometry id="floor" width={5} height={5}></planeGeometry>
    <phongMaterial
      id="cuboid-material"
      color={[0.8, 0.7, 0.7, 1]}
      roughness={0.38}
      metalness={0}
    ></phongMaterial>
    <phongMaterial
      id="floor-material"
      color={[0.5, 0.4, 0.7, 1]}
      roughness={0.68}
      metalness={0}
      cullMode="none"
    ></phongMaterial>
  </resources>

  <ShadowLights />
  <mesh
    geometry="floor"
    material="floor-material"
    position={[0, 0, 0]}
    castShadow={true}
    receiveShadow={true}
  ></mesh>
  <ShadowSubject />
</scene>
