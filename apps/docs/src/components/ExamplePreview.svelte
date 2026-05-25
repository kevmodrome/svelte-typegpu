<script lang="ts">
  import { onMount } from 'svelte';
  import renderer, { createTypeGpuRoot, type TypeGpuRoot } from 'svelte-typegpu';
  import type { ExampleSlug } from '../examples/example-definitions';
  import { sceneComponents } from '../examples/scene-components';

  let { slug, label }: { slug: ExampleSlug; label: string } = $props();
  let host: HTMLDivElement;
  let error = $state<string | null>(null);
  let ready = $state(false);

  onMount(() => {
    let cancelled = false;
    let root: TypeGpuRoot | null = null;
    let instance: { unmount(): void } | null = null;

    if (!('gpu' in navigator)) {
      error = 'WebGPU is not available in this browser.';
      return;
    }

    createTypeGpuRoot({
      target: host,
      frameloop: 'always',
      maxDevicePixelRatio: 1.5,
      clearColor: [0.045, 0.05, 0.055, 1],
      depth: true,
      alphaMode: 'premultiplied'
    })
      .then((nextRoot) => {
        if (cancelled) {
          nextRoot.dispose();
          return;
        }

        root = nextRoot;
        try {
          instance = renderer.render(sceneComponents[slug], { target: root });
          ready = true;
          error = null;
        } catch (unknownError) {
          root.dispose();
          root = null;
          throw unknownError;
        }
      })
      .catch((unknownError: unknown) => {
        if (cancelled) return;
        error =
          unknownError instanceof Error
            ? `Unable to start this preview: ${unknownError.message}`
            : 'Unable to start this preview.';
      });

    return () => {
      cancelled = true;
      instance?.unmount();
      root?.dispose();
    };
  });
</script>

<section class="preview-panel" aria-label={`${label} live preview`}>
  <div class="preview-host" bind:this={host} data-ready={ready}></div>
  {#if error}
    <div class="preview-status" role="status">{error}</div>
  {:else if !ready}
    <div class="preview-status" role="status">Preparing WebGPU preview...</div>
  {/if}
</section>
