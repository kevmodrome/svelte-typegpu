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

  type DiscoPattern =
    | 'pattern1'
    | 'pattern2'
    | 'pattern3'
    | 'pattern4'
    | 'pattern5'
    | 'pattern6'
    | 'pattern7';

  interface DiscoControls {
    pattern: DiscoPattern;
  }

  const fragments = {
    pattern1: discoFragment1,
    pattern2: discoFragment2,
    pattern3: discoFragment3,
    pattern4: discoFragment4,
    pattern5: discoFragment5,
    pattern6: discoFragment6,
    pattern7: discoFragment7
  } satisfies Record<DiscoPattern, typeof discoFragment1>;

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
    fragment={fragments[discoControls.pattern]}
    uniforms={{ time: 'time', resolution: 'resolution' }}
    renderOrder={0}
  ></shaderPass>
</scene>
