<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import type { Component, ComponentProps } from 'svelte';
  import {
    createEventObjects,
    resizeObject,
    rotateObject,
    type NativeEventsProps
  } from './event-objects';

  let { scene, onready }: {
    scene: Component<NativeEventsProps>;
    onready?: ComponentProps<typeof Canvas>['onready'];
  } = $props();
  let objects = $state(createEventObjects());
  let selected = $state(0);
  let bubbleClicks = $state(true);
  let hovered = $state<string | null>(null);
  let focused = $state(false);
  let nativeEvent = $state('None');
  let sceneEvent = $state('None');
  let clickPath = $state('None');
  let ready = $state(false);
  let error = $state<string | null>(null);
  let fps = $state<number | null>(null);

  function keydown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
    const object = objects[selected];
    switch (event.key) {
      case 'ArrowLeft':
        rotateObject(object, -15);
        break;
      case 'ArrowRight':
        rotateObject(object, 15);
        break;
      case 'ArrowUp':
        resizeObject(object, 0.1);
        break;
      case 'ArrowDown':
        resizeObject(object, -0.1);
        break;
      case 'Escape':
        reset(selected);
        break;
      default:
        return;
    }
    event.preventDefault();
    nativeEvent = `keydown / ${event.key}`;
  }

  function reset(index: number) {
    objects[index].angle = 0;
    objects[index].size = 1;
  }
</script>

<div class="preview-with-controls native-events-preview">
  <section class="preview-panel" aria-label="Native Events live preview">
    <Canvas
      class="preview-host"
      data-ready={ready}
      {scene}
      sceneProps={{
        objects,
        selected,
        bubbleClicks,
        onselect: (index: number) => selected = index,
        onresize: (index: number, delta: number) => resizeObject(objects[index], delta),
        onreset: reset,
        onhover: (name: string | null) => hovered = name,
        onevent: (name: string) => sceneEvent = name,
        onpath: (phase: string, reset = false) => {
          clickPath = reset ? phase : `${clickPath} > ${phase}`;
        }
      }}
      canvasProps={{
        'aria-label': 'Native Events 3D scene',
        'aria-keyshortcuts': 'ArrowLeft ArrowRight ArrowUp ArrowDown Escape',
        tabindex: 0,
        onpointerdown: (event) => event.currentTarget.focus({ preventScroll: true }),
        onkeydown: keydown,
        onfocus: () => {
          focused = true;
          nativeEvent = 'focus';
        },
        onblur: () => {
          focused = false;
          nativeEvent = 'blur';
        }
      }}
      options={{ frameloop: 'demand', maxDevicePixelRatio: 1.5, depth: true }}
      onfps={(value) => fps = value}
      onready={(root) => {
        ready = true;
        onready?.(root);
      }}
      onerror={(cause) => {
        error = cause instanceof Error ? cause.message : 'Unable to start WebGPU.';
      }}
    />
    <div class="fps-badge" aria-label="Preview frames per second">
      <span>FPS</span><strong>{!ready ? '...' : fps || 'Idle'}</strong>
    </div>
    {#if error}
      <div class="preview-status" role="alert">{error}</div>
    {:else if !ready}
      <div class="preview-status" role="status">Preparing WebGPU preview...</div>
    {/if}
  </section>

  <section class="example-controls" aria-label="Event controls">
    <h2>Selection</h2>
    <label class="control-row">
      <span>Object</span>
      <select bind:value={selected}>
        {#each objects as object, index}
          <option value={index}>{object.name}</option>
        {/each}
      </select>
    </label>
    <label class="control-row">
      <span>Rotation</span>
      <input type="range" min="-180" max="180" step="1" bind:value={objects[selected].angle} />
      <output>{objects[selected].angle.toFixed(0)} deg</output>
    </label>
    <label class="control-row">
      <span>Size</span>
      <input type="range" min="0.6" max="1.6" step="0.01" bind:value={objects[selected].size} />
      <output>{objects[selected].size.toFixed(2)}</output>
    </label>
    <label class="control-row">
      <span>Bubble clicks</span><input type="checkbox" bind:checked={bubbleClicks} />
    </label>
    <dl class="event-readout">
      <dt>Hovered</dt><dd data-event="hover">{hovered ?? 'None'}</dd>
      <dt>Canvas focus</dt><dd data-event="focus">{focused ? 'Focused' : 'Unfocused'}</dd>
      <dt>Native event</dt><dd data-event="native">{nativeEvent}</dd>
      <dt>Scene event</dt><dd data-event="scene">{sceneEvent}</dd>
      <dt>Click path</dt><dd data-event="path">{clickPath}</dd>
    </dl>
  </section>
</div>
