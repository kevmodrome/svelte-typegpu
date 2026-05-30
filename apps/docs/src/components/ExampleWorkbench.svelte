<script lang="ts">
  import CodePanel from './CodePanel.svelte';
  import ExamplePreview from './ExamplePreview.svelte';
  import type { DocsExample } from '../examples/registry';

  let { examples, selected }: { examples: readonly DocsExample[]; selected: DocsExample } = $props();

  interface CodeRatio {
    value: string;
    label: 'less code' | 'more code' | 'same size' | 'not comparable';
    compact: boolean;
  }

  const deltaLabel = $derived(formatDelta(selected.sourceStats.deltaLoc));
  const codeRatio = $derived(
    formatCodeRatio(selected.sourceStats.typeGpuLoc, selected.sourceStats.svelteLoc)
  );
  const typeGpuFileCountLabel = $derived(formatFileCount(selected.sourceStats.typeGpuFileCount));
  const svelteFileCountLabel = $derived(formatFileCount(selected.sourceStats.svelteFileCount));

  function formatDelta(delta: number): string {
    if (delta === 0) {
      return '0';
    }

    return delta > 0 ? `+${delta}` : `${delta}`;
  }

  function formatFileCount(count: number): string {
    return `${count} ${count === 1 ? 'file' : 'files'}`;
  }

  function formatCodeRatio(typeGpuLoc: number, svelteLoc: number): CodeRatio {
    if (typeGpuLoc <= 0 || svelteLoc <= 0) {
      return {
        value: 'n/a',
        label: 'not comparable',
        compact: false
      };
    }

    if (typeGpuLoc === svelteLoc) {
      return {
        value: '1.0x',
        label: 'same size',
        compact: true
      };
    }

    const compact = svelteLoc < typeGpuLoc;
    const ratio = compact ? typeGpuLoc / svelteLoc : svelteLoc / typeGpuLoc;

    return {
      value: `${ratio.toFixed(1)}x`,
      label: compact ? 'less code' : 'more code',
      compact
    };
  }
</script>

<section class="examples-layout">
  <aside class="example-rail" aria-label="Example list">
    {#each examples as example (example.slug)}
      <a
        class:active={example.slug === selected.slug}
        href={`/examples/${example.slug}`}
        aria-current={example.slug === selected.slug ? 'page' : undefined}
      >
        <span>{example.title}</span>
        <small>{example.category}</small>
      </a>
    {/each}
  </aside>
  <article class="example-workbench">
    <header class="example-header">
      <div>
        <p class="eyebrow">{selected.category}</p>
        <h1>{selected.title}</h1>
      </div>
      <a class="source-link" href={selected.typeGpuSourceUrl}>Original TypeGPU example</a>
    </header>
    <p class="example-description">{selected.description}</p>
    <div class="tag-row" aria-label="Example tags">
      {#each selected.tags as tag (tag)}
        <span>{tag}</span>
      {/each}
    </div>
    <div class="source-metrics" aria-label="Source line-count comparison">
      <div>
        <strong>{selected.sourceStats.typeGpuLoc}</strong>
        <span>TypeGPU LoC</span>
        <small>{typeGpuFileCountLabel}</small>
      </div>
      <div>
        <strong>{selected.sourceStats.svelteLoc}</strong>
        <span>svelte-typegpu LoC</span>
        <small>{svelteFileCountLabel}</small>
      </div>
      <div
        class="loc-delta"
        class:compact={selected.sourceStats.deltaLoc <= 0}
        class:expanded={selected.sourceStats.deltaLoc > 0}
      >
        <strong>{deltaLabel}</strong>
        <span>LoC delta</span>
        <small>Svelte minus TypeGPU</small>
      </div>
      <div
        class="loc-ratio"
        class:compact={codeRatio.compact}
        class:expanded={!codeRatio.compact}
      >
        <strong>{codeRatio.value}</strong>
        <span>{codeRatio.label}</span>
        <small>Compared with TypeGPU</small>
      </div>
    </div>
    <div class="preview-code-grid">
      <ExamplePreview mochi:hydrate slug={selected.slug} label={selected.title} />
      <CodePanel
        title={`${selected.slug} source`}
        files={selected.sourceFiles}
      />
    </div>
    <p class="example-note">{selected.notes}</p>
  </article>
</section>
