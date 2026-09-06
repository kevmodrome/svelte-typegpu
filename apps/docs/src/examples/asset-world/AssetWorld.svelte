<script lang="ts">
  import { onMount } from 'svelte';
  import { prefersReducedMotion } from 'svelte/motion';
  import WorldViewport from './WorldViewport.typegpu.svelte';
  import { assetCount, loadWorldAssets, selectable } from './world';

  let { frameloop = 'demand', maxDevicePixelRatio = 1.5, onready, onfps, onrenderererror } = $props();
  let assets = $state.raw<Awaited<ReturnType<typeof loadWorldAssets>> | null>(null);
  let loaded = $state(0), failure = $state(''), selected = $state('');
  let paused = $state(false), forest = $state(true), dusk = $state(false), shadows = $state(true);
  let cameraVersion = $state(0);
  let request: AbortController | undefined;

  async function reload() {
    request?.abort();
    const current = request = new AbortController();
    assets = null; loaded = 0; failure = '';
    try {
      const result = await loadWorldAssets(current.signal, (count: number) => {
        if (request === current && !current.signal.aborted) loaded = count;
      });
      if (request === current && !current.signal.aborted) assets = result;
    } catch (error) {
      if (request !== current || current.signal.aborted) return;
      current.abort();
      failure = error instanceof Error ? error.message : 'Unable to load the campsite';
    }
  }
  onMount(() => { void reload(); return () => request?.abort(); });
</script>

<div class="asset-world" class:dusk>
  <div class="world-stage">
    <WorldViewport {assets} {forest} {dusk} {shadows} {selected} {cameraVersion}
      paused={paused || prefersReducedMotion.current}
      onselect={(key: string) => selected = key}
      {frameloop} {maxDevicePixelRatio} {onready} {onfps} {onrenderererror} />
    <div class="world-title"><strong>Pinewater</strong><span>Campsite No. 04</span></div>
    {#if failure}
      <div class="asset-status" role="alert"><span>{failure}</span><button type="button" onclick={reload}>Retry assets</button></div>
    {:else if !assets}
      <div class="asset-status" role="status">
        <span>Loading campsite {loaded} / {assetCount}</span>
        <progress value={loaded} max={assetCount} aria-label="Model loading"></progress>
      </div>
    {/if}
  </div>
  <div class="world-toolbar" role="group" aria-label="World controls">
    <label><input type="checkbox" bind:checked={dusk} /> Dusk</label>
    <label><input type="checkbox" bind:checked={forest} /> Forest</label>
    <label><input type="checkbox" bind:checked={shadows} /> Shadows</label>
    <label><input type="checkbox" bind:checked={paused} disabled={prefersReducedMotion.current} />
      {prefersReducedMotion.current ? 'Reduced motion' : 'Pause motion'}</label>
    <label class="selection"><span>Selected</span><select bind:value={selected} disabled={!assets}>
      <option value="">None</option>
      {#each selectable as item (item.key)}<option value={item.key}>{item.label}</option>{/each}
    </select></label>
    <button type="button" onclick={() => cameraVersion++}>Reset view</button>
  </div>
  <footer><output aria-live="polite">{assets ? `${assetCount} GLB assets loaded` : failure ? 'Asset loading failed' : 'Loading assets'}</output>
    <a href="https://kenney.nl/assets/nature-kit" target="_blank" rel="noreferrer">Models: Kenney / CC0</a></footer>
</div>

<style>
  .asset-world { display: grid; grid-template-rows: minmax(0, 1fr) auto auto; height: 100%; min-width: 0; color: #edf1ee; background: #1c2522; font-size: 13px; letter-spacing: 0; }
  .world-stage { position: relative; min-height: 0; min-width: 0; }
  .world-title { position: absolute; top: 18px; right: 20px; text-align: right; color: #172d2e; pointer-events: none; }
  .world-title strong { display: block; font-size: 24px; font-weight: 650; line-height: 1.2; }
  .world-title span { font-size: 12px; }
  .dusk .world-title { color: #e0e9e5; }
  .asset-status { position: absolute; inset: auto 16px 16px; display: flex; align-items: center; justify-content: center; gap: 12px; padding: 12px; background: #172421; color: #eef2ef; border-radius: 4px; overflow-wrap: anywhere; }
  progress { width: 100px; max-width: 30%; accent-color: #8bcab0; }
  .world-toolbar { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; padding: 14px 16px; border-top: 1px solid #3b4943; }
  label { display: flex; align-items: center; gap: 7px; min-height: 28px; cursor: pointer; }
  input { margin: 0; accent-color: #98d4b5; }
  .selection { margin-left: auto; }
  select, button { box-sizing: border-box; min-height: 32px; border: 1px solid #637369; border-radius: 4px; background: #28382f; color: #f1f5f2; padding: 5px 9px; font: inherit; }
  select { min-width: 0; max-width: 160px; }
  button { cursor: pointer; }
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
