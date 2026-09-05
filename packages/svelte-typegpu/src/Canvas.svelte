<script lang="ts" generics="Props extends Record<string, any>">
  import { getAllContexts, onMount, type Component } from 'svelte';
  import type { HTMLAttributes, HTMLCanvasAttributes } from 'svelte/elements';
  import type { TypeGpuRoot, TypeGpuRootOptions } from './svelte-renderer';
  import SceneHost from './SceneHost.svelte';
  import { startCanvasScene } from './canvas-lifecycle';

  let {
    scene,
    sceneProps,
    options = {},
    canvasProps = {},
    root = $bindable(null),
    onready,
    onerror,
    onfps,
    ...attributes
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onerror'> & {
    scene: Component<Props>;
    sceneProps: NoInfer<Props>;
    options?: Omit<TypeGpuRootOptions, 'target' | 'canvas' | 'onFps'>;
    canvasProps?: Omit<HTMLCanvasAttributes, 'children' | 'width' | 'height'>;
    root?: TypeGpuRoot | null;
    onready?: (root: TypeGpuRoot) => void;
    onerror?: (error: unknown) => void;
    onfps?: (fps: number) => void;
  } = $props();

  // Filter renderer-owned DOM fields even when props come from untyped callers.
  const {
    class: canvasClass,
    width: _width,
    height: _height,
    children: _children,
    ...canvasAttributes
  } = $derived(canvasProps as HTMLCanvasAttributes);

  const context = getAllContexts();
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let startupError = $state<string | null>(null);

  onMount(() => {
    return startCanvasScene(
      { ...options, target: host, canvas, onFps: (value) => onfps?.(value) },
      SceneHost<Props>, {
        get scene() { return scene; },
        get sceneProps() { return sceneProps; }
      }, context, {
        ready(nextRoot) { root = nextRoot; onready?.(nextRoot); },
        error(error) {
          startupError = error instanceof Error ? error.message : 'Unable to start WebGPU.';
          onerror?.(error);
        },
        cleared(previous) { if (root === previous) root = null; }
      }
    );
  });
</script>

<div {...attributes} bind:this={host}>
  <canvas
    {...canvasAttributes}
    class={['renderer-root-canvas', canvasClass]}
    bind:this={canvas}
  ></canvas>
  {#if startupError && !onerror}
    <p role="alert">{startupError}</p>
  {/if}
</div>

<style>
  div {
    position: relative;
    width: 100%;
    height: 100%;
  }
  canvas {
    display: block;
    width: 100%;
    height: 100%;
    touch-action: none;
  }
  p {
    position: absolute;
    inset: 0;
    margin: 0;
    padding: 12px;
    overflow-wrap: anywhere;
  }
</style>
