<script lang="ts">
  import type { Vector3Tuple } from 'svelte-typegpu';

  let { count, position = [0, 0, 0], onselect }: {
    count: number;
    position?: Vector3Tuple;
    onselect?: (id: number) => void;
  } = $props();
</script>
