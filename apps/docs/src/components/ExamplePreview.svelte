<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import type { TypeGpuCameraSettings, TypeGpuRoot, Vector3Tuple } from 'svelte-typegpu';
  import type { ExampleSlug } from '../examples/example-definitions';
  import { sceneComponents } from '../examples/scene-components';
  import {
    defaultSmokyTriangleControls,
    type SmokyTriangleControls
  } from '../examples/smoky-triangle/smoky-triangle-fragment';
  import { gravityPresets, type GravityPreset } from '../examples/gravity/gravity-simulation';

  let { slug, label }: { slug: ExampleSlug; label: string } = $props();
  let error = $state<string | null>(null);
  let ready = $state(false);
  let fps = $state<number | null>(null);
  let root = $state.raw<TypeGpuRoot | null>(null);
  let frameloop = $state<'always' | 'demand' | 'manual'>('demand');
  let maxDevicePixelRatio = $state(1.5);
  let modelUrl = $state('/assets/phong/teapot.obj');
  let modelStatus = $state('Loading model...');
  let phongControls = $state({
    model: { src: '/assets/phong/teapot.obj' },
    lightColor: [0.8, 0.8, 0.8] as [number, number, number],
    lightDirection: [0, 7, -7] as [number, number, number],
    ambientColor: [1, 0.7, 0] as [number, number, number],
    ambientStrength: 0.5,
    specularExponent: 8
  });
  let simpleShadowControls = $state({
    cameraX: -4.9,
    cameraPosition: [-4.9, 2, 5] as Vector3Tuple,
    cameraTarget: [0, 0, 0] as Vector3Tuple,
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
  let smokyTriangleControls = $state<SmokyTriangleControls>({
    ...defaultSmokyTriangleControls,
    fromColor: [...defaultSmokyTriangleControls.fromColor],
    toColor: [...defaultSmokyTriangleControls.toColor]
  });
  let gravityControls = $state({
    preset: 'Solar System' as GravityPreset,
    speed: 0,
    paused: false
  });
  let motionControls = $state({ x: 0, z: 0, lift: 0, visible: true, appearance: 0, count: 2000 });
  const hasRenderSettings = $derived(slug === 'svelte-motion' || slug === 'native-events' || slug === 'shared-stores');

  const hasControls = $derived(
      slug === 'svelte-motion' ||
      slug === 'phong-reflection' ||
      slug === 'simple-shadow' ||
      slug === 'disco-shader-pass' ||
      slug === 'smoky-triangle' ||
      slug === 'gravity'
  );

  const sceneProps = $derived.by(() => {
    if (slug === 'svelte-motion') {
      return {
        controls: motionControls,
        onTargetChange: (x: number, z: number) => {
          motionControls.x = x;
          motionControls.z = z;
        }
      };
    }
    if (slug === 'phong-reflection') {
      return {
        controls: phongControls,
        onModelStatus: (message: string) => {
          modelStatus = message;
        }
      };
    }
    if (slug === 'simple-shadow') {
      return {
        controls: simpleShadowControls,
        onCameraChange: handleSimpleShadowCameraChange
      };
    }
    if (slug === 'disco-shader-pass') return { controls: discoControls };
    if (slug === 'smoky-triangle') return { controls: smokyTriangleControls };
    if (slug === 'gravity') return { controls: gravityControls };
    return {};
  });

  $effect(() => {
    frameloop = slug === 'gravity' || slug === 'svelte-motion' || slug === 'native-events' || slug === 'shared-stores' ? 'demand' : 'always';
    maxDevicePixelRatio = 1.5;
    error = null;
    ready = false;
    fps = null;
    root = null;
  });

  function setColor(target: 'lightColor' | 'ambientColor', value: string) {
    phongControls[target] = hexToRgb(value);
  }

  function setPhongVector(index: number, value: number) {
    phongControls.lightDirection[index] = value;
    phongControls.lightDirection = [...phongControls.lightDirection] as [number, number, number];
  }

  function setSimpleValue<K extends keyof typeof simpleShadowControls>(
    key: K,
    value: (typeof simpleShadowControls)[K]
  ) {
    simpleShadowControls[key] = value;
  }

  function setSimpleCameraX(value: number) {
    simpleShadowControls.cameraX = value;
    simpleShadowControls.cameraPosition = [
      value,
      simpleShadowControls.cameraPosition[1],
      simpleShadowControls.cameraPosition[2]
    ];
  }

  function handleSimpleShadowCameraChange(
    event: CustomEvent<{ camera: TypeGpuCameraSettings }>
  ) {
    simpleShadowControls.cameraPosition = [...event.detail.camera.position];
    simpleShadowControls.cameraTarget = [...event.detail.camera.target];
    simpleShadowControls.cameraX = event.detail.camera.position[0];
  }

  function setDiscoPattern(value: string) {
    discoControls.pattern = value;
  }

  function setSmokyValue<K extends keyof SmokyTriangleControls>(
    key: K,
    value: SmokyTriangleControls[K]
  ) {
    smokyTriangleControls[key] = value;
  }

  function setSmokyColor(target: 'fromColor' | 'toColor', value: string) {
    smokyTriangleControls[target] = hexToRgb(value);
  }

  function setSmokyPreset(preset: 'clouds' | 'fire') {
    const next =
      preset === 'clouds'
        ? defaultSmokyTriangleControls
        : {
            distortion: 0.1,
            sharpness: 7,
            fromColor: [2, 0.4, 0.5] as [number, number, number],
            toColor: [0, 0, 0.4] as [number, number, number],
            polarCoords: true,
            squashed: false
          };

    smokyTriangleControls = {
      ...next,
      fromColor: [...next.fromColor],
      toColor: [...next.toColor]
    };
  }

  function setGravityPreset(value: string) {
    gravityControls.preset = value as GravityPreset;
  }

  function setGravitySpeed(value: number) {
    gravityControls.speed = value;
  }

  function rgbToHex(color: readonly number[]): string {
    return `#${color.map((channel) => Math.round(clamp01(channel) * 255).toString(16).padStart(2, '0')).join('')}`;
  }

  function hexToRgb(value: string): [number, number, number] {
    const normalized = value.replace('#', '');
    const red = Number.parseInt(normalized.slice(0, 2), 16) / 255;
    const green = Number.parseInt(normalized.slice(2, 4), 16) / 255;
    const blue = Number.parseInt(normalized.slice(4, 6), 16) / 255;

    return [red, green, blue];
  }

  function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
  }

  function handleReady(nextRoot: TypeGpuRoot) {
    root = nextRoot;
    ready = true;
    error = null;
  }

  function handleError(cause: unknown) {
    root = null;
    error = cause instanceof Error
      ? `Unable to start this preview: ${cause.message}`
      : 'Unable to start this preview.';
  }
</script>

{#if hasRenderSettings}
  <div class="render-settings" role="group" aria-label="Renderer settings">
    <label>
      <span>Render mode</span>
      <select bind:value={frameloop}>
        <option value="demand">On demand</option>
        <option value="always">Continuous</option>
        <option value="manual">Manual</option>
      </select>
    </label>
    <label>
      <span>Pixel ratio cap</span>
      <select bind:value={maxDevicePixelRatio}>
        {#each [0.5, 1, 1.5, 2] as ratio (ratio)}
          <option value={ratio}>{ratio}</option>
        {/each}
        <option value={Infinity}>Native</option>
      </select>
    </label>
    <button type="button" disabled={!root || frameloop !== 'manual'} onclick={() => root?.gpu.renderFrame()}>
      Render frame
    </button>
  </div>
{/if}

<div class:preview-with-controls={hasControls}>
  <section class="preview-panel" class:preview-with-store-controls={slug === 'shared-stores'} aria-label={`${label} live preview`}>
    {#key slug}
      {#if slug === 'native-events' || slug === 'shared-stores'}
        {@const Viewport = sceneComponents[slug]}
        <Viewport {frameloop} {maxDevicePixelRatio} onfps={(value: number) => fps = value} onready={handleReady} onrenderererror={handleError} />
      {:else}
      <Canvas
        class="preview-host"
        canvasProps={{ 'aria-label': `${label} 3D scene`, role: 'img' }}
        data-ready={ready}
        scene={sceneComponents[slug]}
        {sceneProps}
        options={{
          frameloop,
          maxDevicePixelRatio,
          clearColor: [0.045, 0.05, 0.055, 1],
          depth: true,
          alphaMode: 'premultiplied'
        }}
        onfps={(value) => fps = value}
        onready={handleReady}
        onerror={handleError}
      />
      {/if}
    {/key}
    <div class="fps-badge" aria-label="Preview frames per second">
      <span>FPS</span>
      <strong>{!ready ? '...' : frameloop === 'manual' ? 'Manual' : fps === null ? '...' : fps === 0 ? 'Idle' : fps}</strong>
    </div>
    {#if error}
      <div class="preview-status" role="status">{error}</div>
    {:else if !ready}
      <div class="preview-status" role="status">Preparing WebGPU preview...</div>
    {/if}
  </section>

  {#if hasControls}
    <section class="example-controls" aria-label="Example controls">
      <h2>Example controls</h2>
      {#if slug === 'svelte-motion'}
        <label class="control-row">
          <span>Target X</span>
          <input type="range" min="-10" max="10" step="0.1" bind:value={motionControls.x} />
          <output>{motionControls.x.toFixed(1)}</output>
        </label>
        <label class="control-row">
          <span>Target Z</span>
          <input type="range" min="-13" max="13" step="0.1" bind:value={motionControls.z} />
          <output>{motionControls.z.toFixed(1)}</output>
        </label>
        <label class="control-row">
          <span>Lift</span>
          <input type="range" min="0" max="4" step="0.1" bind:value={motionControls.lift} />
          <output>{motionControls.lift.toFixed(1)}</output>
        </label>
        <label class="control-row">
          <span>Marker visible</span>
          <input type="checkbox" bind:checked={motionControls.visible} />
        </label>
        <label class="control-row">
          <span>Appearance</span>
          <input type="range" min="0" max="1" step="0.01" bind:value={motionControls.appearance} />
          <output>{motionControls.appearance.toFixed(2)}</output>
        </label>
        <label class="control-row">
          <span>Cubes</span>
          <input type="range" min="0" max="2000" step="40" bind:value={motionControls.count} />
          <output>{motionControls.count}</output>
        </label>
      {:else if slug === 'phong-reflection'}
        <form class="model-source" onsubmit={(event) => {
          event.preventDefault();
          phongControls.model = { src: modelUrl.trim() };
        }}>
          <label for="model-url">Model URL</label>
          <div>
            <input id="model-url" type="text" bind:value={modelUrl} required />
            <button type="submit" disabled={!modelUrl.trim()}>Load</button>
          </div>
          <p role="status">{modelStatus}</p>
        </form>
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
            oninput={(event) => setSimpleCameraX(event.currentTarget.valueAsNumber)}
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
      {:else if slug === 'disco-shader-pass'}
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
      {:else if slug === 'smoky-triangle'}
        <label class="control-row">
          <span>distortion</span>
          <input
            type="range"
            min="0"
            max="0.2"
            step="0.001"
            value={smokyTriangleControls.distortion}
            oninput={(event) => setSmokyValue('distortion', event.currentTarget.valueAsNumber)}
          />
          <output>{smokyTriangleControls.distortion.toFixed(3)}</output>
        </label>
        <label class="control-row">
          <span>sharpness</span>
          <input
            type="range"
            min="0"
            max="7"
            step="0.1"
            value={smokyTriangleControls.sharpness}
            oninput={(event) => setSmokyValue('sharpness', event.currentTarget.valueAsNumber)}
          />
          <output>{smokyTriangleControls.sharpness.toFixed(1)}</output>
        </label>
        <label class="control-row">
          <span>From Color</span>
          <input
            type="color"
            value={rgbToHex(smokyTriangleControls.fromColor)}
            oninput={(event) => setSmokyColor('fromColor', event.currentTarget.value)}
          />
        </label>
        <label class="control-row">
          <span>To Color</span>
          <input
            type="color"
            value={rgbToHex(smokyTriangleControls.toColor)}
            oninput={(event) => setSmokyColor('toColor', event.currentTarget.value)}
          />
        </label>
        <label class="control-row checkbox-control">
          <span>Polar Coordinates</span>
          <input
            type="checkbox"
            checked={smokyTriangleControls.polarCoords}
            onchange={(event) => setSmokyValue('polarCoords', event.currentTarget.checked)}
          />
        </label>
        <label class="control-row checkbox-control">
          <span>Squashed</span>
          <input
            type="checkbox"
            checked={smokyTriangleControls.squashed}
            onchange={(event) => setSmokyValue('squashed', event.currentTarget.checked)}
          />
        </label>
        <div class="control-row button-row">
          <span>presets</span>
          <button type="button" onclick={() => setSmokyPreset('clouds')}>Clouds Preset</button>
          <button type="button" onclick={() => setSmokyPreset('fire')}>Fire Preset</button>
        </div>
      {:else if slug === 'gravity'}
        <label class="control-row">
          <span>Paused</span>
          <input type="checkbox" bind:checked={gravityControls.paused} />
        </label>
        <label class="control-row">
          <span>preset</span>
          <select
            value={gravityControls.preset}
            onchange={(event) => setGravityPreset(event.currentTarget.value)}
          >
            {#each gravityPresets as preset}
              <option value={preset}>{preset}</option>
            {/each}
          </select>
        </label>
        <label class="control-row">
          <span>simulation speed modifier</span>
          <input
            type="range"
            min="-5"
            max="5"
            step="1"
            value={gravityControls.speed}
            oninput={(event) => setGravitySpeed(event.currentTarget.valueAsNumber)}
          />
          <output>{gravityControls.speed}</output>
        </label>
      {/if}
    </section>
  {/if}
</div>
