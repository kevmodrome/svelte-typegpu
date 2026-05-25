export type DocSnippetId =
  | 'overviewIntro'
  | 'quickstartInstall'
  | 'quickstartVite'
  | 'quickstartMount';

export type DocSnippetLanguage = 'bash' | 'svelte' | 'ts';

export interface DocSnippetDefinition {
  id: DocSnippetId;
  filename: string;
  lang: DocSnippetLanguage;
  code: string;
}

export const docSnippetDefinitions = [
  {
    id: 'overviewIntro',
    filename: 'Scene.typegpu.svelte',
    lang: 'svelte',
    code: [
      '<script lang="ts">',
      "  import type { RgbaTuple } from 'svelte-typegpu';",
      '  let color: RgbaTuple = [0.94, 0.9, 0.82, 1];',
      '</script>',
      '',
      '<scene clearColor={[0.067, 0.078, 0.102, 1]}>',
      '  <perspectiveCamera id="main" active={true} position={[4, 3, 6]} target={[0, 0, 0]} fov={45}></perspectiveCamera>',
      '  <resources>',
      '    <boxGeometry id="box" width={1} height={1} depth={1}></boxGeometry>',
      '    <standardMaterial id="warm" {color}></standardMaterial>',
      '  </resources>',
      '  <ambientLight color={[1, 1, 1]} intensity={0.25}></ambientLight>',
      '  <directionalLight rotation={[-0.8, 0.4, 0]} intensity={1.4}></directionalLight>',
      '  <mesh geometry="box" material="warm" position={[0, 1, 0]}></mesh>',
      '</scene>'
    ].join('\n')
  },
  {
    id: 'quickstartInstall',
    filename: 'terminal',
    lang: 'bash',
    code: 'pnpm add svelte@https://pkg.pr.new/svelte@18042 svelte-typegpu'
  },
  {
    id: 'quickstartVite',
    filename: 'vite.config.ts',
    lang: 'ts',
    code: `import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';

const typeGpuRenderer = fileURLToPath(import.meta.resolve('svelte-typegpu/svelte-renderer'));

export default {
  plugins: [
    svelte({
      compilerOptions: { runes: true },
      dynamicCompileOptions({ filename }) {
        if (filename.endsWith('.typegpu.svelte')) {
          return { experimental: { customRenderer: typeGpuRenderer } };
        }
      }
    })
  ]
};`
  },
  {
    id: 'quickstartMount',
    filename: 'TypeGpuCanvas.svelte',
    lang: 'svelte',
    code: [
      '<script lang="ts">',
      "  import { onMount } from 'svelte';",
      "  import renderer, { createTypeGpuRoot } from 'svelte-typegpu';",
      "  import Scene from './Scene.typegpu.svelte';",
      '  let host: HTMLDivElement;',
      '  onMount(() => {',
      '    let cleanup = () => {};',
      "    createTypeGpuRoot({ target: host, frameloop: 'always' }).then((root) => {",
      '      const instance = renderer.render(Scene, { target: root });',
      '      cleanup = () => { instance.unmount(); root.dispose(); };',
      '    });',
      '    return () => cleanup();',
      '  });',
      '</script>',
      '<div bind:this={host}></div>'
    ].join('\n')
  }
] satisfies readonly DocSnippetDefinition[];
