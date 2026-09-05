<script lang="ts">
  import { onDestroy } from 'svelte';
  import { Spring, Tween } from 'svelte/motion';
  import { cubicInOut } from 'svelte/easing';
  import type { Vector3Tuple } from 'svelte-typegpu';
  import MotionMarker from './MotionMarker.typegpu.svelte';
  import { motionField, type MotionControls } from './motion-field';

  let { controls, onTargetChange }: {
    controls: MotionControls;
    onTargetChange: (x: number, z: number) => void;
  } = $props();

  const position = new Tween<Vector3Tuple>([-7, 2, -7], { duration: 1600, easing: cubicInOut });
  const lift = new Spring(0, { stiffness: 0.06, damping: 0.45 });

  $effect(() => {
    position.target = [controls.x, 2, controls.z];
  });
  $effect(() => {
    lift.target = controls.lift;
  });
  onDestroy(() => {
    void position.set(position.current, { duration: 0 });
    void lift.set(lift.current, { instant: true });
  });
</script>

<scene clearColor={[0.035, 0.04, 0.04, 1]}>
  <perspectiveCamera
    active={true}
    position={[22, 27, 33]}
    target={[0, 0, 0]}
    fov={42}
    near={0.1}
    far={150}
  >
    <controls mode="orbit" minDistance={20} maxDistance={85}>
      <pointerControls dragButton="primary" wheel="zoom" touch="orbit-pinch" />
    </controls>
  </perspectiveCamera>
  <ambientLight intensity={0.4} color={[1, 1, 1]} />
  <directionalLight position={[8, 20, 10]} lookAt={[0, 0, 0]} intensity={0.9} />

  {#each motionField as cell (cell.id)}
    <mesh
      position={cell.position}
      scale={cell.scale}
      onclick={() => onTargetChange(cell.position[0], cell.position[2])}
    >
      <boxGeometry />
      <standardMaterial color={cell.color} />
    </mesh>
  {/each}

  <MotionMarker position={position.current} lift={lift.current} visible={controls.visible} />
</scene>
