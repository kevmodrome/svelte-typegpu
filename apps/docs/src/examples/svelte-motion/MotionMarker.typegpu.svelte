<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';
  let { position, lift, visible }: { position: Vector3Tuple; lift: number; visible: boolean } = $props();
</script>

<group {position} {visible}>
  <mesh position={[0, lift, 0]} scale={[1.2, 1.2, 1.2]}>
    <boxGeometry />
    <standardMaterial color={[1, 0.24, 0.3, 1]} />
  </mesh>
  <mesh position={[-1.5, 0, 0]} scale={[0.55, 1.6, 0.55]}>
    <boxGeometry />
    <standardMaterial color={[1, 0.76, 0.22, 1]} />
  </mesh>
  <mesh position={[1.5, 0, 0]} scale={[0.55, 1.6, 0.55]}>
    <boxGeometry />
    <standardMaterial color={[0.88, 0.92, 0.95, 1]} />
  </mesh>
</group>
