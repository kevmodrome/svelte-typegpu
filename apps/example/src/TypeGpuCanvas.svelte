<script lang="ts">
  import Canvas from 'svelte-typegpu/canvas';
  import Scene from './Scene.typegpu.svelte';
  import type { CameraChangeDetail, SceneControls } from './lib/scene-controls';

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

  let error = $state<string | null>(null);
</script>

<div class="renderer-canvas" aria-label="TypeGPU custom-rendered scene">
  <Canvas
    scene={Scene}
    canvasProps={{ 'aria-label': 'Interactive TypeGPU scene', role: 'img' }}
    sceneProps={{ controls, onShapeClick, onCameraChange }}
    options={{
      frameloop: 'always',
      maxDevicePixelRatio: 1.5,
      clearColor: [0.067, 0.078, 0.102, 1],
      depth: true,
      alphaMode: 'premultiplied'
    }}
    onfps={onFps}
    onerror={(cause) => error = cause instanceof Error ? cause.message : 'Unable to start WebGPU.'}
  />
  {#if error}
    <div class="gpu-error" role="status">{error}</div>
  {/if}
</div>
