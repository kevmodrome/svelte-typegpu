<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    position: Vector3Tuple;
    color?: RgbaTuple;
    map?: string;
    width?: number;
    height?: number;
    depth?: number;
    onclick?: () => void;
  }

  let {
    position,
    color = [1, 1, 1, 1],
    map = undefined,
    width = 1,
    height = 1,
    depth = 1,
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
  onclick={onclick}
  onkeydown={activateFromKeyboard}
>
  <boxGeometry {width} {height} {depth}></boxGeometry>
  <standardMaterial {color} {map}></standardMaterial>
</mesh>
