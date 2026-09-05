<script lang="ts">
  function domAction(node: HTMLElement) { node.focus(); }
</script>

<scene clearColor={[0, 0, 0, 1]} />
<mesh use:domAction />
<mesh {@attach (node) => { node.uid.toFixed(); }} />
<mesh {@attach (node) => { node.focus(); }} />
