<script lang="ts">
  import { onMount } from 'svelte';
  import Scene from './Scene.three.svelte';
  import { createFpsMeter } from './lib/fps-meter';
  import {
    DEFAULT_SCENE_CONTROLS,
    clampSceneControls,
    type SceneControls
  } from './lib/scene-controls';
  import renderer, { createThreeRoot, type ThreeRoot } from './lib/three-renderer/svelte-renderer';

  interface Props {
    controls: SceneControls;
    onCubeClick?: () => void;
    onFps?: (fps: number) => void;
  }

  let { controls, onCubeClick = () => {}, onFps = () => {} }: Props = $props();

  let host: HTMLDivElement;
  let root: ThreeRoot | null = null;
  let sceneControls = $state({ ...DEFAULT_SCENE_CONTROLS });
  const fpsMeter = createFpsMeter((fps) => onFps(fps));

  $effect(() => {
    const next = clampSceneControls(controls);
    sceneControls.spinEnabled = next.spinEnabled;
    sceneControls.spinSpeed = next.spinSpeed;
    sceneControls.cubeScale = next.cubeScale;
    sceneControls.hue = next.hue;
    root?.setContinuous(next.spinEnabled && next.spinSpeed > 0);
  });

  onMount(() => {
    if (!host) return;

    root = createThreeRoot({
      target: host,
      onFrame(timestamp) {
        fpsMeter.record(timestamp);
      }
    });
    const instance = renderer.render(Scene, {
      target: root,
      props: {
        controls: sceneControls,
        onCubeClick
      }
    });
    root.setContinuous(sceneControls.spinEnabled && sceneControls.spinSpeed > 0);

    return () => {
      instance.unmount();
      root?.dispose();
      root = null;
    };
  });
</script>

<div class="three-canvas" bind:this={host} aria-label="Three.js custom-rendered scene"></div>
