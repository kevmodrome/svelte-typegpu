<script lang="ts">
  import { onDestroy, untrack } from 'svelte';
  import { Spring, Tween, prefersReducedMotion } from 'svelte/motion';
  import { cubicInOut } from 'svelte/easing';
  import type { TypeGpuNodeEvent, Vector3Tuple } from 'svelte-typegpu';
  import MotionMarker from './MotionMarker.typegpu.svelte';
  import { motionField, type MotionControls } from './motion-field';

  let { controls, onTargetChange }: {
    controls: MotionControls;
    onTargetChange: (x: number, z: number) => void;
  } = $props();

  const position = new Tween<Vector3Tuple>([-7, 2, -7], { duration: 1600, easing: cubicInOut });
  const lift = new Spring(0, { stiffness: 0.06, damping: 0.45 });
  const appearance = new Tween(0, { duration: 900, easing: cubicInOut });

  function selectCell(event: TypeGpuNodeEvent) {
    const position = event.target.attributes.position as Vector3Tuple;
    onTargetChange(position[0], position[2]);
  }

  $effect(() => {
    const target: Vector3Tuple = [controls.x, 2, controls.z];
    const reduced = prefersReducedMotion.current;
    const previous = untrack(() => position.target);
    // Preference changes stop active motion without replaying an unchanged target.
    if (reduced || target.some((value, index) => value !== previous[index])) {
      void position.set(target, reduced ? { duration: 0 } : undefined);
    }
  });
  $effect(() => {
    const target = controls.lift;
    const reduced = prefersReducedMotion.current;
    if (reduced || target !== untrack(() => lift.target)) {
      void lift.set(target, reduced ? { instant: true } : undefined);
    }
  });
  $effect(() => {
    const target = controls.appearance;
    const reduced = prefersReducedMotion.current;
    if (reduced || target !== untrack(() => appearance.target)) {
      void appearance.set(target, reduced ? { duration: 0 } : undefined);
    }
  });
  onDestroy(() => {
    void position.set(position.current, { duration: 0 });
    void lift.set(lift.current, { instant: true });
    void appearance.set(appearance.current, { duration: 0 });
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

  <group onclick={selectCell}>
    {#each motionField.slice(0, controls.count) as cell (cell.id)}
      <mesh position={cell.position} scale={cell.scale}>
        <boxGeometry />
        <standardMaterial color={cell.color} />
      </mesh>
    {/each}
  </group>

  <MotionMarker position={position.current} lift={lift.current} visible={controls.visible} appearance={appearance.current} />
</scene>
