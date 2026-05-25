<script lang="ts">
  import type { Snippet } from 'svelte';
  import SiteNav from './SiteNav.svelte';
  import '../style.css';

  let {
    activePath,
    title = 'svelte-typegpu',
    description = 'A Svelte custom renderer for TypeGPU and WebGPU scenes.',
    children
  }: {
    activePath: '/' | '/quickstart' | '/examples';
    title?: string;
    description?: string;
    children: Snippet;
  } = $props();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<div class="site-frame">
  <SiteNav {activePath} />
  <main class="site-main">
    {@render children()}
  </main>
</div>
