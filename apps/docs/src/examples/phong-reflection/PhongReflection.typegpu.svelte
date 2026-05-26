<script lang="ts">
  import PhongLights from './PhongLights.typegpu.svelte';
</script>

<scene clearColor={[28 / 255, 28 / 255, 28 / 255, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[-10, 4, -8]}
    target={[0, 1, 0]}
    fov={45}
    near={0.1}
    far={1000}
  >
    <controls mode="orbit" minDistance={8} maxDistance={40}>
      <pointerControls
        dragButton="primary"
        rotateSpeed={0.72}
        wheel="zoom"
        zoomSpeed={0.7}
        touch="orbit-pinch"
      ></pointerControls>
    </controls>
  </perspectiveCamera>

  <PhongLights />

  <model
    src="/assets/phong/teapot.obj"
    position={[0, 0, 0]}
    rotation={[0, Math.PI, 0]}
    scale={[1, 1, 1]}
    hitTest="bounds"
  >
    <phongMaterial
      color={[1, 1, 1, 1]}
      roughness={0.72}
      metalness={0}
    ></phongMaterial>
  </model>
</scene>
