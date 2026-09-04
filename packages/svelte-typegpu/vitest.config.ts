import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
