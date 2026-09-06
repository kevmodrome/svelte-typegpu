<script lang="ts">
  import Campsite from './Campsite.typegpu.svelte';
  import Player from './Player.typegpu.svelte';
  import LandscapeModels from './Landscape.typegpu.svelte';
  import WorldCamera from './WorldCamera.typegpu.svelte';
  import { compactLandscape, type Landscape } from './landscape';
  import { createMovementInput, idleMovement, type Movement } from './player-input';
  import { createPlayerState, initialCameraDirection } from './player-controller';
  import type { WorldAssets } from './world';
  let {
    assets = null, paused = false, forest = true, dusk = false, shadows = true,
    selected = '', cameraVersion = 0, playerVersion = 0, touch = idleMovement,
    reducedMotion = false, landscape = compactLandscape, view = 'camp', onselect = (_key: string) => {},
    frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror
  }: {
    assets?: WorldAssets | null; paused?: boolean; forest?: boolean; dusk?: boolean;
    shadows?: boolean; selected?: string; cameraVersion?: number; onselect?: (key: string) => void;
    playerVersion?: number; touch?: Movement; reducedMotion?: boolean;
    landscape?: Landscape; view?: 'camp' | 'follow' | 'overview';
    frameloop?: 'always' | 'demand' | 'manual'; maxDevicePixelRatio?: number;
    onready?: (root: import('svelte-typegpu').TypeGpuRoot) => void;
    onfps?: (fps: number) => void; onrenderererror?: (error: unknown) => void;
  } = $props();
  let width = $state(0), height = $state(0);
  const narrow = $derived(width > 0 && height > width * 0.9);
  let keys = $state(idleMovement);
  const cameraKey = $derived(`${cameraVersion}:${view}:${landscape.halfWidth}`);
  const playerKey = $derived(`${playerVersion}:${landscape.placements.length}`);
  let cameraView = $state.raw({ key: '', direction: initialCameraDirection });
  const camera = $derived(cameraView.key === cameraKey ? cameraView.direction
    : view === 'follow' ? { x: 8, z: 11 } : view === 'overview' ? { x: 1.9, z: 2.5 } : initialCameraDirection);
  const spawn = createPlayerState();
  let playerView = $state.raw({ key: '', position: [spawn.x, spawn.y, spawn.z] as import('svelte-typegpu').Vector3Tuple });
  const focus = $derived(playerView.key === playerKey ? playerView.position : [spawn.x, spawn.y, spawn.z] as import('svelte-typegpu').Vector3Tuple);
  const keyboard = createMovementInput(value => keys = value);
  const movement = $derived({ x: keys.x + touch.x, z: keys.z + touch.z, run: keys.run || touch.run });
</script>

<canvas aria-label="Pinewater campsite" {frameloop} {maxDevicePixelRatio}
  tabindex={0} aria-keyshortcuts="W A S D ArrowUp ArrowDown ArrowLeft ArrowRight Shift Escape"
  {@attach (element: HTMLCanvasElement) => {
    playerKey; paused; keyboard.clear();
    return keyboard.attach(element);
  }}
  onpointerdown={event => (event.currentTarget as HTMLCanvasElement).focus({ preventScroll: true })}
  onkeydown={event => { if (assets && !paused) keyboard.keydown(event); }} onkeyup={keyboard.keyup}
  bind:clientWidth={width} bind:clientHeight={height}
  {onready} {onfps} {onrenderererror}>
  <scene clearColor={dusk ? [0.11, 0.14, 0.2, 1] : [0.64, 0.77, 0.82, 1]}>
    {#key cameraKey}
      <WorldCamera {view} {narrow} {focus} extent={landscape.halfWidth}
        onchange={({ position, target }) => cameraView = { key: cameraKey,
          direction: { x: position[0] - target[0], z: position[2] - target[2] } }} />
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
      <boxGeometry width={landscape.halfWidth * 2} height={0.9} depth={landscape.halfDepth * 2} />
      <standardMaterial color={[0.26, 0.32, 0.28]} roughness={1} metalness={0} />
    </mesh>
    {#each [[(2 - landscape.halfWidth) / 2, landscape.halfWidth + 2], [(5 + landscape.halfWidth) / 2, landscape.halfWidth - 5]] as [x, width], bank (bank)}
      <mesh position={[x, -0.1, 0]} receiveShadow>
        <boxGeometry {width} height={0.2} depth={landscape.halfDepth * 2} />
        <standardMaterial color={[0.37, 0.58, 0.39]} roughness={1} metalness={0} />
      </mesh>
    {/each}
    <mesh position={[3.5, -0.1, 0]} receiveShadow>
      <planeGeometry width={3} height={landscape.halfDepth * 2} />
      <standardMaterial color={dusk ? [0.12, 0.35, 0.46] : [0.2, 0.65, 0.76]}
        roughness={0.22} metalness={0.05} cullMode="none" />
    </mesh>
    <mesh position={[-2.7, 0.006, 3.9]} receiveShadow>
      <planeGeometry width={6.5} height={1.25} />
      <standardMaterial color={[0.69, 0.72, 0.56]} roughness={1} metalness={0} cullMode="none" />
    </mesh>
    {#if assets}
      <Campsite {assets} paused={paused || reducedMotion} {forest} {selected} {onselect} />
      <LandscapeModels {assets} {landscape} {forest} />
      {#key playerKey}
        <Player {movement} {camera} {forest} {paused} {reducedMotion} {landscape}
          onposition={position => playerView = { key: playerKey, position }} />
      {/key}
    {/if}
  </scene>
</canvas>

<style>
  canvas { display: block; width: 100%; height: 100%; touch-action: none; }
  canvas:focus-visible { outline: 2px solid #f1d264; outline-offset: -3px; }
</style>
