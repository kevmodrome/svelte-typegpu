<script lang="ts">
  import { getAllContexts, onMount, type Component, type Snippet } from 'svelte';
  import type { HTMLCanvasAttributes } from 'svelte/elements';
  import type { TypeGpuRoot, TypeGpuRootOptions } from './svelte-renderer';
  import { startCanvasScene } from './canvas-lifecycle';

  let {
    children,
    canvas = $bindable<HTMLCanvasElement | undefined>(),
    scopeClass,
    frameloop = 'demand',
    maxDevicePixelRatio,
    onready,
    onfps,
    onrenderererror,
    ...attributes
  }: Omit<HTMLCanvasAttributes, 'children' | 'width' | 'height'> & {
    children?: Snippet;
    canvas?: HTMLCanvasElement;
    scopeClass?: string;
    frameloop?: TypeGpuRootOptions['frameloop'];
    maxDevicePixelRatio?: number;
    onready?: (root: TypeGpuRoot) => void;
    onfps?: (fps: number) => void;
    onrenderererror?: (error: unknown) => void;
  } = $props();
  const context = getAllContexts();
  const { class: canvasClass, width: _width, height: _height, ...nativeAttributes } =
    $derived(attributes as HTMLCanvasAttributes);
  let status = $state<'pending' | 'ready' | 'error'>('pending');
  let initial: { frameloop: typeof frameloop; maxDevicePixelRatio: number | undefined } | undefined;
  let warned = false;
  $effect(() => {
    if (initial && !warned && (frameloop !== initial.frameloop || maxDevicePixelRatio !== initial.maxDevicePixelRatio)) {
      warned = true;
      console.warn('TypeGPU canvas frameloop and maxDevicePixelRatio are creation-only. Remount the viewport to change them.');
    }
  });
  onMount(() => {
    initial = { frameloop, maxDevicePixelRatio };
    // Compiled, parameterless children have the mount entry calling convention.
    // Mount supplies the renderer and owns every scene effect and retained node.
    const content = (children ?? (() => {})) as unknown as Component;
    return startCanvasScene({
      target: canvas!, canvas, frameloop, maxDevicePixelRatio, scenePolicy: 'single',
      onFps: (value) => onfps?.(value)
    }, content, {}, context, {
      ready(root) { status = 'ready'; onready?.(root); },
      error(error) {
        status = 'error';
        if (onrenderererror) onrenderererror(error);
        else console.error('Unable to start TypeGPU canvas.', error);
      },
      cleared() {}
    });
  });
</script>

<canvas
  {...nativeAttributes}
  class={['renderer-root-canvas', scopeClass, canvasClass]}
  data-typegpu-status={status}
  bind:this={canvas}
></canvas>

<style>
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
</style>
