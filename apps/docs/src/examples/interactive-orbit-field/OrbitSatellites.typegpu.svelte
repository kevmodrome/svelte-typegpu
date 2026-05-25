<script lang="ts">
  import type { RgbaTuple } from 'svelte-typegpu';
  import type { InstanceTransform, OrbitItem } from './orbit-data';

  interface Props {
    items: OrbitItem[];
    getKey: (item: OrbitItem, index: number) => string;
    getTransform: (item: OrbitItem, index: number) => InstanceTransform;
    getColor: (item: OrbitItem, index: number) => RgbaTuple;
    getSpinSpeed: (item: OrbitItem, index: number) => number;
  }

  let { items, getKey, getTransform, getColor, getSpinSpeed }: Props = $props();
</script>

<instancedMesh
  geometry="satellite"
  material="orbitMaterial"
  instances={items}
  {getKey}
  {getTransform}
  {getColor}
  {getSpinSpeed}
  phase={0.58}
  spinSpeed={0.65}
></instancedMesh>
