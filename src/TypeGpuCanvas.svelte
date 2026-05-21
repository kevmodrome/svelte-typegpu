<script lang="ts">
  import { onMount } from 'svelte';
  import Scene from './Scene.typegpu.svelte';
  import type { SceneControls } from './lib/scene-controls';
  import renderer, {
    createTypeGpuRoot,
    type TypeGpuRoot
  } from './lib/typegpu-renderer/svelte-renderer';

  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
    onFps?: (fps: number) => void;
  }

  let { controls, onShapeClick = () => {}, onFps = () => {} }: Props = $props();

  let host: HTMLDivElement;
  let error = $state<string | null>(null);

  onMount(() => {
    let cancelled = false;
    let root: TypeGpuRoot | null = null;
    let instance: { unmount(): void } | null = null;

    createTypeGpuRoot({ target: host, onFps })
      .then((nextRoot) => {
        if (cancelled) {
          nextRoot.dispose();
          return;
        }

        root = nextRoot;
        instance = renderer.render(Scene, {
          target: root,
          props: {
            controls,
            onShapeClick
          }
        });
        error = null;
      })
      .catch((unknownError: unknown) => {
        if (cancelled) return;

        error = unknownError instanceof Error ? unknownError.message : 'Unable to start WebGPU.';
      });

    return () => {
      cancelled = true;
      instance?.unmount();
      root?.dispose();
    };
  });
</script>

<div class="three-canvas" bind:this={host} aria-label="TypeGPU custom-rendered scene">
  {#if error}
    <div class="gpu-error" role="status">{error}</div>
  {/if}
</div>
