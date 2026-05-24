import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const typeGpuRenderer = fileURLToPath(import.meta.resolve('svelte-typegpu/svelte-renderer'));

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
