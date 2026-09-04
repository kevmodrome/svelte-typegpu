<script lang="ts">
  import { mount, onMount, unmount } from 'svelte';
  import Scene from './Scene.typegpu.svelte';
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';
  import renderer, { createTypeGpuRoot, type TypeGpuRoot } from 'svelte-typegpu';

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
    let instance: ReturnType<typeof mount> | null = null;

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
        instance = mount(Scene, {
          renderer,
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
      if (instance) void unmount(instance);
      root?.dispose();
    };
  });
</script>

<div class="renderer-canvas" bind:this={host} aria-label="TypeGPU custom-rendered scene">
  {#if error}
    <div class="gpu-error" role="status">{error}</div>
  {/if}
</div>
