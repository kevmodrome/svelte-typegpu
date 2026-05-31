<script lang="ts">
  import type { RgbaTuple } from 'svelte-typegpu';

  let { cuboidThickness, color }: { cuboidThickness: number; color: RgbaTuple } = $props();
</script>

<mesh
  position={[0, 0.5, 0]}
  rotation={[0, 0, 0]}
  scale={[1, 1, 1]}
  castShadow={true}
  receiveShadow={true}
>
  <boxGeometry width={1} height={1} depth={cuboidThickness}></boxGeometry>
  <phongMaterial {color} roughness={0.38} metalness={0}></phongMaterial>
</mesh>
