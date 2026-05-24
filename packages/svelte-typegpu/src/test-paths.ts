import { fileURLToPath } from 'node:url';

export const typeGpuRendererPath = fileURLToPath(new URL('./svelte-renderer.ts', import.meta.url));
