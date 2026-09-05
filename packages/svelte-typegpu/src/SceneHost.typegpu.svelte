<script lang="ts" generics="Props extends Record<string, any>">
  import type { Component } from 'svelte';
  let { scene: Scene, sceneProps }: {
    scene: Component<Props>;
    sceneProps: NoInfer<Props>;
  } = $props();
</script>

<Scene {...sceneProps} />
