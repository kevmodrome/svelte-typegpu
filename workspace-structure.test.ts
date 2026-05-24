import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('pnpm workspace layout', () => {
  it('declares the root package as a private pnpm workspace coordinator', () => {
    const rootPackage = JSON.parse(readFileSync('package.json', 'utf8')) as {
      private?: boolean;
      type?: string;
      packageManager?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      scripts?: Record<string, string>;
    };

    expect(rootPackage.private).toBe(true);
    expect(rootPackage.type).toBe('module');
    expect(rootPackage.packageManager).toBe('pnpm@10.28.1');
    expect(rootPackage.dependencies).toBeUndefined();
    expect(Object.keys(rootPackage.devDependencies ?? {}).sort()).toEqual([
      '@changesets/cli',
      '@types/node',
      'pkg-pr-new',
      'typescript',
      'vitest'
    ]);
    expect(rootPackage.scripts).toEqual({
      dev: 'pnpm --filter example --fail-if-no-match dev',
      build: 'pnpm -r --if-present run build',
      test: 'vitest run && pnpm -r --if-present run test',
      'test:watch': 'pnpm --filter example --fail-if-no-match test:watch',
      changeset: 'changeset',
      'version-packages': 'changeset version',
      release: 'pnpm build && changeset publish'
    });
  });

  it('includes app and package workspaces', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');

    expect(workspace).toMatch(/-\s*['"]?packages\/\*['"]?/);
    expect(workspace).toMatch(/-\s*['"]?apps\/\*['"]?/);
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
    expect(packageJson.repository).toMatchObject({
      type: 'git',
      directory: 'packages/svelte-typegpu'
    });
    expect(packageJson.files).toEqual([
      'src',
      '!src/**/*.test.ts',
      '!src/glb-test-fixtures.ts',
      '!src/test-paths.ts',
      '!src/svelte-internal-client.d.ts'
    ]);
    expect(packageJson.publishConfig?.access).toBe('public');
    expect(packageJson.peerDependencies?.svelte).toBe('>=5.55.9 <6');
    expect(packageJson.devDependencies?.svelte).toBe('https://pkg.pr.new/svelte@18042');
    expect(packageJson.dependencies?.svelte).toBeUndefined();
  });

  it('keeps example app on the Svelte PR preview package', () => {
    const packageJson = JSON.parse(readFileSync('apps/example/package.json', 'utf8')) as {
      dependencies?: Record<string, string>;
    };

    expect(packageJson.dependencies?.svelte).toBe('https://pkg.pr.new/svelte@18042');
    expect(packageJson.dependencies?.['svelte-typegpu']).toBe('workspace:*');
  });

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
});
