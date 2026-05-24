<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    position: Vector3Tuple;
    phase?: number;
    color?: RgbaTuple;
    map?: string;
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
    width = 1,
    height = 1,
    depth = 1,
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
  aria-label="Change box color"
  {position}
  {phase}
  {spinSpeed}
  onclick={onclick}
  onkeydown={activateFromKeyboard}
>
  <boxGeometry {width} {height} {depth}></boxGeometry>
  <standardMaterial {color} {map}></standardMaterial>
</mesh>
