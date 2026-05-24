# Svelte TypeGPU Renderer

Experimental scene-oriented TypeGPU/WebGPU custom renderer API for Svelte.
It compiles declarative scene nodes into TypeGPU resources, draw batches,
lighting, camera state, and interaction data.

This project targets the open Svelte custom renderer PR:
https://github.com/sveltejs/svelte/pull/18042

## Setup

```bash
pnpm install
pnpm test
pnpm dev
```

The reusable renderer package lives in `packages/svelte-typegpu`. The current demo
application lives in `apps/example` and can be started directly with:

```bash
pnpm --filter example --fail-if-no-match dev
```

## Using the Svelte PR Preview

Until Svelte PR 18042 lands, apps using this package need the same Svelte
preview build:

```bash
pnpm add svelte@https://pkg.pr.new/svelte@18042 svelte-typegpu
```

This repository also uses that `pkg.pr.new` URL for development and CI instead
of a local Svelte checkout.

## Releases

This repo uses Changesets for versioning and npm publishing.

Create a changeset for each user-facing package change:

```bash
pnpm changeset
```

After changes land on `main`, the release workflow opens or updates a Changesets
release PR. Merging that release PR publishes `svelte-typegpu` with:

```bash
pnpm release
```

The GitHub repository needs an `NPM_TOKEN` secret that can publish the package.
The first npm setup is:

1. Create or claim the `svelte-typegpu` package name on npm.
2. Create an npm automation token with publish access.
3. Add that token to the GitHub repository secrets as `NPM_TOKEN`.
4. Merge the generated Changesets release PR.

Pull requests also publish preview packages through `pkg.pr.new`. Install the
pkg.pr.new GitHub App on the repository before relying on those preview links.
