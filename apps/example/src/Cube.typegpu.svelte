<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    ariaLabel: string;
    position: Vector3Tuple;
    scale: Vector3Tuple;
    color: RgbaTuple;
    onActivate?: () => void;
  }

  let {
    ariaLabel,
    position,
    scale,
    color,
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
  {position}
  {scale}
  onclick={onActivate}
  onkeydown={activateFromKeyboard}
>
  <boxGeometry width={1} height={1} depth={1}></boxGeometry>
  <standardMaterial {color} roughness={0.18} metalness={0.28}></standardMaterial>
</mesh>
