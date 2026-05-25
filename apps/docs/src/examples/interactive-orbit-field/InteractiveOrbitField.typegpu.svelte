<script lang="ts">
  import { discoFragment } from './disco-fragment';
</script>

<scene clearColor={[0, 0, 0, 1]} animationSpeed={1}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[0, 0, 1]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={10}
  ></perspectiveCamera>

  <shaderPass
    fragment={discoFragment}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={true}
    renderOrder={0}
  ></shaderPass>
</scene>
