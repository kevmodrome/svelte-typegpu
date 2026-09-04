<script lang="ts">
  import {
    createSmokyTriangleFragment,
    defaultSmokyTriangleControls,
    type SmokyTriangleControls
  } from './smoky-triangle-fragment';

  let {
    controls: smokyTriangleControls = defaultSmokyTriangleControls
  }: { controls?: SmokyTriangleControls } = $props();
  let smokyTriangleFragment = $derived(createSmokyTriangleFragment(smokyTriangleControls));
  let smokyTriangleUniforms = $derived({
    time: 'time' as const,
    resolution: 'resolution' as const,
    value0: smokyTriangleControls.fromColor,
    value1: smokyTriangleControls.toColor
  });
</script>

<scene clearColor={[0.025, 0.03, 0.04, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[0, 0, 4]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={20}
  ></perspectiveCamera>

  <shaderPass
    fragment={smokyTriangleFragment}
    uniforms={smokyTriangleUniforms}
  ></shaderPass>
</scene>
