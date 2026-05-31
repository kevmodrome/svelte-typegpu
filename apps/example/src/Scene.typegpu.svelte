<script lang="ts">
  import { sineInOut } from 'svelte/easing';
  import { Tween, prefersReducedMotion } from 'svelte/motion';
  import Cube from './Cube.typegpu.svelte';
  import FeatureSphere from './FeatureSphere.typegpu.svelte';
  import Quadrant from './Quadrant.typegpu.svelte';
  import { sceneCameraForCount } from './lib/cube-field';
  import { createCubeQuadrants, type QuadrantCubeInstance } from './lib/cube-quadrants';
  import { demoColorForIndex } from './lib/demo-colors';
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

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

  const SCALE_TWEEN_MS = 180;

  let {
    controls,
    onShapeClick = () => {},
    onCameraChange = () => {}
  }: Props = $props();

  let frame = $derived(sceneCameraForCount(controls.cubeCount));
  let cubeSize = $derived(frame.cubeSize);
  let quadrants = $derived(createCubeQuadrants(controls.cubeCount, frame.floorSize));
  let smoothScale = Tween.of(() => controls.cubeScale, {
    duration: () => (prefersReducedMotion.current ? 0 : SCALE_TWEEN_MS),
    easing: sineInOut
  });
  let sceneScale = $derived(smoothScale.current);
  let featureOffset = $derived(Math.max(1.4, frame.floorSize * 0.18));
  let featureScale = $derived(Math.max(0.55, cubeSize * 2.2) * sceneScale);

  function cubeKey(box: QuadrantCubeInstance): number {
    return box.id;
  }

  function cubeTransform(box: QuadrantCubeInstance): InstanceTransform {
    return {
      position: box.position,
      scale: [
        cubeSize * sceneScale,
        cubeSize * sceneScale,
        cubeSize * sceneScale
      ]
    };
  }

  function cubeColor(box: QuadrantCubeInstance): RgbaTuple {
    return demoColorForIndex(box.id, box.colorOffset);
  }

  function handleCameraChange(event: CustomEvent<CameraChangeDetail>) {
    onCameraChange(event.detail);
  }
</script>

<scene clearColor={[0.067, 0.078, 0.102, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={controls.camera.position}
    target={controls.camera.target}
    fov={controls.camera.fov}
    near={controls.camera.near}
    far={controls.camera.far}
  >
    <controls mode="fly" minDistance={1} maxDistance={100} oncamerachange={handleCameraChange}>
      <pointerControls rotateSpeed={controls.mouseSensitivity}></pointerControls>
      <keyboardControls
        rotateLeft="ArrowLeft"
        rotateRight="ArrowRight"
        rotateUp="ArrowUp"
        rotateDown="ArrowDown"
        zoomIn="+"
        zoomOut="-"
        moveForward="KeyW"
        moveBackward="KeyS"
        moveLeft="KeyA"
        moveRight="KeyD"
        moveUp="Space"
        moveDown="KeyC"
        step={0.08}
        moveStep={0.35}
        smooth={true}
      ></keyboardControls>
    </controls>
  </perspectiveCamera>

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

  {#each quadrants as quadrant (quadrant.id)}
    <Quadrant {quadrant} getKey={cubeKey} getTransform={cubeTransform} getColor={cubeColor} />
  {/each}

  <Cube
    ariaLabel="Change featured cube color"
    color={demoColorForIndex(3, 24)}
    position={[-featureOffset, featureScale * 0.7, -featureOffset]}
    scale={[featureScale, featureScale * 0.7, featureScale]}
    onActivate={onShapeClick}
  />

  <FeatureSphere
    ariaLabel="Change featured sphere color"
    position={[featureOffset, featureScale * 0.8, featureOffset]}
    color={demoColorForIndex(7, 38)}
    onActivate={onShapeClick}
  />
</scene>
