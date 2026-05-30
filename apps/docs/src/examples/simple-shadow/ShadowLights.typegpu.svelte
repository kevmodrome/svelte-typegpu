<script lang="ts">
  let {
    lightDirection = [-0.5, -0.7, -1],
    shadowMapSize = 2048,
    shadowMapFiltering = true,
    displayMode = 'color'
  }: {
    lightDirection?: [number, number, number];
    shadowMapSize?: number;
    shadowMapFiltering?: boolean;
    displayMode?: string;
  } = $props();

  const shadowBias = $derived(shadowMapFiltering ? 1 : 0.35);
  const shadowSlopeBias = $derived(shadowMapFiltering ? 4 : 1.2);
  const lightIntensity = $derived(displayMode === 'light depth' ? 0.55 : 1.25);
  const ambientIntensity = $derived(displayMode === 'shadow' || displayMode === 'inverse shadow' ? 0.02 : 0.1);
</script>

<ambientLight color={[1, 1, 1]} intensity={ambientIntensity}></ambientLight>
<directionalLight
  position={lightDirection}
  lookAt={[0, 0, 0]}
  color={[1, 1, 1]}
  intensity={lightIntensity}
  castShadow={true}
  shadowMapSize={shadowMapSize}
  shadowBias={shadowBias}
  shadowSlopeBias={shadowSlopeBias}
></directionalLight>
