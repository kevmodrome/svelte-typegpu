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
      '@types/node',
      'typescript',
      'vitest'
    ]);
    expect(rootPackage.scripts).toEqual({
      'setup:svelte-pr': 'node scripts/setup-svelte-pr.mjs',
      dev: 'pnpm --filter example --fail-if-no-match dev',
      build: 'pnpm -r --if-present run build',
      test: 'vitest run && pnpm -r --if-present run test',
      'test:watch': 'pnpm --filter example --fail-if-no-match test:watch'
    });
  });

  it('includes app and package workspaces', () => {
    const workspace = readFileSync('pnpm-workspace.yaml', 'utf8');

    expect(workspace).toMatch(/-\s*['"]?packages\/\*['"]?/);
    expect(workspace).toMatch(/-\s*['"]?apps\/\*['"]?/);
  });
});
