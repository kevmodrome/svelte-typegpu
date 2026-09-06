import { createRequire } from 'node:module';
import { resolve } from 'node:path';

if (!process.env.SVELTE_PROBE_DIR) throw new Error('CommonJS probe requires an isolated Svelte copy');
const compiler = createRequire(import.meta.url)(resolve(process.env.SVELTE_PROBE_DIR, 'compiler/index.js'));
export const { VERSION, compile, compileModule, migrate, parse, preprocess, print, walk } = compiler;
