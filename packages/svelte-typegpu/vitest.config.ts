import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    svelte({
      configFile: false,
      hot: false,
      compilerOptions: { runes: true },
      dynamicCompileOptions: () => ({ generate: 'client' })
    })
  ],
  test: {
    alias: [
      {
        find: /^svelte$/,
        replacement: fileURLToPath(
          new URL('./src/index-client.js', import.meta.resolve('svelte/package.json'))
        )
      },
      {
        find: /^svelte-test\/server$/,
        replacement: fileURLToPath(
          new URL('./src/index-server.js', import.meta.resolve('svelte/package.json'))
        )
      }
    ],
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,js}']
  }
});
