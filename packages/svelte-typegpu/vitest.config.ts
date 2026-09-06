import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [
    {
      name: 'test-node-builtins',
      enforce: 'pre',
      resolveId(id) {
        // happy-dom still runs in Node; production browser externalization loses the builtin's name.
        if (isBuiltin(id)) return { id, external: true };
      }
    },
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
        find: /^svelte\/reactivity$/,
        replacement: fileURLToPath(
          new URL('./src/reactivity/index-client.js', import.meta.resolve('svelte/package.json'))
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
