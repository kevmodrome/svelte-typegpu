<script lang="ts">
  let { activePath }: { activePath: '/' | '/quickstart' | '/examples' } = $props();

  const navItems = [
    { href: '/', label: 'Overview' },
    { href: '/quickstart', label: 'Quickstart' },
    { href: '/examples', label: 'Examples' }
  ] as const;
</script>

<header class="site-nav">
  <a class="brand" href="/" aria-label="svelte-typegpu home">
    <span class="brand-mark" aria-hidden="true"></span>
    <span>svelte-typegpu</span>
  </a>
  <nav class="nav-links" aria-label="Primary navigation">
    {#each navItems as item (item.href)}
      <a href={item.href} aria-current={activePath === item.href ? 'page' : undefined}>{item.label}</a>
    {/each}
  </nav>
</header>
