<script lang="ts">
  import type { WorldObjectProps } from './world';
  let { assets, ...props }: WorldObjectProps = $props();
</script>

<model asset={assets.sign} castShadow receiveShadow {...props} />
