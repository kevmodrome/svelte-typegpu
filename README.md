# Svelte TypeGPU Renderer

Experimental scene-oriented TypeGPU/WebGPU custom renderer API for Svelte.
It compiles declarative scene nodes into TypeGPU resources, draw batches,
lighting, camera state, and interaction data.

This project targets the open Svelte custom renderer PR:
https://github.com/sveltejs/svelte/pull/18042

## Setup

```bash
npm run setup:svelte-pr
npm install
npm run test
npm run dev
```

The setup script clones Svelte's `svelte-custom-renderer` branch into `.svelte-pr/`.
That directory is intentionally ignored by Git.
