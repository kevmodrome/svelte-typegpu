<script lang="ts">
  import CodePanel from '../components/CodePanel.svelte';
  import SiteShell from '../components/SiteShell.svelte';
  import { docSnippetFiles } from '../generated/doc-snippets';

  let { activePath }: { activePath: '/quickstart' } = $props();
</script>

<SiteShell {activePath} title="Quickstart - svelte-typegpu" description="Install and configure svelte-typegpu with the Svelte custom renderer preview.">
  <section class="doc-header">
    <p class="eyebrow">Quickstart</p>
    <h1>Configure Svelte for TypeGPU scene files.</h1>
    <p>Until the Svelte custom renderer API lands upstream, projects using `svelte-typegpu` need the Svelte PR preview build and a compiler rule for `.typegpu.svelte` files.</p>
  </section>
  <div class="doc-stack">
    <section>
      <h2>Install</h2>
      <CodePanel files={docSnippetFiles.quickstartInstall} />
    </section>
    <section>
      <h2>Configure the custom renderer</h2>
      <p>DOM `.svelte` components compile normally. Only `.typegpu.svelte` files use the custom renderer.</p>
      <CodePanel files={docSnippetFiles.quickstartVite} />
    </section>
    <section>
      <h2>Mount a scene</h2>
      <p>Create a TypeGPU root from a DOM component, render a custom-renderer scene into it, and dispose both on unmount.</p>
      <CodePanel files={docSnippetFiles.quickstartMount} />
    </section>
  </div>
</SiteShell>
