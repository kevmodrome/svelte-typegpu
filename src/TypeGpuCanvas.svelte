<script lang="ts">
  import { onMount } from 'svelte';
  import Scene from './Scene.typegpu.svelte';
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';
  import renderer, {
    createTypeGpuRoot,
    type TypeGpuRoot
  } from './lib/typegpu-renderer/svelte-renderer';

  interface Props {
    controls: SceneControls;
    onShapeClick?: () => void;
    onFps?: (fps: number) => void;
    onCameraChange?: (detail: CameraChangeDetail) => void;
  }

  let {
    controls,
    onShapeClick = () => {},
    onFps = () => {},
    onCameraChange = () => {}
  }: Props = $props();

  let host: HTMLDivElement;
  let error = $state<string | null>(null);

  onMount(() => {
    let cancelled = false;
    let root: TypeGpuRoot | null = null;
    let instance: { unmount(): void } | null = null;

    createTypeGpuRoot({
      target: host,
      onFps,
      frameloop: 'always',
      maxDevicePixelRatio: 1.5,
      clearColor: [0.067, 0.078, 0.102, 1],
      depth: true,
      alphaMode: 'premultiplied'
    })
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
            onShapeClick,
            onCameraChange
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

<div class="renderer-canvas" bind:this={host} aria-label="TypeGPU custom-rendered scene">
  {#if error}
    <div class="gpu-error" role="status">{error}</div>
  {/if}
</div>
