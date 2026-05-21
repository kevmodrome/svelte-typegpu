<script lang="ts">
  import Box from './Box.typegpu.svelte';
  import Sphere from './Sphere.typegpu.svelte';
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
  let baseSize = $derived(controls.cubeScale * frame.cubeSize);
  let spinSpeed = $derived(controls.spinEnabled ? controls.spinSpeed : 0);

  function boxWidth(index: number) {
    return baseSize * (index % 11 === 0 ? 1.8 : 1);
  }

  function boxHeight(index: number) {
    return baseSize * (index % 7 === 0 ? 0.55 : 1);
  }

  function boxDepth(index: number) {
    return baseSize * (index % 13 === 0 ? 1.45 : 1);
  }

  function isSphere(index: number) {
    return index % 10 === 5;
  }

  function sphereSize(index: number) {
    return baseSize * (index % 7 === 0 ? 1.45 : 1.15);
  }
</script>

<scene>
  <perspectiveCamera
    position={controls.camera.position}
    lookAt={cameraLookAt(controls.camera)}
    fov={controls.camera.fov}
    near={controls.camera.near}
    far={controls.camera.far}
  ></perspectiveCamera>

  {#each boxes as box, index (box.id)}
    {#if isSphere(index)}
      <Sphere
        position={box.position}
        phase={box.phase}
        color={demoColorForIndex(index + 7, controls.hue + 28)}
        width={sphereSize(index)}
        height={sphereSize(index)}
        depth={sphereSize(index)}
        {spinSpeed}
        onclick={onShapeClick}
      />
    {:else}
      <Box
        position={box.position}
        phase={box.phase}
        color={demoColorForIndex(index, controls.hue)}
        width={boxWidth(index)}
        height={boxHeight(index)}
        depth={boxDepth(index)}
        {spinSpeed}
        onclick={onShapeClick}
      />
    {/if}
  {/each}
</scene>
