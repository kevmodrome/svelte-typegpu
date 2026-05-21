import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const typeGpuRenderer = '/src/lib/typegpu-renderer/svelte-renderer.ts';

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
