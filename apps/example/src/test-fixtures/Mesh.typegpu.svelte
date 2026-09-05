<script>
  let { angle, onclick } = $props();
  const rotation = $state([0, 0, 0]);
  $effect(() => { rotation[1] = angle; });
</script>

<mesh {rotation} {onclick}><boxGeometry /></mesh>
