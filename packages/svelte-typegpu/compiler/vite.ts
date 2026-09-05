import { svelte, type Options } from '@sveltejs/vite-plugin-svelte';
import MagicString from 'magic-string';
import type { Warning } from 'svelte/compiler';
import type { Plugin } from 'vite';
import { adaptViewportClient, omitViewportScene, prepareTypeGpuSource } from './index.ts';

/** The normal Svelte Vite integration with the dedicated TypeGPU file boundary. */
export function typegpuSvelte(options: Options = {}) {
  const viewports = new Set<string>();
  const diagnostics = new Map<string, Warning[]>();
  const pendingWarnings = new Map<string, Warning[]>();
  const warningKey = (filename: string, ssr = false) => `${ssr ? 'server' : 'client'}:${filename}`;
  return [
    svelte({
      ...options,
      preprocess: [
        ...(Array.isArray(options.preprocess) ? options.preprocess : options.preprocess ? [options.preprocess] : []),
        { markup({ content, filename }) {
          if (!filename) return;
          const unchanged = () => ({ code: content, map: new MagicString(content).generateMap({ source: filename, includeContent: true, hires: true }) });
          if (!filename.endsWith('.typegpu.svelte')) return unchanged();
          const prepared = prepareTypeGpuSource(content, filename);
          diagnostics.set(filename, prepared.warnings);
          if (prepared.viewport) {
            viewports.add(filename);
            return { code: prepared.code, map: prepared.map };
          }
          viewports.delete(filename);
          return { code: prepared.code, map: prepared.map ?? unchanged().map };
        } }
      ],
      compilerOptions: {
        ...options.compilerOptions,
        hmr: false,
        runes: true,
        experimental: { ...options.compilerOptions?.experimental, customRenderer: ({ filename }) =>
          filename.endsWith('.typegpu.svelte') ? 'svelte-typegpu/svelte-renderer' : null }
      },
      async dynamicCompileOptions(args) {
        const extra = await options.dynamicCompileOptions?.(args) ?? {};
        const warnings = diagnostics.get(args.filename);
        if (warnings) {
          const filter = extra.warningFilter ?? args.compileOptions.warningFilter;
          pendingWarnings.set(warningKey(args.filename, args.compileOptions.generate === 'server'),
            warnings.filter((warning) => filter?.(warning) ?? true));
        }
        return { ...extra, hmr: false, ...(args.compileOptions.generate === 'server' && viewports.has(args.filename) ? {
          experimental: { ...options.compilerOptions?.experimental, customRenderer: () => null }
        } : {}) };
      }
    }),
    {
      name: 'typegpu-viewport-server',
      enforce: 'pre' as const,
      transform(code: string, id: string, options?: { ssr?: boolean }) {
        if (options?.ssr && viewports.has(id)) {
          const omitted = omitViewportScene(code, id);
          return { code: omitted.code, map: omitted.map.toString() };
        }
      }
    } satisfies Plugin,
    {
      name: 'typegpu-viewport-entry',
      enforce: 'post' as const,
      transform(code: string, id: string, transformOptions?: { ssr?: boolean }) {
        const key = warningKey(id, transformOptions?.ssr);
        const warnings = pendingWarnings.get(key);
        pendingWarnings.delete(key);
        const warn = (warning: Warning) => this.warn({
          message: `[${warning.code}] ${warning.message}${warning.frame ? `\n${warning.frame}` : ''}`,
          code: warning.code, id: warning.filename,
          loc: warning.start && { file: warning.filename ?? id, line: warning.start.line, column: warning.start.column },
          frame: warning.frame
        });
        for (const warning of warnings ?? []) {
          if (options.onwarn) options.onwarn(warning, warn);
          else warn(warning);
        }
        if (transformOptions?.ssr || !viewports.has(id)) return;
        const adapted = adaptViewportClient(code);
        return { code: adapted.code, map: adapted.map.toString() };
      }
    } satisfies Plugin
  ];
}
