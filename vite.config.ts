import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const customRenderers = {
  three: '/src/lib/three-renderer/svelte-renderer.ts',
  typegpu: '/src/lib/typegpu-renderer/svelte-renderer.ts'
};

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
              customRenderer: customRenderers.three
            }
          };
        }

        if (filename.endsWith('.typegpu.svelte')) {
          return {
            experimental: {
              customRenderer: customRenderers.typegpu
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
