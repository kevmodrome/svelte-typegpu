<script lang="ts">
  import ShadowLights from './ShadowLights.typegpu.svelte';
  import ShadowSubject from './ShadowSubject.typegpu.svelte';
  import type { TypeGpuCameraSettings, Vector3Tuple } from 'svelte-typegpu';

  interface SimpleShadowControls {
    cameraX: number;
    cameraPosition: Vector3Tuple;
    cameraTarget: Vector3Tuple;
    lightX: number;
    lightY: number;
    lightZ: number;
    cuboidThickness: number;
    shadowMapSize: number;
    shadowMapFiltering: boolean;
    displayMode: string;
  }

  interface CameraChangeDetail {
    camera: TypeGpuCameraSettings;
  }

  interface Props {
    controls?: SimpleShadowControls;
    onCameraChange?: (event: CustomEvent<CameraChangeDetail>) => void;
  }

  const defaultSimpleShadowControls: SimpleShadowControls = {
    cameraX: -4.9,
    cameraPosition: [-4.9, 2, 5],
    cameraTarget: [0, 0, 0],
    lightX: -0.5,
    lightY: -0.7,
    lightZ: -1,
    cuboidThickness: 0.3,
    shadowMapSize: 2048,
    shadowMapFiltering: true,
    displayMode: 'color'
  };
  let {
    controls: simpleShadowControls = defaultSimpleShadowControls,
    onCameraChange = () => {}
  }: Props = $props();
</script>

<scene clearColor={[0.1, 0.1, 0.1, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={simpleShadowControls.cameraPosition}
    target={simpleShadowControls.cameraTarget}
    fov={45}
    near={0.1}
    far={100}
  >
    <controls mode="orbit" minDistance={2} maxDistance={12} oncamerachange={onCameraChange}>
      <pointerControls
        dragButton="primary"
        rotateSpeed={0.7}
        wheel="zoom"
        zoomSpeed={0.7}
        touch="orbit-pinch"
      ></pointerControls>
    </controls>
  </perspectiveCamera>

  <ShadowLights
    lightDirection={[
      simpleShadowControls.lightX,
      simpleShadowControls.lightY,
      simpleShadowControls.lightZ
    ]}
    shadowMapSize={simpleShadowControls.shadowMapSize}
    shadowMapFiltering={simpleShadowControls.shadowMapFiltering}
    displayMode={simpleShadowControls.displayMode}
  />
  <mesh position={[0, 0, 0]} castShadow={true} receiveShadow={true}>
    <planeGeometry width={5} height={5}></planeGeometry>
    <phongMaterial
      color={[0.5, 0.4, 0.7, 1]}
      roughness={0.68}
      metalness={0}
      cullMode="none"
    ></phongMaterial>
  </mesh>
  <ShadowSubject cuboidThickness={simpleShadowControls.cuboidThickness} color={[0.8, 0.7, 0.7, 1]} />
</scene>
