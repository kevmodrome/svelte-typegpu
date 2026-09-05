import { svelte, type Options } from '@sveltejs/vite-plugin-svelte';
import { adaptViewportClient, prepareTypeGpuSource } from './index';

/** The normal Svelte Vite integration with the dedicated TypeGPU file boundary. */
export function typegpuSvelte(options: Options = {}) {
  const viewports = new Set<string>();
  return [
    svelte({
      ...options,
      hot: false,
      preprocess: [
        ...(Array.isArray(options.preprocess) ? options.preprocess : options.preprocess ? [options.preprocess] : []),
        { markup({ content, filename }) {
          if (!filename?.endsWith('.typegpu.svelte')) return;
          const prepared = prepareTypeGpuSource(content, filename);
          if (prepared.viewport) viewports.add(filename); else viewports.delete(filename);
          return prepared;
        } }
      ],
      compilerOptions: {
        ...options.compilerOptions,
        runes: true,
        experimental: { ...options.compilerOptions?.experimental, customRenderer: ({ filename }) =>
          filename.endsWith('.typegpu.svelte') ? 'svelte-typegpu/svelte-renderer' : null }
      },
      dynamicCompileOptions(args) {
        const extra = options.dynamicCompileOptions?.(args) ?? {};
        return { ...extra, ...(args.compileOptions.generate === 'server' && viewports.has(args.filename) ? {
          experimental: { ...options.compilerOptions?.experimental, customRenderer: () => null }
        } : {}) };
      }
    }),
    {
      name: 'typegpu-viewport-entry',
      enforce: 'post' as const,
      transform(code: string, id: string, options?: { ssr?: boolean }) {
        if (options?.ssr || !viewports.has(id)) return;
        return adaptViewportClient(code);
      }
    }
  ];
}
