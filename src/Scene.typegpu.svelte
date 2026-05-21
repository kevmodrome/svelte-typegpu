<script lang="ts">
  import Box from './Box.typegpu.svelte';
  import { createCubeField, sceneCameraForCount } from './lib/cube-field';
  import { demoColorForIndex } from './lib/demo-colors';
  import type { SceneControls } from './lib/scene-controls';

  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
  }

  let { controls, onShapeClick = () => {} }: Props = $props();
  let boxes = $derived(createCubeField(controls.cubeCount));
  let camera = $derived(sceneCameraForCount(controls.cubeCount));
  let baseSize = $derived(controls.cubeScale * camera.cubeSize);
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
</script>

<scene>
  <perspectiveCamera
    position={camera.position}
    lookAt={camera.lookAt}
    fov={45}
    near={0.1}
    far={100}
  ></perspectiveCamera>

  {#each boxes as box, index (box.id)}
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
  {/each}
</scene>
