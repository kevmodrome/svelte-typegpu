<script lang="ts" generics="Props extends Record<string, any>">
  import { getAllContexts, mount, onMount, unmount, type Component } from 'svelte';
  import type { HTMLAttributes } from 'svelte/elements';
  import renderer, {
    createTypeGpuRoot,
    type TypeGpuRoot,
    type TypeGpuRootOptions
  } from './svelte-renderer';
  import SceneHost from './SceneHost.svelte';

  let {
    scene,
    sceneProps,
    options = {},
    root = $bindable(null),
    onready,
    onerror,
    onfps,
    ...attributes
  }: Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onerror'> & {
    scene: Component<Props>;
    sceneProps: Props;
    options?: Omit<TypeGpuRootOptions, 'target' | 'canvas' | 'onFps'>;
    root?: TypeGpuRoot | null;
    onready?: (root: TypeGpuRoot) => void;
    onerror?: (error: unknown) => void;
    onfps?: (fps: number) => void;
  } = $props();

  const context = getAllContexts();
  let host: HTMLDivElement;
  let canvas: HTMLCanvasElement;
  let startupError = $state<string | null>(null);

  onMount(() => {
    let disposed = false;
    let ownedRoot: TypeGpuRoot | null = null;
    let instance: ReturnType<typeof mount> | null = null;

    function cleanup() {
      const current = instance;
      instance = null;
      try {
        if (current) void unmount(current);
      } finally {
        ownedRoot?.dispose();
        if (root === ownedRoot) root = null;
        ownedRoot = null;
      }
    }

    void createTypeGpuRoot({ ...options, target: host, canvas, onFps: (value) => onfps?.(value) })
      .then((nextRoot) => {
        if (disposed) {
          nextRoot.dispose();
          return;
        }
        ownedRoot = nextRoot;
        instance = mount(SceneHost, {
          renderer,
          target: nextRoot,
          context,
          props: {
            get scene() {
              return scene;
            },
            get sceneProps() {
              return sceneProps;
            }
          }
        });
        root = nextRoot;
        onready?.(nextRoot);
      })
      .catch((error) => {
        cleanup();
        if (disposed) return;
        startupError = error instanceof Error ? error.message : 'Unable to start WebGPU.';
        onerror?.(error);
      });

    return () => {
      disposed = true;
      cleanup();
    };
  });
</script>

<div {...attributes} bind:this={host}>
  <canvas bind:this={canvas}></canvas>
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
