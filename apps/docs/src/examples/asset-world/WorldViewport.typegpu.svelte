<script lang="ts">
  import Campsite from './Campsite.typegpu.svelte';
  import Player from './Player.typegpu.svelte';
  import LandscapeModels from './Landscape.typegpu.svelte';
  import WorldCamera from './WorldCamera.typegpu.svelte';
  import WorldLighting from './WorldLighting.typegpu.svelte';
  import Terrain from './Terrain.typegpu.svelte';
  import { compactLandscape, type Landscape } from './landscape';
  import { createMovementInput, idleMovement, type Movement } from './player-input';
  import { createPlayerState, initialCameraDirection } from './player-controller';
  import type { WorldAssets } from './world';
  let {
    assets = null, paused = false, forest = true, dusk = false, shadows = true, frustumCulling = false, occlusion = false,
    selected = '', cameraVersion = 0, playerVersion = 0, touch = idleMovement,
    reducedMotion = false, landscape = compactLandscape, view = 'camp', onselect = (_key: string) => {},
    frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror
  }: {
    assets?: WorldAssets | null; paused?: boolean; forest?: boolean; dusk?: boolean;
    shadows?: boolean; frustumCulling?: boolean; occlusion?: boolean; selected?: string; cameraVersion?: number; onselect?: (key: string) => void;
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
  <scene {frustumCulling} occlusion={occlusion ? 'hi-z' : 'none'} clearColor={dusk ? [0.11, 0.14, 0.2, 1] : [0.64, 0.77, 0.82, 1]}>
    {#key cameraKey}
      <WorldCamera {view} {narrow} {focus} extent={landscape.halfWidth}
        onchange={({ position, target }) => cameraView = { key: cameraKey,
          direction: { x: position[0] - target[0], z: position[2] - target[2] } }} />
    {/key}
    <WorldLighting {dusk} {shadows} />
    <Terrain {landscape} {dusk} />
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
