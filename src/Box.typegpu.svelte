<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from './lib/typegpu-renderer/types';

  interface Props {
    position: Vector3Tuple;
    phase?: number;
    color?: RgbaTuple;
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

<box
  role="button"
  tabindex="0"
  aria-label="Change box color"
  {position}
  {phase}
  {color}
  {width}
  {height}
  {depth}
  {spinSpeed}
  onclick={onclick}
  onkeydown={activateFromKeyboard}
></box>
