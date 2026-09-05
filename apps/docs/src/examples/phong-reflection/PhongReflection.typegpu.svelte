<script lang="ts">
  import { getAbortSignal } from 'svelte';
  import { loadModel, type TypeGpuAttachment } from 'svelte-typegpu';
  import PhongLights from './PhongLights.typegpu.svelte';

  interface PhongControls {
    model?: { src: string };
    lightColor: [number, number, number];
    lightDirection: [number, number, number];
    ambientColor: [number, number, number];
    ambientStrength: number;
    specularExponent: number;
  }

  const defaultPhongControls: PhongControls = {
    lightColor: [0.8, 0.8, 0.8],
    lightDirection: [0, 7, -7],
    ambientColor: [1, 0.7, 0],
    ambientStrength: 0.5,
    specularExponent: 8
  };

  let {
    controls: phongControls = defaultPhongControls,
    onModelStatus = () => {}
  }: { controls?: PhongControls; onModelStatus?: (message: string) => void } = $props();

  const request = $derived(loadModel(phongControls.model?.src ?? '/assets/phong/teapot.obj', {
    signal: getAbortSignal()
  }));
  const reportStatus = (message: string): TypeGpuAttachment => () => { onModelStatus(message); };
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

  <PhongLights
    lightColor={phongControls.lightColor}
    lightDirection={phongControls.lightDirection}
    ambientColor={phongControls.ambientColor}
    ambientStrength={phongControls.ambientStrength}
  />

  {#await request}
    <mesh position={[0, 1, 0]} {@attach reportStatus('Loading model...')}>
      <boxGeometry /><basicMaterial color={[0.4, 0.4, 0.4, 1]} />
    </mesh>
  {:then asset}
    <model
      {asset}
      rotation={[0, Math.PI, 0]}
      hitTest="bounds"
      {@attach reportStatus('Model ready')}
    >
      <phongMaterial
        color={[1, 1, 1, 1]}
        roughness={0.72}
        metalness={0}
        specularExponent={phongControls.specularExponent}
      />
    </model>
  {:catch error}
    <mesh position={[0, 1, 0]} {@attach reportStatus(error instanceof Error ? error.message : 'Unable to load model.')}>
      <boxGeometry /><basicMaterial color={[1, 0.15, 0.15, 1]} />
    </mesh>
  {/await}
</scene>
