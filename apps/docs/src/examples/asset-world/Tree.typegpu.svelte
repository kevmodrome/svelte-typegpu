<script lang="ts">
  import type { WorldObjectProps } from './world';
  let { assets, kind = 'pine', ...props }: WorldObjectProps & { kind?: 'pine' | 'oak' } = $props();
</script>

<model asset={assets[kind]} castShadow receiveShadow {...props} />
