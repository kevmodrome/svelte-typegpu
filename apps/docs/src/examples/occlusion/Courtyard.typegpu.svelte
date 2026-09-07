<script lang="ts">
  import type { TypeGpuFrameContext } from 'svelte-typegpu';
  import Wall from './Wall.typegpu.svelte';
  import Sculpture from './Sculpture.typegpu.svelte';
  let { count = 6000, segments = 32, occlusion = true, walls = true, sweep = false, cameraX = 0,
    frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror } = $props();
  let angle = $state(0);
  function update({ delta }: TypeGpuFrameContext) { angle += delta * 0.3; }
</script>

<canvas aria-label="Occlusion courtyard" {frameloop} {maxDevicePixelRatio} {onready} {onfps} {onrenderererror}>
  <scene occlusion={occlusion ? 'hi-z' : 'none'} clearColor={[0.06, 0.08, 0.1, 1]}>
    <perspectiveCamera active position={[sweep ? Math.sin(angle) * 32 : cameraX, 4, 24]}
      target={[0, 2, -12]} fov={55} far={180}>
      <controls mode="orbit" minDistance={3} maxDistance={100}>
        <pointerControls wheel="zoom" touch="orbit-pinch" />
      </controls>
    </perspectiveCamera>
    <ambientLight intensity={0.35} />
    <directionalLight position={[3, 10, 18]} intensity={0.65} />
    <frameTask {update} active={sweep} />
    {#if walls}
      <Wall position={[-9, 5, 3]} size={[15, 12, 1]} />
      <Wall position={[9, 5, 3]} size={[15, 12, 1]} />
    {/if}
    {#each Array(count) as _, index (index)}
      <Sculpture {index} {segments} />
    {/each}
  </scene>
</canvas>

<style>
  canvas { display: block; width: 100%; height: 455px; touch-action: none; }
  @media (max-width: 600px) { canvas { height: 380px; } }
</style>
