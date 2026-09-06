<script lang="ts">
  import type { TypeGpuFrameContext } from 'svelte-typegpu';
  import { createPlayerController, createPlayerState, initialCameraDirection, type CameraDirection } from './player-controller';
  import { idleMovement, type Movement } from './player-input';
  import { compactLandscape, type Landscape } from './landscape';
  let { movement = idleMovement, camera = initialCameraDirection, forest = true, paused = false,
    reducedMotion = false, landscape = compactLandscape, onposition }: {
    movement?: Movement; camera?: CameraDirection; forest?: boolean; paused?: boolean; reducedMotion?: boolean;
    landscape?: Landscape; onposition?: (position: import('svelte-typegpu').Vector3Tuple) => void;
  } = $props();
  const player = $state(createPlayerState());
  const controller = $derived(createPlayerController(landscape));
  const active = $derived(!paused && (movement.x !== 0 || movement.z !== 0));
  const stride = $derived(active && !reducedMotion ? player.stride : 0);
  function update({ delta }: TypeGpuFrameContext) {
    const x = player.x, z = player.z;
    controller.step(player, movement, delta, camera, forest);
    if (x !== player.x || z !== player.z) onposition?.([player.x, player.y, player.z]);
  }
</script>

<frameTask {update} {active} {@attach () => { controller; }} />
<group name="camper" position={[player.x, player.y, player.z]} rotation={[0, player.heading, 0]}>
  <mesh position={[0, 0.012, 0]} scale={[1, 0.025, 1]}>
    <sphereGeometry radius={0.43} widthSegments={16} heightSegments={4} />
    <basicMaterial color={[1, 0.9, 0.4]} />
  </mesh>
  <mesh position={[0, 0.86, 0]} castShadow>
    <boxGeometry width={0.52} height={0.62} depth={0.32} />
    <standardMaterial color={[0.84, 0.12, 0.23]} roughness={1} />
  </mesh>
  <mesh position={[0, 0.88, -0.25]} castShadow>
    <boxGeometry width={0.4} height={0.48} depth={0.22} />
    <standardMaterial color={[0.96, 0.69, 0.19]} roughness={1} />
  </mesh>
  <mesh position={[0, 1.36, 0.025]} castShadow>
    <sphereGeometry radius={0.25} widthSegments={8} heightSegments={6} />
    <standardMaterial color={[0.96, 0.72, 0.52]} roughness={1} />
  </mesh>
  <mesh position={[0, 1.54, 0]} castShadow>
    <boxGeometry width={0.48} height={0.17} depth={0.47} />
    <standardMaterial color={[0.12, 0.32, 0.76]} roughness={1} />
  </mesh>
  <mesh position={[0, 1.48, 0.22]} castShadow>
    <boxGeometry width={0.48} height={0.06} depth={0.22} />
    <standardMaterial color={[0.12, 0.32, 0.76]} roughness={1} />
  </mesh>
  {#each [-1, 1] as side (side)}
    <group position={[side * 0.16, 0.59, 0]} rotation={[side * stride, 0, 0]}>
      <mesh position={[0, -0.25, 0]} castShadow>
        <boxGeometry width={0.2} height={0.5} depth={0.22} />
        <standardMaterial color={[0.16, 0.2, 0.3]} roughness={1} />
      </mesh>
      <mesh position={[0, -0.51, 0.07]} castShadow>
        <boxGeometry width={0.23} height={0.14} depth={0.35} />
        <standardMaterial color={[0.12, 0.13, 0.14]} roughness={1} />
      </mesh>
    </group>
    <group position={[side * 0.36, 1.09, 0]} rotation={[-side * stride, 0, side * 0.08]}>
      <mesh position={[0, -0.2, 0]} castShadow>
        <boxGeometry width={0.18} height={0.44} depth={0.22} />
        <standardMaterial color={[0.84, 0.12, 0.23]} roughness={1} />
      </mesh>
    </group>
  {/each}
</group>
