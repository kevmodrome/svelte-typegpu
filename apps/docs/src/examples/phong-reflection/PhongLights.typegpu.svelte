<script lang="ts">
  let {
    lightColor = [0.8, 0.8, 0.8],
    lightDirection = [0, 7, -7],
    ambientColor = [1, 0.7, 0],
    ambientStrength = 0.5
  }: {
    lightColor?: [number, number, number];
    lightDirection?: [number, number, number];
    ambientColor?: [number, number, number];
    ambientStrength?: number;
  } = $props();
</script>

<ambientLight color={ambientColor} intensity={ambientStrength}></ambientLight>
<directionalLight
  position={lightDirection}
  lookAt={[0, 0, 0]}
  color={lightColor}
  intensity={1}
></directionalLight>
