<script lang="ts">
  import { floorBounds, floorVertices } from './box-geometry';
</script>

<mesh position={[0, -2, 0]} scale={[5, 1, 5]}>
  <bufferGeometry
    key="two-boxes:floor"
    vertices={floorVertices}
    bounds={floorBounds}
  ></bufferGeometry>
  <basicMaterial color={[1, 1, 1, 1]} cullMode="none"></basicMaterial>
</mesh>
