<script lang="ts">
  import { createCubeField, sceneCameraForCount } from './lib/cube-field';
  import { demoColorForIndex } from './lib/demo-colors';
  import { cameraLookAt, type SceneControls } from './lib/scene-controls';

  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
  }

  let { controls, onShapeClick = () => {} }: Props = $props();
  let boxes = $derived(createCubeField(controls.cubeCount));
  let frame = $derived(sceneCameraForCount(controls.cubeCount));
  let baseSize = $derived(frame.cubeSize);
  let animationSpeed = $derived(controls.spinEnabled ? controls.spinSpeed : 0);
  const spinFactors = [0.35, 0.55, 0.8, 1, 1.25, 1.55, 1.85];

  function boxWidth(index: number) {
    return baseSize * (index % 11 === 0 ? 1.8 : 1);
  }

  function boxHeight(index: number) {
    return baseSize * (index % 7 === 0 ? 0.55 : 1);
  }

  function boxDepth(index: number) {
    return baseSize * (index % 13 === 0 ? 1.45 : 1);
  }

  function isRoundShape(index: number) {
    return index % 10 === 5;
  }

  function sphereSize(index: number) {
    return baseSize * (index % 7 === 0 ? 1.45 : 1.15);
  }

  function spinSpeedForIndex(index: number) {
    return spinFactors[index % spinFactors.length];
  }

  function activateShapeFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      onShapeClick();
    }
  }
</script>

<scene scale={controls.cubeScale} {animationSpeed} colorShift={controls.hue}>
  <perspectiveCamera
    position={controls.camera.position}
    lookAt={cameraLookAt(controls.camera)}
    fov={controls.camera.fov}
    near={controls.camera.near}
    far={controls.camera.far}
  ></perspectiveCamera>

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

  <group rotation={[0, (controls.hue * Math.PI) / 180, 0]}>
    <pointLight
      position={[frame.floorSize * 0.35, frame.floorSize * 0.28, frame.floorSize * 0.2]}
      color={[1, 0.52, 0.28]}
      intensity={5.5}
      range={16}
      decay={2}
    ></pointLight>
  </group>

  <spotLight
    position={[0, frame.floorSize * 0.65, frame.floorSize * 0.55]}
    lookAt={[0, 0, 0]}
    color={[0.58, 0.76, 1]}
    intensity={7}
    range={22}
    angle={0.42}
    penumbra={0.35}
  ></spotLight>

  {#each boxes as box, index (box.id)}
    {#if isRoundShape(index)}
      <mesh
        role="button"
        tabindex="0"
        aria-label="Change sphere color"
        position={box.position}
        phase={box.phase}
        spinSpeed={spinSpeedForIndex(index + 3)}
        onclick={onShapeClick}
        onkeydown={activateShapeFromKeyboard}
      >
        <sphereGeometry
          radius={sphereSize(index) / 2}
          width={sphereSize(index)}
          height={sphereSize(index)}
          depth={sphereSize(index)}
        ></sphereGeometry>
        <standardMaterial
          color={demoColorForIndex(index + 7, 28)}
          roughness={0.18}
          metalness={0.28}
        ></standardMaterial>
      </mesh>
    {:else}
      <mesh
        role="button"
        tabindex="0"
        aria-label="Change box color"
        position={box.position}
        phase={box.phase}
        spinSpeed={spinSpeedForIndex(index)}
        onclick={onShapeClick}
        onkeydown={activateShapeFromKeyboard}
      >
        <boxGeometry
          width={boxWidth(index)}
          height={boxHeight(index)}
          depth={boxDepth(index)}
        ></boxGeometry>
        <standardMaterial
          color={demoColorForIndex(index, 0)}
          roughness={0.62}
          metalness={0.04}
        ></standardMaterial>
      </mesh>
    {/if}
  {/each}
</scene>
