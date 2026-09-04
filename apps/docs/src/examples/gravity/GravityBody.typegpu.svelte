<script lang="ts">
  import type { GravityBody } from './gravity-simulation';

  let { body }: { body: GravityBody } = $props();
</script>

<mesh position={body.position} scale={[body.radius, body.radius, body.radius]}>
  <sphereGeometry radius={1} widthSegments={24} heightSegments={12}></sphereGeometry>
  <phongMaterial
    color={body.color}
    roughness={0.58}
    metalness={0}
    specularExponent={10}
  ></phongMaterial>
</mesh>
