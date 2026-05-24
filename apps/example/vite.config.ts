import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const __dirname = dirname(fileURLToPath(import.meta.url));
const typeGpuRenderer = resolve(__dirname, '../../packages/svelte-typegpu/src/svelte-renderer.ts');

export default defineConfig({
  plugins: [
    svelte({
      extensions: ['.svelte'],
      compilerOptions: {
        runes: true
      },
      dynamicCompileOptions({ filename }) {
        if (filename.endsWith('.typegpu.svelte')) {
          return {
            experimental: {
              customRenderer: typeGpuRenderer
            }
          };
        }
      }
    })
  ],
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,js}']
  }
});
