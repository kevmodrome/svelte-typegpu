<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import WorldViewport from './WorldViewport.typegpu.svelte';
  import MovementPad from './MovementPad.svelte';
  import { Map, RotateCcw, Tent, UserRound } from '@lucide/svelte';
  import { idleMovement } from './player-input';
  import { assetCount, loadWorldAssets, selectable } from './world';
  import { campsiteModelCount, compactLandscape, createLandscape, worldCounts } from './landscape';
  import { detailWorldAssets } from './model-detail';
  import { emptyProfile, profileWorld } from './world-profile';
  import type { TypeGpuRoot } from 'svelte-typegpu';

  let { frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror } = $props();
  let assets = $state.raw<Awaited<ReturnType<typeof loadWorldAssets>> | null>(null);
  let loaded = $state(0), failure = $state(''), selected = $state('');
  let paused = $state(false), forest = $state(true), dusk = $state(false), shadows = $state(false);
  let count = $state(20000), detail = $state(1), preparing = $state(false);
  let view = $state<'camp' | 'follow' | 'overview'>('overview');
  let landscape = $state.raw(compactLandscape), profile = $state.raw(emptyProfile);
  let cameraVersion = $state(0), playerVersion = $state(0), touch = $state(idleMovement);
  let request: AbortController | undefined;
  let originals: Awaited<ReturnType<typeof loadWorldAssets>> | null = null, revision = 0;
  let profiler: ReturnType<typeof profileWorld> | undefined;
  async function rebuild() {
    if (!originals) return;
    const current = ++revision, source = originals, requestedCount = count, requestedDetail = detail;
    preparing = true; failure = '';
    // Let controls paint before the intentionally large, synchronous scene update.
    await new Promise(resolve => setTimeout(resolve, 0));
    if (current !== revision) return;
    try {
      const detailed = detailWorldAssets(source, requestedDetail);
      const layout = landscape.placements.length + campsiteModelCount === requestedCount ? landscape : createLandscape(requestedCount);
      assets = detailed; landscape = layout; touch = idleMovement;
    } catch (error) { failure = error instanceof Error ? error.message : 'Unable to prepare the world'; }
    finally { if (current === revision) preparing = false; }
  }
  function ready(root: TypeGpuRoot) {
    profiler?.dispose(); profiler = profileWorld(root, value => profile = value); onready?.(root);
  }
  function fps(value: number) { profiler?.sample(); onfps?.(value); }

  async function reload() {
    request?.abort();
    const current = request = new AbortController();
    revision++; originals = assets = null; loaded = 0; failure = ''; preparing = false;
    try {
      const result = await loadWorldAssets(current.signal, (count: number) => {
        if (request === current && !current.signal.aborted) loaded = count;
      });
      if (request === current && !current.signal.aborted) { originals = result; await rebuild(); }
    } catch (error) {
      if (request !== current || current.signal.aborted) return;
      current.abort();
      failure = error instanceof Error ? error.message : 'Unable to load the campsite';
    }
  }
  onMount(() => { void reload(); return () => { request?.abort(); revision++; profiler?.dispose(); }; });
</script>

<div class="asset-world" class:dusk>
  <div class="world-stage">
    <WorldViewport {assets} {landscape} {view} {forest} {dusk} {shadows} {selected} {cameraVersion} {playerVersion} {touch} {paused}
      reducedMotion={prefersReducedMotion.current}
      onselect={(key: string) => selected = key}
      {frameloop} {maxDevicePixelRatio} onready={ready} onfps={fps} {onrenderererror} />
    <div class="world-title"><strong>Pinewater</strong><span>Campsite No. 04</span></div>
    {#if assets}
      <div class="player-controls">
        {#key playerVersion}<MovementPad disabled={paused} onmove={value => touch = value} />{/key}
      </div>
    {/if}
    {#if failure}
      <div class="asset-status" role="alert"><span>{failure}</span><button type="button" onclick={reload}>Retry assets</button></div>
    {:else if preparing}
      <div class="asset-status" role="status">Preparing world</div>
    {:else if !assets}
      <div class="asset-status" role="status">
        <span>Loading campsite {loaded} / {assetCount}</span>
        <progress value={loaded} max={assetCount} aria-label="Model loading"></progress>
      </div>
    {/if}
  </div>
  <div class="stress-toolbar" role="group" aria-label="Performance controls">
    <label>Models <select aria-label="Model count" bind:value={count} onchange={rebuild}>
      {#each worldCounts as value}<option {value}>{value === campsiteModelCount ? 'Campsite (29)' : value.toLocaleString('en-US')}</option>{/each}
    </select></label>
    <label>Triangles <select aria-label="Triangle density" bind:value={detail} onchange={rebuild}>
      <option value={0}>1x / original</option><option value={1}>4x / dense</option><option value={2}>16x / very dense</option>
    </select></label>
    <div class="view-modes" role="group" aria-label="Camera view">
      {#each [{ key: 'camp', label: 'Campsite view', icon: Tent }, { key: 'follow', label: 'Follow camper', icon: UserRound }, { key: 'overview', label: 'World overview', icon: Map }] as mode}
        <button type="button" aria-label={mode.label} title={mode.label} aria-pressed={view === mode.key}
          onclick={() => view = mode.key as typeof view}><mode.icon size={17} aria-hidden="true" /></button>
      {/each}
    </div>
  </div>
  <dl class="world-metrics" aria-label="Renderer workload">
    <div><dt>Models drawn</dt><dd data-metric="models">{profile.models.toLocaleString('en-US')}</dd></div>
    <div><dt>Instances</dt><dd data-metric="instances">{profile.instances.toLocaleString('en-US')}</dd></div>
    <div><dt>Color draws</dt><dd data-metric="draws">{profile.colorDraws}</dd></div>
    <div><dt>Color triangles</dt><dd data-metric="triangles">{profile.colorTriangles.toLocaleString('en-US')}</dd></div>
    <div><dt>Shadow triangles</dt><dd>{profile.shadowTriangles.toLocaleString('en-US')}</dd></div>
    <div><dt>Render CPU</dt><dd data-metric="cpu">{profile.renderCpuMs.toFixed(2)} ms</dd></div>
    <div><dt>CPU max</dt><dd>{profile.maxRenderCpuMs.toFixed(2)} ms</dd></div>
  </dl>
  <div class="world-toolbar" role="group" aria-label="World controls">
    <label><input type="checkbox" bind:checked={dusk} /> Dusk</label>
    <label><input type="checkbox" bind:checked={forest} /> Forest</label>
    <label><input type="checkbox" bind:checked={shadows} /> Shadows</label>
    <label><input type="checkbox" bind:checked={paused} /> Pause motion</label>
    <label class="selection"><span>Selected</span><select bind:value={selected} disabled={!assets}>
      <option value="">None</option>
      {#each selectable as item (item.key)}<option value={item.key}>{item.label}</option>{/each}
    </select></label>
    <button type="button" class="icon-button" aria-label="Reset camper" title="Reset camper" disabled={!assets}
      onclick={() => { touch = idleMovement; playerVersion++; }}><UserRound size={17} aria-hidden="true" /></button>
    <button type="button" class="icon-button" aria-label="Reset view" title="Reset view"
      onclick={() => cameraVersion++}><RotateCcw size={17} aria-hidden="true" /></button>
  </div>
  <footer><output aria-live="polite">{assets ? `${assetCount} GLB assets loaded` : failure ? 'Asset loading failed' : 'Loading assets'}</output>
    <a href="https://kenney.nl/assets/nature-kit" target="_blank" rel="noreferrer">Models: Kenney / CC0</a></footer>
</div>

<style>
  .asset-world { display: grid; grid-template-rows: minmax(0, 1fr) auto auto auto auto; height: 100%; min-width: 0; color: #edf1ee; background: #1c2522; font-size: 13px; letter-spacing: 0; }
  .world-stage { position: relative; min-height: 0; min-width: 0; }
  .player-controls { position: absolute; left: 14px; bottom: 14px; }
  .world-title { position: absolute; top: 18px; right: 20px; text-align: right; color: #172d2e; pointer-events: none; }
  .world-title strong { display: block; font-size: 24px; font-weight: 650; line-height: 1.2; }
  .world-title span { font-size: 12px; }
  .dusk .world-title { color: #e0e9e5; }
  .asset-status { position: absolute; inset: auto 16px 16px; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; background: #172421; color: #eef2ef; border-radius: 4px; overflow-wrap: anywhere; }
  progress { width: 100px; max-width: 30%; accent-color: #8bcab0; }
  .world-toolbar { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; padding: 14px 16px; border-top: 1px solid #3b4943; }
  .stress-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; padding: 10px 16px; border-top: 1px solid #3b4943; }
  .view-modes { display: flex; margin-left: auto; }
  .view-modes button { display: grid; place-items: center; width: 34px; height: 32px; padding: 0; border-radius: 0; }
  .view-modes button:first-child { border-radius: 4px 0 0 4px; }
  .view-modes button:last-child { border-radius: 0 4px 4px 0; }
  .view-modes button[aria-pressed="true"] { background: #e6ca70; color: #182a25; }
  .world-metrics { display: flex; flex-wrap: wrap; gap: 8px 20px; padding: 9px 16px; margin: 0; background: #15201c; font-variant-numeric: tabular-nums; }
  .world-metrics dt { color: #a9bcb1; font-size: 10px; }
  .world-metrics dd { margin: 3px 0 0; min-width: 40px; font-size: 12px; }
  label { display: flex; align-items: center; gap: 7px; min-height: 28px; cursor: pointer; }
  input { margin: 0; accent-color: #98d4b5; }
  .selection { margin-left: auto; }
  select, button { box-sizing: border-box; min-height: 32px; border: 1px solid #637369; border-radius: 4px; background: #28382f; color: #f1f5f2; padding: 5px 9px; font: inherit; }
  select { min-width: 0; max-width: 160px; }
  button { cursor: pointer; }
  .icon-button { display: grid; place-items: center; width: 32px; height: 32px; padding: 0; flex: 0 0 32px; }
  button:hover { background: #3a4d40; }
  :focus-visible { outline: 2px solid #f2d361; outline-offset: 3px; }
  footer { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; padding: 8px 16px; border-top: 1px solid #344139; color: #b1c2b7; font-size: 11px; }
  footer a { color: inherit; }
  @media (max-width: 700px) {
    .world-toolbar { gap: 8px 14px; padding: 10px 12px; }
    .selection { margin-left: 0; flex: 1; }
    .world-title { top: 16px; right: 14px; }
    .world-title strong { font-size: 20px; }
    footer { padding-inline: 12px; }
  }
</style>
