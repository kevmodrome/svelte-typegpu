<script lang="ts">
  import ThreeCanvas from './ThreeCanvas.svelte';
  import {
    DEFAULT_SCENE_CONTROLS,
    clampSceneControls,
    formatHueColor,
    nextHue
  } from './lib/scene-controls';

  let controls = $state({ ...DEFAULT_SCENE_CONTROLS });
  let fps = $state(0);
  let color = $derived(formatHueColor(controls.hue));
  let spinLabel = $derived(controls.spinEnabled ? 'Pause' : 'Resume');

  function shiftHue() {
    controls.hue = nextHue(controls.hue);
  }

  function reset() {
    const next = clampSceneControls(DEFAULT_SCENE_CONTROLS);
    controls.spinEnabled = next.spinEnabled;
    controls.spinSpeed = next.spinSpeed;
    controls.cubeScale = next.cubeScale;
    controls.hue = next.hue;
  }
</script>

<main class="shell">
  <ThreeCanvas {controls} onCubeClick={shiftHue} onFps={(value) => (fps = value)} />

  <header class="masthead" aria-label="Renderer status">
    <div>
      <p class="eyebrow">Svelte custom renderer</p>
      <h1>DOM controls, Three scene</h1>
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

    <div class="button-row">
      <button type="button" class:active={!controls.spinEnabled} onclick={() => (controls.spinEnabled = !controls.spinEnabled)}>
        {spinLabel}
      </button>
      <button type="button" onclick={() => (controls.spinSpeed = 0.35)}>Slow</button>
      <button type="button" onclick={() => (controls.spinSpeed = 1.65)}>Fast</button>
    </div>
  </section>
</main>
