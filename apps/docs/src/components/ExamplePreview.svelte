<script lang="ts">
  import { onMount } from 'svelte';
  import renderer, { createTypeGpuRoot, type TypeGpuRoot } from 'svelte-typegpu';
  import type { ExampleSlug } from '../examples/example-definitions';
  import { sceneComponents } from '../examples/scene-components';

  let { slug, label }: { slug: ExampleSlug; label: string } = $props();
  let host: HTMLDivElement;
  let error = $state<string | null>(null);
  let ready = $state(false);
  let phongControls = $state({
    lightColor: [0.8, 0.8, 0.8] as [number, number, number],
    lightDirection: [0, 7, -7] as [number, number, number],
    ambientColor: [1, 0.7, 0] as [number, number, number],
    ambientStrength: 0.5,
    specularExponent: 8
  });
  let simpleShadowControls = $state({
    cameraX: -4.9,
    lightX: -0.5,
    lightY: -0.7,
    lightZ: -1,
    cuboidThickness: 0.3,
    shadowMapSize: 2048,
    shadowMapFiltering: true,
    displayMode: 'color'
  });
  let discoControls = $state({
    pattern: 'pattern1'
  });

  const hasControls = $derived(slug !== 'two-boxes');

  onMount(() => {
    let cancelled = false;
    let root: TypeGpuRoot | null = null;
    let instance: { unmount(): void } | null = null;

    function sceneProps() {
      if (slug === 'phong-reflection') return { controls: phongControls };
      if (slug === 'simple-shadow') return { controls: simpleShadowControls };
      if (slug === 'interactive-orbit-field') return { controls: discoControls };
      return {};
    }

    function renderScene() {
      if (!root) return;

      instance?.unmount();
      instance = renderer.render(sceneComponents[slug], {
        target: root,
        props: sceneProps()
      });
    }

    controlStateForSlug = () => {
      renderScene();
    };

    if (!('gpu' in navigator)) {
      error = 'WebGPU is not available in this browser.';
      return;
    }

    createTypeGpuRoot({
      target: host,
      frameloop: 'always',
      maxDevicePixelRatio: 1.5,
      clearColor: [0.045, 0.05, 0.055, 1],
      depth: true,
      alphaMode: 'premultiplied'
    })
      .then((nextRoot) => {
        if (cancelled) {
          nextRoot.dispose();
          return;
        }

        root = nextRoot;
        try {
          renderScene();
          ready = true;
          error = null;
        } catch (unknownError) {
          root.dispose();
          root = null;
          throw unknownError;
        }
      })
      .catch((unknownError: unknown) => {
        if (cancelled) return;
        error =
          unknownError instanceof Error
            ? `Unable to start this preview: ${unknownError.message}`
            : 'Unable to start this preview.';
      });

    return () => {
      cancelled = true;
      instance?.unmount();
      root?.dispose();
    };
  });

  let controlStateForSlug = () => {};

  function rerenderScene() {
    controlStateForSlug();
  }

  function setColor(target: 'lightColor' | 'ambientColor', value: string) {
    phongControls[target] = hexToRgb(value);
    rerenderScene();
  }

  function setPhongVector(index: number, value: number) {
    phongControls.lightDirection[index] = value;
    phongControls.lightDirection = [...phongControls.lightDirection] as [number, number, number];
    rerenderScene();
  }

  function setSimpleValue<K extends keyof typeof simpleShadowControls>(
    key: K,
    value: (typeof simpleShadowControls)[K]
  ) {
    simpleShadowControls[key] = value;
    rerenderScene();
  }

  function setDiscoPattern(value: string) {
    discoControls.pattern = value;
    rerenderScene();
  }

  function rgbToHex(color: readonly number[]): string {
    return `#${color.map((channel) => Math.round(channel * 255).toString(16).padStart(2, '0')).join('')}`;
  }

  function hexToRgb(value: string): [number, number, number] {
    const normalized = value.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;

    return [red, green, blue];
  }
</script>

<div class:preview-with-controls={hasControls}>
  <section class="preview-panel" aria-label={`${label} live preview`}>
    <div class="preview-host" bind:this={host} data-ready={ready}></div>
    {#if error}
      <div class="preview-status" role="status">{error}</div>
    {:else if !ready}
      <div class="preview-status" role="status">Preparing WebGPU preview...</div>
    {/if}
  </section>

  {#if hasControls}
    <section class="example-controls" aria-label="Example controls">
      <h2>Example controls</h2>
      {#if slug === 'phong-reflection'}
        <label class="control-row">
          <span>light color</span>
          <input
            type="color"
            value={rgbToHex(phongControls.lightColor)}
            oninput={(event) => setColor('lightColor', event.currentTarget.value)}
          />
        </label>
        <div class="control-row vector-control">
          <span>light direction</span>
          {#each ['x', 'y', 'z'] as axis, index}
            <label>
              <small>{axis}</small>
              <input
                type="range"
                min="-10"
                max="10"
                step="0.01"
                value={phongControls.lightDirection[index]}
                oninput={(event) => setPhongVector(index, event.currentTarget.valueAsNumber)}
              />
              <output>{phongControls.lightDirection[index].toFixed(2)}</output>
            </label>
          {/each}
        </div>
        <label class="control-row">
          <span>ambient color</span>
          <input
            type="color"
            value={rgbToHex(phongControls.ambientColor)}
            oninput={(event) => setColor('ambientColor', event.currentTarget.value)}
          />
        </label>
        <label class="control-row">
          <span>ambient strength</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={phongControls.ambientStrength}
            oninput={(event) => {
              phongControls.ambientStrength = event.currentTarget.valueAsNumber;
              rerenderScene();
            }}
          />
          <output>{phongControls.ambientStrength.toFixed(2)}</output>
        </label>
        <label class="control-row">
          <span>specular exponent</span>
          <input
            type="range"
            min="0.5"
            max="16"
            step="0.1"
            value={phongControls.specularExponent}
            oninput={(event) => {
              phongControls.specularExponent = event.currentTarget.valueAsNumber;
              rerenderScene();
            }}
          />
          <output>{phongControls.specularExponent.toFixed(1)}</output>
        </label>
      {:else if slug === 'simple-shadow'}
        <label class="control-row">
          <span>camera X</span>
          <input
            type="range"
            min="-10"
            max="10"
            step="0.01"
            value={simpleShadowControls.cameraX}
            oninput={(event) => setSimpleValue('cameraX', event.currentTarget.valueAsNumber)}
          />
          <output>{simpleShadowControls.cameraX.toFixed(2)}</output>
        </label>
        {#each [
          ['light X', 'lightX', -2, 2],
          ['light Y', 'lightY', -4, -0.1],
          ['light Z', 'lightZ', -2, 2]
        ] as [controlLabel, key, min, max]}
          <label class="control-row">
            <span>{controlLabel}</span>
            <input
              type="range"
              {min}
              {max}
              step="0.01"
              value={simpleShadowControls[key as 'lightX' | 'lightY' | 'lightZ']}
              oninput={(event) =>
                setSimpleValue(key as 'lightX' | 'lightY' | 'lightZ', event.currentTarget.valueAsNumber)}
            />
            <output>{simpleShadowControls[key as 'lightX' | 'lightY' | 'lightZ'].toFixed(2)}</output>
          </label>
        {/each}
        <label class="control-row">
          <span>cuboid thickness</span>
          <input
            type="range"
            min="0.01"
            max="1"
            step="0.01"
            value={simpleShadowControls.cuboidThickness}
            oninput={(event) =>
              setSimpleValue('cuboidThickness', event.currentTarget.valueAsNumber)}
          />
          <output>{simpleShadowControls.cuboidThickness.toFixed(2)}</output>
        </label>
        <label class="control-row">
          <span>shadow map size</span>
          <select
            value={simpleShadowControls.shadowMapSize}
            onchange={(event) =>
              setSimpleValue('shadowMapSize', Number(event.currentTarget.value))}
          >
            {#each [512, 1024, 2048, 4096, 8192] as size}
              <option value={size}>{size}</option>
            {/each}
          </select>
        </label>
        <label class="control-row checkbox-control">
          <span>shadow map filtering</span>
          <input
            type="checkbox"
            checked={simpleShadowControls.shadowMapFiltering}
            onchange={(event) =>
              setSimpleValue('shadowMapFiltering', event.currentTarget.checked)}
          />
        </label>
        <label class="control-row">
          <span>display mode</span>
          <select
            value={simpleShadowControls.displayMode}
            onchange={(event) => setSimpleValue('displayMode', event.currentTarget.value)}
          >
            {#each ['color', 'shadow', 'light depth', 'inverse shadow'] as mode}
              <option value={mode}>{mode}</option>
            {/each}
          </select>
        </label>
      {:else if slug === 'interactive-orbit-field'}
        <label class="control-row">
          <span>Pattern</span>
          <select
            value={discoControls.pattern}
            onchange={(event) => setDiscoPattern(event.currentTarget.value)}
          >
            {#each ['pattern1', 'pattern2', 'pattern3', 'pattern4', 'pattern5', 'pattern6', 'pattern7'] as pattern}
              <option value={pattern}>{pattern}</option>
            {/each}
          </select>
        </label>
      {/if}
    </section>
  {/if}
</div>
