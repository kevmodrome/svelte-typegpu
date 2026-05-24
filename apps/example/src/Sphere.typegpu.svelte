<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    position: Vector3Tuple;
    phase?: number;
    color?: RgbaTuple;
    map?: string;
    radius?: number;
    width?: number;
    height?: number;
    depth?: number;
    spinSpeed?: number;
    onclick?: () => void;
  }

  let {
    position,
    phase = 0,
    color = [1, 1, 1, 1],
    map = undefined,
    radius = 0.5,
    width = radius * 2,
    height = radius * 2,
    depth = radius * 2,
    spinSpeed = 0,
    onclick = () => {}
  }: Props = $props();

  function activateFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      onclick();
    }
  }
</script>

<mesh
  role="button"
  tabindex="0"
  aria-label="Change sphere color"
  {position}
  {phase}
  {spinSpeed}
  onclick={onclick}
  onkeydown={activateFromKeyboard}
>
  <sphereGeometry {radius} {width} {height} {depth}></sphereGeometry>
  <standardMaterial {color} {map}></standardMaterial>
</mesh>
