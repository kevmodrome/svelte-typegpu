<script lang="ts">
  import type { RgbaTuple, Vector3Tuple } from 'svelte-typegpu';

  interface Props {
    ariaLabel: string;
    position: Vector3Tuple;
    color: RgbaTuple;
    radius?: number;
    widthSegments?: number;
    heightSegments?: number;
    onActivate?: () => void;
  }

  let {
    ariaLabel,
    position,
    color,
    radius = 0.45,
    widthSegments = 24,
    heightSegments = 12,
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
  onclick={onActivate}
  onkeydown={activateFromKeyboard}
>
  <sphereGeometry {radius} {widthSegments} {heightSegments}></sphereGeometry>
  <standardMaterial {color} roughness={0.24} metalness={0.18}></standardMaterial>
</mesh>
