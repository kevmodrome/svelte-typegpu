# Svelte TypeGPU Renderer

Experimental scene-oriented TypeGPU/WebGPU custom renderer API for Svelte.
It compiles declarative scene nodes into TypeGPU resources, draw batches,
lighting, camera state, and interaction data.

This project targets the open Svelte custom renderer PR:
https://github.com/sveltejs/svelte/pull/18042

## Setup

```bash
pnpm run setup:svelte-pr
pnpm install
pnpm test
pnpm dev
```

The setup script clones Svelte's `svelte-custom-renderer` branch into `.svelte-pr/`.
That directory is intentionally ignored by Git.

The reusable renderer package lives in `packages/svelte-typegpu`. The current demo
application lives in `apps/example` and can be started directly with:

```bash
pnpm --filter example --fail-if-no-match dev
```
