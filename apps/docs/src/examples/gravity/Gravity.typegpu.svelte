<script lang="ts">
  import { onMount } from 'svelte';
  import GravityBody from './GravityBody.typegpu.svelte';
  import {
    createGravityBodies,
    stepGravity,
    type GravityBody as GravityBodyData,
    type GravityPreset
  } from './gravity-simulation';

  interface GravityControls {
    preset: GravityPreset;
    speed: number;
  }

  const defaultGravityControls: GravityControls = {
    preset: 'Solar System',
    speed: 0
  };

  let { controls: gravityControls = defaultGravityControls }: { controls?: GravityControls } =
    $props();
  let bodies = $state<GravityBodyData[]>(createGravityBodies('Solar System'));

  onMount(() => {
    let frame = 0;
    let previous = performance.now();
    bodies = createGravityBodies(gravityControls.preset);

    function tick(now: number) {
      const delta = (now - previous) / 1000;
      previous = now;
      bodies = stepGravity(bodies, delta, 2 ** gravityControls.speed);
      frame = requestAnimationFrame(tick);
    }

    frame = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(frame);
  });
</script>

<scene clearColor={[0.015, 0.018, 0.026, 1]}>
  <perspectiveCamera
    id="main"
    active={true}
    position={[0, 5.2, 8.5]}
    target={[0, 0, 0]}
    fov={45}
    near={0.1}
    far={100}
  >
    <controls mode="orbit" minDistance={4} maxDistance={24}>
      <pointerControls
        dragButton="primary"
        rotateSpeed={0.7}
        wheel="zoom"
        zoomSpeed={0.7}
        touch="orbit-pinch"
      ></pointerControls>
    </controls>
  </perspectiveCamera>

  <ambientLight color={[0.25, 0.28, 0.38]} intensity={0.42}></ambientLight>
  <pointLight position={[0, 0, 0]} color={[1, 0.8, 0.5]} intensity={18} range={16}></pointLight>
  <directionalLight direction={[-0.35, -0.8, -0.25]} color={[0.5, 0.58, 0.8]} intensity={0.45}></directionalLight>

  {#each bodies as body (body.id)}
    <GravityBody {body} />
  {/each}
</scene>
