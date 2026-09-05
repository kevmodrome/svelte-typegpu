import { fileURLToPath } from 'node:url';

export default {
  compilerOptions: {
    runes: true,
    experimental: {
      customRenderer: fileURLToPath(new URL('../../src/svelte-renderer.ts', import.meta.url))
    }
  }
};
