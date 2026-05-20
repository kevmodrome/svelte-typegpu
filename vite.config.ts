import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const customRenderer = '/src/lib/three-renderer/svelte-renderer.ts';

export default defineConfig({
  plugins: [
    svelte({
      extensions: ['.svelte'],
      compilerOptions: {
        runes: true
      },
      dynamicCompileOptions({ filename }) {
        if (filename.endsWith('.three.svelte')) {
          return {
            experimental: {
              customRenderer
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
