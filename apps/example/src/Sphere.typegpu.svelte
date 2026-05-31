<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    position: Vector3Tuple;
    color?: RgbaTuple;
    map?: string;
    radius?: number;
    width?: number;
    height?: number;
    depth?: number;
    onclick?: () => void;
  }

  let {
    position,
    color = [1, 1, 1, 1],
    map = undefined,
    radius = 0.5,
    width = radius * 2,
    height = radius * 2,
    depth = radius * 2,
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
  onclick={onclick}
  onkeydown={activateFromKeyboard}
>
  <sphereGeometry {radius} {width} {height} {depth}></sphereGeometry>
  <standardMaterial {color} {map}></standardMaterial>
</mesh>
