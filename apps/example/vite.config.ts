import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { typegpuSvelte } from 'svelte-typegpu/vite';

export default defineConfig({
  plugins: [typegpuSvelte()],
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
