import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const typeGpuRenderer = fileURLToPath(import.meta.resolve('svelte-typegpu/svelte-renderer'));

export default defineConfig({
  plugins: [
    svelte({
      extensions: ['.svelte'],
      compilerOptions: {
        runes: true,
        experimental: {
          customRenderer: ({ filename }) =>
            filename.endsWith('.typegpu.svelte') ? typeGpuRenderer : null
        }
      }
    })
  ],
  test: {
    alias: [
      {
        find: /^svelte$/,
        replacement: fileURLToPath(
          new URL('./src/index-client.js', import.meta.resolve('svelte/package.json'))
        )
      }
    ],
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,js}']
  }
});
