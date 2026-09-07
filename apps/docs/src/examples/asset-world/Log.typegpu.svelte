<script lang="ts">
  import type { WorldObjectProps } from './world';
  let { assets, ...props }: WorldObjectProps = $props();
</script>

<model asset={assets.log} castShadow receiveShadow {...props} />
