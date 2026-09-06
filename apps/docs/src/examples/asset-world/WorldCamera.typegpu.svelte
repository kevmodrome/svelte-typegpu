<script lang="ts">
  import type { TypeGpuCameraSettings, Vector3Tuple } from 'svelte-typegpu';
  let { view, extent, narrow, focus, onchange }: {
    view: 'camp' | 'follow' | 'overview'; extent: number; narrow: boolean;
    focus: Vector3Tuple; onchange: (camera: TypeGpuCameraSettings) => void;
  } = $props();
  // This component is keyed by camera preset/extent. Orbit updates its own live
  // camera; retain that offset for the next player-driven declarative update.
  const initialOffset = $derived(view === 'overview' ? [extent * 1.9, extent * 2.1, extent * 2.5]
    : view === 'follow' ? [8, 9, 11] : [17, 14.8, 21]);
  const orbit: { offset: number[] | null } = { offset: null };
  const target = $derived(view === 'follow' ? [focus[0], focus[1] + 0.8, focus[2]] : [0, 0.2, 0]);
  const position = $derived.by(() => {
    const offset = orbit.offset ?? initialOffset;
    return [target[0] + offset[0], target[1] + offset[1], target[2] + offset[2]];
  });
  function changed(event: CustomEvent<{ camera: TypeGpuCameraSettings }>) {
    const camera = event.detail.camera;
    orbit.offset = camera.position.map((value, i) => value - camera.target[i]);
    onchange(camera);
  }
</script>

<perspectiveCamera active {position} {target} fov={narrow ? 64 : 43}
  near={view === 'overview' ? Math.max(0.1, extent / 20) : 0.1} far={Math.max(160, extent * 10)}>
  <controls mode="orbit" minDistance={view === 'overview' ? Math.max(6, extent / 4) : 6}
    maxDistance={Math.max(50, extent * 6)} oncamerachange={changed}>
    <pointerControls wheel="zoom" touch="orbit-pinch" />
  </controls>
</perspectiveCamera>
