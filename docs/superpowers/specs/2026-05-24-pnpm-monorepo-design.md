# pnpm Monorepo Design

## Goal

Convert the repository from a single Vite application into a pnpm workspace monorepo with a reusable `svelte-typegpu` library package and the current app preserved as an example.

The library package should be the long-term home for the Svelte custom renderer and TypeGPU renderer internals. The current demo should remain available as an example app and should consume the library through the workspace package boundary.

## Scope

In scope:

- Adopt pnpm workspaces.
- Create `packages/svelte-typegpu` as the library package.
- Move renderer library source and tests into `packages/svelte-typegpu`.
- Move the current Vite demo app into `apps/example`.
- Update package scripts so root commands still build and test the project.
- Replace npm lockfile usage with pnpm lockfile usage.
- Keep the current example behavior working.
- Preserve the existing uncommitted renderer implementation changes while moving files.

Out of scope:

- Building the documentation website now.
- Publishing the package to npm.
- Changing renderer public API beyond import paths needed for packaging.
- Reworking demo UX or visual design.
- Committing unrelated `.DS_Store` files.

## Workspace Layout

The target structure is:

```txt
.
├── apps/
│   └── example/
│       ├── index.html
│       ├── public/
│       ├── src/
│       ├── package.json
│       ├── tsconfig.json
│       ├── tsconfig.node.json
│       └── vite.config.ts
├── packages/
│   └── svelte-typegpu/
│       ├── src/
│       ├── package.json
│       └── tsconfig.json
├── docs/
├── scripts/
├── package.json
├── pnpm-lock.yaml
└── pnpm-workspace.yaml
```

The root package remains private and exists to coordinate workspace scripts and shared setup. It should declare `packageManager: "pnpm@10"` and list workspaces in `pnpm-workspace.yaml`.

## Library Package

`packages/svelte-typegpu` owns the renderer library:

- `src/index.ts` exports the public library surface.
- Renderer internals currently under `src/lib/typegpu-renderer` move under `packages/svelte-typegpu/src`.
- Library tests move with the source so package-local test commands remain meaningful.
- The package is named `svelte-typegpu`.
- The package depends on `svelte` and `typegpu`.

The first package build can stay TypeScript/Vite-friendly rather than npm-publish-ready. The important boundary is that the example imports from `svelte-typegpu`, not from repository-relative renderer internals.

## Example App

`apps/example` owns the existing Vite demo:

- Current app components, styles, demo data helpers, and example tests move into `apps/example/src`.
- Current `public/textures/checker.svg` moves into `apps/example/public/textures/checker.svg`.
- The app depends on `svelte-typegpu` with `workspace:*`.
- The app keeps using the local Svelte PR dependency until the renderer no longer requires it.

The example should remain runnable with:

```bash
pnpm --filter example dev
```

Root `pnpm dev` may delegate to the example app.

## Package Manager

Use pnpm:

- Add `pnpm-workspace.yaml`.
- Remove `package-lock.json`.
- Generate `pnpm-lock.yaml`.
- Use pnpm workspace filters for package-specific commands.

Root scripts should keep the common workflow simple:

```json
{
  "setup:svelte-pr": "node scripts/setup-svelte-pr.mjs",
  "dev": "pnpm --filter example dev",
  "build": "pnpm -r build",
  "test": "pnpm -r test",
  "test:watch": "pnpm --filter example test:watch"
}
```

Package-local scripts can be adjusted during implementation if package names or test placement require more precise filters.

## Import Boundaries

After the move:

- Example app code imports renderer APIs from `svelte-typegpu`.
- Library internals keep relative imports within `packages/svelte-typegpu/src`.
- Example-only helpers stay in `apps/example/src/lib`.

This ensures the future docs site can depend on the same package boundary as external users.

## Testing

Implementation should use TDD for import-boundary and workspace behavior:

- A failing test or static assertion should prove the example imports the renderer through `svelte-typegpu`.
- Package-local renderer tests should continue to pass after moving files.
- Root `pnpm test` should pass.
- Root `pnpm build` should pass.
- `pnpm --filter example build` should pass.

The existing full verification baseline before the monorepo conversion was:

- `npm test`: 28 files and 304 tests passed.
- `npm run build`: completed successfully.

After conversion, equivalent pnpm commands should provide the new baseline.

## Migration Constraints

The working tree already contains uncommitted renderer implementation changes. The monorepo migration must preserve those changes and move them with the library files. It must not revert or overwrite them.

The repository also contains untracked `.DS_Store` files. They are unrelated to this migration and should remain untracked unless the user explicitly asks to clean them up.

## Success Criteria

The migration is complete when:

- Root uses pnpm workspaces.
- `packages/svelte-typegpu` exists and exposes the renderer library.
- `apps/example` contains the current demo app.
- The example app imports the renderer through `svelte-typegpu`.
- Root `pnpm test` passes.
- Root `pnpm build` passes.
- Existing renderer behavior remains covered by tests.
