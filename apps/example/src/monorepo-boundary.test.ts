import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sourceRoot = fileURLToPath(new URL('./', import.meta.url));
const appConfig = fileURLToPath(new URL('../vite.config.ts', import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
};

const sourceFiles = [...collectSourceFiles(sourceRoot), appConfig];
const rendererBoundaryPatterns = [
  ['.', 'lib', 'typegpu-renderer'].join('/'),
  ['..', 'lib', 'typegpu-renderer'].join('/'),
  ['.', 'typegpu-renderer'].join('/'),
  ['..', 'typegpu-renderer'].join('/'),
  ['packages', 'svelte-typegpu', 'src'].join('/')
];

describe('example package boundary', () => {
  it('imports TypeGPU renderer APIs through svelte-typegpu', () => {
    for (const path of sourceFiles) {
      const source = readFileSync(path, 'utf8');

      for (const pattern of rendererBoundaryPatterns) {
        expect(source).not.toContain(pattern);
      }
      expect(source).not.toMatch(/from\s+['"]typegpu['"]/);
    }

    expect(readFileSync(new URL('./TypeGpuCanvas.svelte', import.meta.url), 'utf8')).toContain(
      "from 'svelte-typegpu/canvas'"
    );
    expect(readFileSync(new URL('./Scene.typegpu.test.ts', import.meta.url), 'utf8')).toContain(
      "from 'svelte-typegpu'"
    );
  });

  it('keeps TypeGPU owned by the renderer package', () => {
    expect(packageJson.dependencies).toEqual({
      svelte: 'https://pkg.svelte.dev/svelte/c/17e37a51bc539cdb6a923b424e5746fc6505ba89',
      'svelte-typegpu': 'workspace:*'
    });
    expect(packageJson.dependencies).not.toHaveProperty('typegpu');
    expect(packageJson.devDependencies).not.toHaveProperty('typegpu');
    expect(packageJson.devDependencies).toMatchObject({
      '@sveltejs/vite-plugin-svelte': '^6.2.1',
      vite: '^7.2.4'
    });
  });
});

function collectSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) return collectSourceFiles(path);
    if (!/\.(?:ts|svelte)$/.test(entry.name)) return [];

    return [path];
  });
}
