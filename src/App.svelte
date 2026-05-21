<script lang="ts">
  import ThreeCanvas from './ThreeCanvas.svelte';
  import TypeGpuCanvas from './TypeGpuCanvas.svelte';
  import { CUBE_COUNT_PRESETS } from './lib/cube-field';
  import {
    DEFAULT_SCENE_CONTROLS,
    clampSceneControls,
    formatHueColor,
    nextHue
  } from './lib/scene-controls';

  type RendererBackend = 'three' | 'typegpu';

  let backend = $state<RendererBackend>('three');
  let controls = $state({ ...DEFAULT_SCENE_CONTROLS });
  let fps = $state(0);
  let color = $derived(formatHueColor(controls.hue));
  let spinLabel = $derived(controls.spinEnabled ? 'Pause' : 'Resume');
  let sceneTitle = $derived(
    backend === 'typegpu' ? 'DOM controls, TypeGPU scene' : 'DOM controls, Three scene'
  );

  function shiftHue() {
    controls.hue = nextHue(controls.hue);
  }

  function reset() {
    const next = clampSceneControls(DEFAULT_SCENE_CONTROLS);
    controls.spinEnabled = next.spinEnabled;
    controls.spinSpeed = next.spinSpeed;
    controls.cubeScale = next.cubeScale;
    controls.cubeCount = next.cubeCount;
    controls.hue = next.hue;
  }

  function formatCubeCount(count: number) {
    return count >= 1_000 ? `${count / 1_000}k` : String(count);
  }
</script>

<main class="shell">
  {#if backend === 'typegpu'}
    <TypeGpuCanvas {controls} onShapeClick={shiftHue} onFps={(value) => (fps = value)} />
  {:else}
    <ThreeCanvas {controls} onCubeClick={shiftHue} onFps={(value) => (fps = value)} />
  {/if}

  <header class="masthead" aria-label="Renderer status">
    <div>
      <p class="eyebrow">Svelte custom renderer</p>
      <h1>{sceneTitle}</h1>
    </div>
    <button class="icon-command" type="button" onclick={reset} aria-label="Reset scene controls">
      Reset
    </button>
  </header>

  <section class="control-panel" aria-label="Scene controls">
    <div class="fps-strip" aria-label="Render performance">
      <span>FPS</span>
      <strong>{fps || '...'}</strong>
    </div>

    <div class="backend-row">
      <span>Render</span>
      <div class="segmented-control backend-control" aria-label="Renderer backend">
        <button
          type="button"
          class:active={backend === 'three'}
          onclick={() => {
            backend = 'three';
            fps = 0;
          }}
        >
          Three
        </button>
        <button
          type="button"
          class:active={backend === 'typegpu'}
          onclick={() => {
            backend = 'typegpu';
            fps = 0;
          }}
        >
          TypeGPU
        </button>
      </div>
    </div>

    <div class="meter-row">
      <span class="swatch" style:background={color}></span>
      <div>
        <p class="metric-label">Material hue</p>
        <p class="metric-value">{controls.hue}°</p>
      </div>
      <button class="compact-command" type="button" onclick={shiftHue}>Shift</button>
    </div>

    <label class="control-row">
      <span>Spin</span>
      <input type="range" min="0" max="2" step="0.05" bind:value={controls.spinSpeed} />
      <output>{controls.spinSpeed.toFixed(2)}x</output>
    </label>

    <label class="control-row">
      <span>Scale</span>
      <input type="range" min="0.45" max="2.2" step="0.05" bind:value={controls.cubeScale} />
      <output>{controls.cubeScale.toFixed(2)}</output>
    </label>

    <div class="count-row">
      <span>Count</span>
      <div class="segmented-control" aria-label="Cube count">
        {#each CUBE_COUNT_PRESETS as count (count)}
          <button
            type="button"
            class:active={controls.cubeCount === count}
            onclick={() => (controls.cubeCount = count)}
            aria-label={`Render ${count.toLocaleString()} cube${count === 1 ? '' : 's'}`}
          >
            {formatCubeCount(count)}
          </button>
        {/each}
      </div>
      <output>{controls.cubeCount.toLocaleString()}</output>
    </div>

    <div class="button-row">
      <button type="button" class:active={!controls.spinEnabled} onclick={() => (controls.spinEnabled = !controls.spinEnabled)}>
        {spinLabel}
      </button>
      <button type="button" onclick={() => (controls.spinSpeed = 0.35)}>Slow</button>
      <button type="button" onclick={() => (controls.spinSpeed = 1.65)}>Fast</button>
    </div>
  </section>
</main>
