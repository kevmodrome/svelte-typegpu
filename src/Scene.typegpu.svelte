<script lang="ts">
  import { createCubeField, sceneCameraForCount, type CubeInstance } from './lib/cube-field';
  import { demoColorForIndex } from './lib/demo-colors';
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';
  import type { RgbaTuple, Vector3Tuple } from './lib/typegpu-renderer/types';

  interface InstanceTransform {
    position: Vector3Tuple;
    rotation?: Vector3Tuple;
    scale: Vector3Tuple;
  }

  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
    onCameraChange?: (detail: CameraChangeDetail) => void;
  }

  let {
    controls,
    onShapeClick = () => {},
    onCameraChange = () => {}
  }: Props = $props();

  let boxes = $derived(createCubeField(controls.cubeCount));
  let frame = $derived(sceneCameraForCount(controls.cubeCount));
  let cubeSize = $derived(frame.cubeSize);
  let animationSpeed = $derived(controls.spinEnabled ? controls.spinSpeed : 0);
  let featureOffset = $derived(Math.max(1.4, frame.floorSize * 0.18));
  let featureScale = $derived(Math.max(0.55, cubeSize * 2.2));

  function cubeKey(box: CubeInstance): number {
    return box.id;
  }

  function cubeTransform(box: CubeInstance): InstanceTransform {
    return {
      position: box.position,
      scale: [cubeSize, cubeSize, cubeSize]
    };
  }

  function cubeColor(box: CubeInstance): RgbaTuple {
    return demoColorForIndex(box.id, 0);
  }

  function activateShapeFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      onShapeClick();
    }
  }

  function handleCameraChange(event: CustomEvent<CameraChangeDetail>) {
    onCameraChange(event.detail);
  }
</script>

<scene
  scale={controls.cubeScale}
  {animationSpeed}
  colorShift={controls.hue}
  clearColor={[0.067, 0.078, 0.102, 1]}
>
  <perspectiveCamera
    id="main"
    active={true}
    position={controls.camera.position}
    target={controls.camera.target}
    fov={controls.camera.fov}
    near={controls.camera.near}
    far={controls.camera.far}
  ></perspectiveCamera>

  <orbitControls
    camera="main"
    target={controls.camera.target}
    minDistance={1}
    maxDistance={100}
    rotateSpeed={controls.mouseSensitivity}
    zoomSpeed={1}
    oncamerachange={handleCameraChange}
  ></orbitControls>

  <resources>
    <boxGeometry id="cube" width={1} height={1} depth={1}></boxGeometry>
    <texture id="checker" src="/textures/checker.svg"></texture>
    <sampler id="repeatLinear" addressModeU="repeat" addressModeV="repeat"></sampler>
    <phongMaterial
      id="fieldMaterial"
      color={[1, 1, 1, 1]}
      map="checker"
      sampler="repeatLinear"
    ></phongMaterial>
    <standardMaterial
      id="featureMaterial"
      color={[0.94, 0.9, 0.82, 1]}
      roughness={0.18}
      metalness={0.28}
    ></standardMaterial>
  </resources>

  <ambientLight color={[1, 1, 1]} intensity={0.18}></ambientLight>
  <hemisphereLight
    skyColor={[0.48, 0.62, 1]}
    groundColor={[0.18, 0.12, 0.08]}
    intensity={0.38}
  ></hemisphereLight>
  <directionalLight
    rotation={[-0.82, 0.35, 0]}
    color={[1, 0.96, 0.88]}
    intensity={1.45}
  ></directionalLight>
  <pointLight
    position={[frame.floorSize * 0.35, frame.floorSize * 0.28, frame.floorSize * 0.2]}
    color={[1, 0.52, 0.28]}
    intensity={5.5}
    range={16}
    decay={2}
  ></pointLight>

  <instancedMesh
    geometry="cube"
    material="fieldMaterial"
    instances={boxes}
    getKey={cubeKey}
    getTransform={cubeTransform}
    getColor={cubeColor}
    phase={0}
    spinSpeed={animationSpeed}
  ></instancedMesh>

  <mesh
    role="button"
    tabindex="0"
    aria-label="Change featured cube color"
    geometry="cube"
    material="featureMaterial"
    color={demoColorForIndex(3, 24)}
    position={[-featureOffset, featureScale * 0.7, -featureOffset]}
    scale={[featureScale, featureScale * 0.7, featureScale]}
    spinSpeed={animationSpeed * 1.35}
    onclick={onShapeClick}
    onkeydown={activateShapeFromKeyboard}
  ></mesh>

  <mesh
    role="button"
    tabindex="0"
    aria-label="Change featured sphere color"
    position={[featureOffset, featureScale * 0.8, featureOffset]}
    color={demoColorForIndex(7, 38)}
    spinSpeed={animationSpeed * 1.7}
    onclick={onShapeClick}
    onkeydown={activateShapeFromKeyboard}
  >
    <sphereGeometry radius={0.45} widthSegments={24} heightSegments={12}></sphereGeometry>
    <standardMaterial color={[0.62, 0.76, 1, 1]} roughness={0.24} metalness={0.18}></standardMaterial>
  </mesh>
</scene>
