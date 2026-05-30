<script lang="ts">
  const TYPEGPU_SHADOW_DEPTH_BIAS = 1 / 1_000_000;
  const TYPEGPU_SHADOW_SLOPE_BIAS = 4;

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

  const lightPosition = $derived(
    [-lightDirection[0], -lightDirection[1], -lightDirection[2]] as [number, number, number]
  );
  const lightIntensity = $derived(displayMode === 'light depth' ? 0.55 : 1.25);
  const ambientIntensity = $derived(displayMode === 'shadow' || displayMode === 'inverse shadow' ? 0.02 : 0.1);
</script>

<ambientLight color={[1, 1, 1]} intensity={ambientIntensity}></ambientLight>
<directionalLight
  position={lightPosition}
  lookAt={[0, 0, 0]}
  color={[1, 1, 1]}
  intensity={lightIntensity}
  castShadow={true}
  shadowMapSize={shadowMapSize}
  shadowBias={TYPEGPU_SHADOW_DEPTH_BIAS}
  shadowSlopeBias={TYPEGPU_SHADOW_SLOPE_BIAS}
></directionalLight>
