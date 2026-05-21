<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from './lib/typegpu-renderer/types';

  interface Props {
    position: Vector3Tuple;
    phase?: number;
    color?: RgbaTuple;
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

<sphere
  role="button"
  tabindex="0"
  aria-label="Change sphere color"
  {position}
  {phase}
  {color}
  {width}
  {height}
  {depth}
  {spinSpeed}
  onclick={onclick}
  onkeydown={activateFromKeyboard}
></sphere>
