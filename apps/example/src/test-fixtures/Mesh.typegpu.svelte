<script>
  let { angle, onclick } = $props();
</script>

<mesh rotation={[0, angle, 0]} {onclick}><boxGeometry /></mesh>
