<script lang="ts">
  import { onDestroy } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import type { TypeGpuRoot } from 'svelte-typegpu';
  import Courtyard from './Courtyard.typegpu.svelte';
  import { emptyProfile, profileWorld } from '../asset-world/world-profile';
  let { frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror } = $props();
  let count = $state(6000), segments = $state(32), occlusion = $state(true), walls = $state(true), sweep = $state(false), cameraX = $state(0);
  let profile = $state.raw(emptyProfile), profiler: ReturnType<typeof profileWorld> | undefined;
  function ready(root: TypeGpuRoot) { profiler?.dispose(); profiler = profileWorld(root, value => profile = value); onready?.(root); }
  function fps(value: number) { profiler?.sample(); onfps?.(value); }
  onDestroy(() => profiler?.dispose());
</script>

<div class="occlusion-example">
  <Courtyard {count} {segments} {occlusion} {walls} sweep={sweep && !prefersReducedMotion.current} {cameraX}
    {frameloop} {maxDevicePixelRatio} onready={ready} onfps={fps} {onrenderererror} />
  <div class="toolbar" role="group" aria-label="Occlusion controls">
    <label><input type="checkbox" bind:checked={occlusion} /> Hi-Z occlusion</label>
    <label><input type="checkbox" bind:checked={walls} /> Walls</label>
    <label><input type="checkbox" bind:checked={sweep} /> Camera sweep</label>
    <label>Objects <select aria-label="Object count" bind:value={count}>
      <option value={6000}>6,000</option><option value={20000}>20,000</option><option value={50000}>50,000</option>
    </select></label>
    <label>Detail <select aria-label="Sphere detail" bind:value={segments}>
      <option value={16}>16 segments</option><option value={32}>32 segments</option><option value={64}>64 segments</option>
    </select></label>
    <label>Camera <input aria-label="Camera position" type="range" min={-35} max={35} step={0.1} bind:value={cameraX} disabled={sweep} /></label>
  </div>
  <dl aria-label="Occlusion workload">
    <div><dt>Occlusion</dt><dd data-metric="occlusion">{profile.occlusion}</dd></div>
    <div><dt>Color commands</dt><dd>{profile.colorDraws}</dd></div>
    <div><dt>{profile.colorCountsExact ? 'Color triangles' : 'Triangles (upper bound)'}</dt><dd>{profile.colorTriangles.toLocaleString('en-US')}</dd></div>
    <div><dt>Render CPU</dt><dd>{profile.renderCpuMs.toFixed(2)} ms</dd></div>
  </dl>
</div>

<style>
  .occlusion-example { color: #e5ecea; background: #1c2522; min-width: 0; font-size: 13px; }
  .toolbar { display: flex; flex-wrap: wrap; gap: 12px 20px; padding: 14px 16px; border-top: 1px solid #3b4943; }
  label { display: flex; align-items: center; gap: 7px; min-width: 0; }
  input, select { accent-color: #65c7a2; }
  select { color: inherit; background: #27322f; border: 1px solid #51625b; border-radius: 4px; padding: 5px; }
  input[type='range'] { width: 120px; }
  dl { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0; padding: 14px 16px; border-top: 1px solid #3b4943; }
  dt { color: #afc0b8; font-size: 11px; } dd { margin: 5px 0 0; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
  @media (max-width: 600px) { dl { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
