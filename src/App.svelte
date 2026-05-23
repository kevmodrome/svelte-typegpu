<script lang="ts">
  import TypeGpuCanvas from './TypeGpuCanvas.svelte';
  import { CUBE_COUNT_PRESETS } from './lib/cube-field';
  import {
    DEFAULT_SCENE_CONTROLS,
    applyCameraChange,
    cameraControlsForCount,
    clampSceneControls,
    copySceneControls,
    formatHueColor,
    nextHue
  } from './lib/scene-controls';

  type VectorAxis = 0 | 1 | 2;
  const VECTOR_AXES = [0, 1, 2] as const;

  let controls = $state(clampSceneControls(DEFAULT_SCENE_CONTROLS));
  let fps = $state(0);
  let color = $derived(formatHueColor(controls.hue));
  let spinLabel = $derived(controls.spinEnabled ? 'Pause' : 'Resume');

  function shiftHue() {
    controls.hue = nextHue(controls.hue);
  }

  function reset() {
    copySceneControls(controls, DEFAULT_SCENE_CONTROLS);
  }

  function resetCamera() {
    copySceneControls(controls, {
      ...controls,
      camera: cameraControlsForCount(controls.cubeCount)
    });
  }

  function setCubeCount(count: number) {
    copySceneControls(controls, {
      ...controls,
      cubeCount: count,
      camera: cameraControlsForCount(count)
    });
  }

  function clampControls() {
    copySceneControls(controls, controls);
  }

  function syncCamera(detail: Parameters<typeof applyCameraChange>[1]) {
    applyCameraChange(controls, detail);
  }

  function formatCubeCount(count: number) {
    return count >= 1_000 ? `${count / 1_000}k` : String(count);
  }

  function axisLabel(axis: VectorAxis) {
    return ['X', 'Y', 'Z'][axis];
  }

  function formatCameraValue(value: number) {
    return value.toFixed(1);
  }
</script>

<main class="shell">
  <TypeGpuCanvas
    {controls}
    onShapeClick={shiftHue}
    onFps={(value) => (fps = value)}
    onCameraChange={syncCamera}
  />

  <header class="masthead" aria-label="Renderer status">
    <div>
      <p class="eyebrow">Svelte custom renderer</p>
      <h1>DOM controls, TypeGPU scene</h1>
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

    <div class="camera-controls" aria-label="Camera controls">
      <div class="section-header">
        <span>Camera</span>
        <button class="compact-command" type="button" onclick={resetCamera}>Frame</button>
      </div>

      <label class="control-row">
        <span>FOV</span>
        <input
          type="range"
          min="20"
          max="100"
          step="1"
          bind:value={controls.camera.fov}
          onchange={clampControls}
        />
        <output>{controls.camera.fov.toFixed(0)}°</output>
      </label>

      <div class="slider-stack">
        <span>Position</span>
        {#each VECTOR_AXES as axis (axis)}
          <label class="mini-slider-row">
            <span>{axisLabel(axis)}</span>
            <input
              type="range"
              min="-40"
              max="40"
              step="0.1"
              bind:value={controls.camera.position[axis]}
              oninput={clampControls}
              onchange={clampControls}
              aria-label={`Camera position ${axisLabel(axis)}`}
            />
            <output>{formatCameraValue(controls.camera.position[axis])}</output>
          </label>
        {/each}
      </div>

      <div class="clip-control">
        <label>
          <span>Near</span>
          <input
            type="range"
            min="0.01"
            max="10"
            step="0.01"
            bind:value={controls.camera.near}
            onchange={clampControls}
          />
          <output>{controls.camera.near.toFixed(2)}</output>
        </label>
        <label>
          <span>Far</span>
          <input
            type="range"
            min="1"
            max="1000"
            step="1"
            bind:value={controls.camera.far}
            onchange={clampControls}
          />
          <output>{controls.camera.far.toFixed(0)}</output>
        </label>
      </div>
    </div>

    <div class="count-row">
      <span>Count</span>
      <div class="segmented-control" aria-label="Cube count">
        {#each CUBE_COUNT_PRESETS as count (count)}
          <button
            type="button"
            class:active={controls.cubeCount === count}
            onclick={() => setCubeCount(count)}
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
