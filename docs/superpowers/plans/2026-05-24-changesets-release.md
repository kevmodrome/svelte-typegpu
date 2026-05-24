# Changesets Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Changesets, npm package metadata, `pkg.pr.new` Svelte PR dependency support, and release/preview workflows for `svelte-typegpu`.

**Architecture:** Keep the root package private as the workspace coordinator. Make `packages/svelte-typegpu` publishable with normal npm metadata and a Svelte peer range, while using `https://pkg.pr.new/svelte@18042` as this repo's development Svelte. Use Changesets for versioning and GitHub Actions for CI, release PRs, npm publish, and package previews.

**Tech Stack:** pnpm 10, TypeScript, Vitest, Changesets, GitHub Actions, pkg.pr.new, npm.

---

## File Structure

- Modify `package.json`: add Changesets scripts and dev dependency.
- Modify `packages/svelte-typegpu/package.json`: remove `private`, add npm metadata, set Svelte peer dependency, keep repo development dependency on the Svelte PR preview.
- Modify `apps/example/package.json`: use the same Svelte PR preview URL instead of the local `.svelte-pr` package.
- Delete `scripts/setup-svelte-pr.mjs`: the package manager now installs the Svelte PR preview directly.
- Modify `workspace-structure.test.ts`: update expected root scripts and add release metadata/workflow checks.
- Add `.changeset/config.json`: Changesets configuration for a public package in this workspace.
- Add `.github/workflows/ci.yml`: install, build, and test on pull requests and pushes.
- Add `.github/workflows/release.yml`: Changesets release PR and npm publish workflow.
- Add `.github/workflows/pkg-pr-new.yml`: preview package workflow for PR installs.
- Modify `README.md`: document npm setup, prerelease consumer install, and release flow.
- Update `pnpm-lock.yaml`: lock the Svelte PR URL and Changesets tooling.

### Task 1: Release Metadata Tests

**Files:**
- Modify: `workspace-structure.test.ts`

- [ ] **Step 1: Write failing tests**

Add tests that assert:

```ts
it('configures release scripts and Changesets at the private root', () => {
  const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as {
    private?: boolean;
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(rootPackage.private).toBe(true);
  expect(rootPackage.scripts).toMatchObject({
    changeset: 'changeset',
    'version-packages': 'changeset version',
    release: 'pnpm build && changeset publish'
  });
  expect(rootPackage.devDependencies?.['@changesets/cli']).toBeDefined();
});

it('makes svelte-typegpu publishable while using the Svelte PR preview for development', () => {
  const packageJson = JSON.parse(
    readFileSync('packages/svelte-typegpu/package.json', 'utf8')
  ) as {
    private?: boolean;
    description?: string;
    license?: string;
    repository?: { type?: string; url?: string; directory?: string };
    files?: string[];
    publishConfig?: { access?: string };
    peerDependencies?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(packageJson.private).toBeUndefined();
  expect(packageJson.description).toBeTruthy();
  expect(packageJson.license).toBeTruthy();
  expect(packageJson.repository?.directory).toBe('packages/svelte-typegpu');
  expect(packageJson.files).toEqual(['src']);
  expect(packageJson.publishConfig?.access).toBe('public');
  expect(packageJson.peerDependencies?.svelte).toBe('>=5.55.9 <6');
  expect(packageJson.devDependencies?.svelte).toBe('https://pkg.pr.new/svelte@18042');
  expect(packageJson.dependencies?.svelte).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify failure**

Run: `pnpm vitest run workspace-structure.test.ts`

Expected: FAIL because Changesets scripts, npm metadata, and Svelte PR URL dependency are not configured yet.

### Task 2: Package Metadata and Changesets Config

**Files:**
- Modify: `package.json`
- Modify: `packages/svelte-typegpu/package.json`
- Modify: `apps/example/package.json`
- Create: `.changeset/config.json`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add release package metadata**

Update root scripts to include:

```json
{
  "changeset": "changeset",
  "version-packages": "changeset version",
  "release": "pnpm build && changeset publish"
}
```

Add `@changesets/cli` as a dev dependency.

Update `packages/svelte-typegpu/package.json` so Svelte is a peer plus dev dependency:

```json
{
  "description": "Experimental TypeGPU/WebGPU custom renderer for Svelte.",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/kevinschaich/svelte-webgl-renderer.git",
    "directory": "packages/svelte-typegpu"
  },
  "keywords": ["svelte", "webgpu", "typegpu", "renderer", "custom-renderer"],
  "files": ["src"],
  "publishConfig": {
    "access": "public"
  },
  "peerDependencies": {
    "svelte": ">=5.55.9 <6"
  },
  "dependencies": {
    "typegpu": "^0.11.6"
  },
  "devDependencies": {
    "svelte": "https://pkg.pr.new/svelte@18042"
  }
}
```

Update `apps/example/package.json` to use:

```json
{
  "dependencies": {
    "svelte": "https://pkg.pr.new/svelte@18042",
    "svelte-typegpu": "workspace:*"
  }
}
```

Create `.changeset/config.json`:

```json
{
  "$schema": "https://unpkg.com/@changesets/config@3.1.1/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": ["example"]
}
```

- [ ] **Step 2: Install and lock dependencies**

Run: `pnpm install`

Expected: PASS and `pnpm-lock.yaml` records `@changesets/cli` and `svelte@https://pkg.pr.new/svelte@18042`.

- [ ] **Step 3: Run release metadata tests**

Run: `pnpm vitest run workspace-structure.test.ts`

Expected: PASS.

### Task 3: GitHub Workflows and README

**Files:**
- Create: `.github/workflows/ci.yml`
- Create: `.github/workflows/release.yml`
- Create: `.github/workflows/pkg-pr-new.yml`
- Modify: `README.md`
- Modify: `workspace-structure.test.ts`

- [ ] **Step 1: Add failing workflow tests**

Add tests that read workflow files and assert:

```ts
it('defines CI, release, and preview package workflows', () => {
  const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
  const release = readFileSync('.github/workflows/release.yml', 'utf8');
  const preview = readFileSync('.github/workflows/pkg-pr-new.yml', 'utf8');

  expect(ci).toContain('pnpm install --frozen-lockfile');
  expect(ci).toContain('pnpm test');
  expect(ci).toContain('pnpm build');
  expect(release).toContain('changesets/action');
  expect(release).toContain('NPM_TOKEN');
  expect(release).toContain('pnpm release');
  expect(preview).toContain('pkg-pr-new publish');
  expect(preview).toContain('./packages/svelte-typegpu');
});
```

Run: `pnpm vitest run workspace-structure.test.ts`

Expected: FAIL because workflow files do not exist.

- [ ] **Step 2: Add workflows**

Create `.github/workflows/ci.yml` with checkout, Node 20, pnpm cache, `pnpm install --frozen-lockfile`, `pnpm test`, and `pnpm build`.

Create `.github/workflows/release.yml` on pushes to `main`, with `contents: write`, `pull-requests: write`, and `id-token: write`, using `changesets/action@v1` with `version: pnpm version-packages`, `publish: pnpm release`, and `NPM_TOKEN`.

Create `.github/workflows/pkg-pr-new.yml` on pull requests, with `contents: read`, `pull-requests: write`, install/build steps, and `pnpm exec pkg-pr-new publish --pnpm --packageManager=pnpm --no-compact ./packages/svelte-typegpu`.

- [ ] **Step 3: Document npm setup and release flow**

Add README sections for:

```md
## Using the Svelte PR Preview

Until Svelte PR 18042 lands, apps using this package need the same Svelte preview:

pnpm add svelte@https://pkg.pr.new/svelte@18042 svelte-typegpu

## Releases

Create a changeset with pnpm changeset, merge the generated release PR, and the release workflow publishes to npm with NPM_TOKEN.
```

- [ ] **Step 4: Run workflow tests**

Run: `pnpm vitest run workspace-structure.test.ts`

Expected: PASS.

### Task 4: Final Verification

**Files:**
- Verify only.

- [ ] **Step 1: Run full tests**

Run: `pnpm test`

Expected: PASS.

- [ ] **Step 2: Run full build**

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 3: Verify npm package contents**

Run: `pnpm --filter svelte-typegpu --fail-if-no-match pack --dry-run`

Expected: PASS and tarball contents are limited to package metadata plus `src` files.
