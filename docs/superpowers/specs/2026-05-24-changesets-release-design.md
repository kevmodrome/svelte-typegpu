# Changesets Release Design

## Goal

Set up a release workflow for `svelte-typegpu` so package versioning, changelog entries, preview installs, and npm publishing are repeatable.

## Current Context

The repository is a pnpm workspace with a private root package and one publishable library at `packages/svelte-typegpu`. The example app lives in `apps/example`. The library currently depends on Svelte's custom renderer pull request through a local `.svelte-pr` checkout, which is useful for local development but not suitable for published npm consumers. The release setup should replace that local dependency with a `pkg.pr.new` preview URL.

## Dependency Strategy

Use `pkg.pr.new` for the temporary Svelte pull request dependency:

```bash
pnpm add svelte@https://pkg.pr.new/svelte@18042
```

The library should declare Svelte as a normal peer dependency range and use the `pkg.pr.new` URL only for this repository's development dependency while the upstream custom renderer API is pending. Consumers should install the same Svelte PR preview explicitly alongside `svelte-typegpu`.

## Release Strategy

Use Changesets for version intent, changelog generation, and publish orchestration. The root package stays private. `packages/svelte-typegpu` becomes publishable, gains npm package metadata, and is released with `pnpm changeset version` and `pnpm changeset publish`.

Add GitHub Actions workflows for:

- CI on pull requests and pushes, including the Svelte PR dependency install, build, and tests.
- Release PR automation on `main` using Changesets' GitHub Action. When changesets are present, it opens or updates a version PR. When the version PR is merged, it publishes to npm.
- Optional package previews with `pkg.pr.new` on pull requests, so reviewers can install `svelte-typegpu` from the PR before an npm release.

## NPM Setup

The package should publish only package source and metadata needed by consumers. It should include `name`, `version`, `description`, `license`, `repository`, `keywords`, `files`, `exports`, `peerDependencies`, and `publishConfig`.

The first npm package setup requires:

1. Pick the final package name (`svelte-typegpu` is available unless npm ownership says otherwise).
2. Log into npm locally or configure a GitHub Actions `NPM_TOKEN`.
3. For automated publishing, add `NPM_TOKEN` as a repository secret or migrate later to npm trusted publishing.
4. Run the Changesets release flow from `main`.

## Testing

Add focused repo-structure tests for the release metadata and workflows. Run the full existing verification after implementation:

```bash
pnpm install
pnpm test
pnpm build
pnpm --filter svelte-typegpu --fail-if-no-match pack --dry-run
```
