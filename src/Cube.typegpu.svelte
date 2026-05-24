<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from './lib/typegpu-renderer/types';

  interface Props {
    ariaLabel: string;
    position: Vector3Tuple;
    scale: Vector3Tuple;
    color: RgbaTuple;
    spinSpeed: number;
    onActivate?: () => void;
  }

  let {
    ariaLabel,
    position,
    scale,
    color,
    spinSpeed,
    onActivate = () => {}
  }: Props = $props();

  function activateFromKeyboard(event: KeyboardEvent) {
    if (event.key === 'Enter' || event.key === ' ') {
      onActivate();
    }
  }
</script>

<mesh
  role="button"
  tabindex="0"
  aria-label={ariaLabel}
  geometry="cube"
  material="featureMaterial"
  {color}
  {position}
  {scale}
  {spinSpeed}
  onclick={onActivate}
  onkeydown={activateFromKeyboard}
></mesh>
