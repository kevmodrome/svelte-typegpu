<script lang="ts">
  import CodePanel from '../components/CodePanel.svelte';
  import SiteShell from '../components/SiteShell.svelte';
  import { docSnippetFiles } from '../generated/doc-snippets';

  let { activePath }: { activePath: '/' } = $props();
</script>

<SiteShell {activePath}>
  <section class="hero-grid">
    <div class="hero-copy">
      <p class="eyebrow">Svelte custom renderer</p>
      <h1>svelte-typegpu</h1>
      <p class="lede">Write TypeGPU and WebGPU scenes as Svelte component trees. Scene nodes, resources, materials, lights, cameras, and interaction state stay declarative.</p>
      <div class="hero-actions">
        <a class="button primary" href="/examples">View examples</a>
        <a class="button secondary" href="/quickstart">Read quickstart</a>
      </div>
    </div>
    <div class="hero-sample">
      <CodePanel files={docSnippetFiles.overviewIntro} />
    </div>
  </section>
  <section class="feature-grid" aria-label="Renderer model">
    <article>
      <h2>Svelte describes the scene</h2>
      <p>Components and props describe the graph instead of manually wiring render passes and buffers.</p>
    </article>
    <article>
      <h2>TypeGPU owns the GPU work</h2>
      <p>The renderer bridges Svelte nodes into TypeGPU-managed resources, pipelines, batches, and draws.</p>
    </article>
    <article>
      <h2>DOM and WebGPU stay separated</h2>
      <p>Normal Svelte components host controls and docs while `.typegpu.svelte` files render into a custom root.</p>
    </article>
  </section>
</SiteShell>
