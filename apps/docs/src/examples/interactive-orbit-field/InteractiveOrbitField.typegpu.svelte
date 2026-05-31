<script lang="ts">
  import {
    discoFragment1,
    discoFragment2,
    discoFragment3,
    discoFragment4,
    discoFragment5,
    discoFragment6,
    discoFragment7
  } from './disco-fragment';

  interface DiscoControls {
    pattern: string;
  }

  const defaultDiscoControls: DiscoControls = {
    pattern: 'pattern1'
  };

  let { controls: discoControls = defaultDiscoControls }: { controls?: DiscoControls } = $props();
</script>

<scene clearColor={[0, 0, 0, 1]}>
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
    fragment={discoFragment1}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern1'}
    renderOrder={0}
  ></shaderPass>
  <shaderPass
    fragment={discoFragment2}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern2'}
    renderOrder={1}
  ></shaderPass>
  <shaderPass
    fragment={discoFragment3}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern3'}
    renderOrder={2}
  ></shaderPass>
  <shaderPass
    fragment={discoFragment4}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern4'}
    renderOrder={3}
  ></shaderPass>
  <shaderPass
    fragment={discoFragment5}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern5'}
    renderOrder={4}
  ></shaderPass>
  <shaderPass
    fragment={discoFragment6}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern6'}
    renderOrder={5}
  ></shaderPass>
  <shaderPass
    fragment={discoFragment7}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    active={discoControls.pattern === 'pattern7'}
    renderOrder={6}
  ></shaderPass>
</scene>
