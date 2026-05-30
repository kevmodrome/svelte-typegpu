<script lang="ts">
  import ExampleWorkbench from '../components/ExampleWorkbench.svelte';
  import SiteShell from '../components/SiteShell.svelte';
  import { examples, getExampleBySlug } from '../examples/registry';
  import type { ExamplesPageProps } from '../routes';

  let { activePath, selectedSlug }: ExamplesPageProps = $props();
  const selected = $derived(getExampleBySlug(selectedSlug));
</script>

<SiteShell {activePath} title={`${selected.title} - svelte-typegpu examples`} description="Live TypeGPU examples rewritten with the svelte-typegpu custom renderer.">
  <section class="doc-header compact">
    <p class="eyebrow">Examples</p>
    <h1 class="examples-title">TypeGPU examples, written as<br class="desktop-title-break" /> Svelte scene components.</h1>
    <p>Each preview is a hydrated WebGPU island. The surrounding documentation and code stay server-rendered HTML.</p>
  </section>
  <ExampleWorkbench {examples} {selected} />
</SiteShell>
