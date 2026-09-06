<script lang="ts">
  let { request }: { request: Promise<string> } = $props();
  let label = $derived(await request);
</script>

<canvas aria-label={label} bind:clientWidth={null, () => {}}>
  <scene><mesh name={label} /></scene>
</canvas>

<style>
  canvas { height: 420px; }
</style>
