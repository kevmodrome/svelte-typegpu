import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const typeGpuRendererPath = join(dirname(fileURLToPath(import.meta.url)), 'svelte-renderer.ts');
