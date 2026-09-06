<script lang="ts">
  import Campsite from './Campsite.typegpu.svelte';
  import type { WorldAssets } from './world';
  let {
    assets = null, paused = false, forest = true, dusk = false, shadows = true,
    selected = '', cameraVersion = 0, onselect = (_key: string) => {},
    frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror
  }: {
    assets?: WorldAssets | null; paused?: boolean; forest?: boolean; dusk?: boolean;
    shadows?: boolean; selected?: string; cameraVersion?: number; onselect?: (key: string) => void;
    frameloop?: 'always' | 'demand' | 'manual'; maxDevicePixelRatio?: number;
    onready?: (root: import('svelte-typegpu').TypeGpuRoot) => void;
    onfps?: (fps: number) => void; onrenderererror?: (error: unknown) => void;
  } = $props();
  let width = $state(0), height = $state(0);
  const narrow = $derived(width > 0 && height > width * 0.9);
</script>

<canvas aria-label="Pinewater campsite" {frameloop} {maxDevicePixelRatio}
  bind:clientWidth={width} bind:clientHeight={height}
  {onready} {onfps} {onrenderererror}>
  <scene clearColor={dusk ? [0.11, 0.14, 0.2, 1] : [0.64, 0.77, 0.82, 1]}>
    {#key cameraVersion}
      <perspectiveCamera active position={[17, 15, 21]} target={[0, 0.2, 0]} fov={narrow ? 64 : 43} far={160}>
        <controls mode="orbit" minDistance={12} maxDistance={50}>
          <pointerControls wheel="zoom" touch="orbit-pinch" />
        </controls>
      </perspectiveCamera>
    {/key}
    <hemisphereLight skyColor={[0.85, 0.93, 1]} groundColor={[0.22, 0.28, 0.23]}
      intensity={dusk ? 0.45 : 0.85} />
    <ambientLight intensity={dusk ? 0.14 : 0.5} />
    <directionalLight position={[-8, 14, 8]} lookAt={[0, 0, 0]}
      color={dusk ? [1, 0.65, 0.48] : [1, 0.96, 0.88]}
      intensity={dusk ? 0.65 : 1.1} castShadow={shadows} shadowMapSize={2048} />
    <pointLight position={[-2.8, 0.7, 1.8]} color={[1, 0.45, 0.13]}
      intensity={dusk ? 3 : 0} range={5} />

    <mesh position={[0, -0.6, 0]} receiveShadow>
      <boxGeometry width={20} height={0.9} depth={16} />
      <standardMaterial color={[0.26, 0.32, 0.28]} roughness={1} metalness={0} />
    </mesh>
    {#each [[-4, 12], [7.5, 5]] as [x, width] (x)}
      <mesh position={[x, -0.1, 0]} receiveShadow>
        <boxGeometry {width} height={0.2} depth={16} />
        <standardMaterial color={[0.37, 0.58, 0.39]} roughness={1} metalness={0} />
      </mesh>
    {/each}
    <mesh position={[3.5, -0.1, 0]} receiveShadow>
      <planeGeometry width={3} height={16} />
      <standardMaterial color={dusk ? [0.12, 0.35, 0.46] : [0.2, 0.65, 0.76]}
        roughness={0.22} metalness={0.05} cullMode="none" />
    </mesh>
    <mesh position={[-2.7, 0.006, 3.9]} receiveShadow>
      <planeGeometry width={6.5} height={1.25} />
      <standardMaterial color={[0.69, 0.72, 0.56]} roughness={1} metalness={0} cullMode="none" />
    </mesh>
    {#if assets}
      <Campsite {assets} {paused} {forest} {selected} {onselect} />
    {/if}
  </scene>
</canvas>

<style>
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
</style>
