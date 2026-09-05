import { fileURLToPath } from 'node:url';
import { build, createLogger } from 'vite';
import { expect, it, vi } from 'vitest';
import { typegpuSvelte } from 'svelte-typegpu/vite';

it.each([false, true])('builds the viewport through Vite (SSR: %s)', async (ssr) => {
  const entry = fileURLToPath(new URL('./test-fixtures/Viewport.typegpu.svelte', import.meta.url));
  const logger = createLogger('silent');
  const warn = vi.spyOn(logger, 'warn');
  const result = await build({
    configFile: false, customLogger: logger, plugins: [typegpuSvelte({ configFile: false })],
    ssr: { noExternal: ['svelte-typegpu'] },
    build: {
      write: false, minify: false, ssr: ssr ? entry : false,
      lib: { entry, formats: ['es'], fileName: 'viewport' }
    }
  });
  expect(warn.mock.calls.flat().join('\n')).not.toContain('Sourcemap');
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((item) => 'output' in item ? item.output : []);
  const code = outputs.filter((item) => item.type === 'chunk').map((item) => item.code).join('\n');
  expect(code).toContain('canvas');
  expect(code).toContain('Build test');
  if (!ssr) {
    const css = outputs.filter((item) => item.type === 'asset').map((item) => String(item.source)).join('\n');
    expect(css).toContain('420px');
    expect(css).toContain('typegpu-');
  }
}, 30_000);
