<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';
  import { markerFragment } from './marker-fragment';
  let { position, lift, visible, appearance }: {
    position: Vector3Tuple; lift: number; visible: boolean; appearance: number
  } = $props();
</script>

<group {position} {visible}>
  <mesh position={[0, lift, 0]} scale={[1.2, 1.2, 1.2]}>
    <boxGeometry />
    <standardMaterial
      color={[1 - appearance * 0.85, 0.24 + appearance * 0.6, 0.3 + appearance * 0.6, 1]}
      roughness={0.7 - appearance * 0.6}
    />
  </mesh>
  <mesh position={[-1.5, 0, 0]} scale={[0.55, 1.6, 0.55]}>
    <boxGeometry />
    <standardMaterial color={[1, 0.76, 0.22, 1]} />
  </mesh>
  <mesh position={[1.5, 0, 0]} scale={[0.55, 1.6, 0.55]}>
    <boxGeometry />
    <shaderMaterial fragment={markerFragment} uniforms={{ value0: appearance }} />
  </mesh>
</group>
