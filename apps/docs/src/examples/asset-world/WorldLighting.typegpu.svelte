<script lang="ts">
  let { dusk = false, shadows = true }: { dusk?: boolean; shadows?: boolean } = $props();
</script>

<hemisphereLight skyColor={[0.85, 0.93, 1]} groundColor={[0.22, 0.28, 0.23]}
  intensity={dusk ? 0.45 : 0.85} />
<ambientLight intensity={dusk ? 0.14 : 0.5} />
<directionalLight position={[-8, 14, 8]} lookAt={[0, 0, 0]}
  color={dusk ? [1, 0.65, 0.48] : [1, 0.96, 0.88]}
  intensity={dusk ? 0.65 : 1.1} castShadow={shadows} shadowMapSize={2048} />
<pointLight position={[-2.8, 0.7, 1.8]} color={[1, 0.45, 0.13]}
  intensity={dusk ? 3 : 0} range={5} />
