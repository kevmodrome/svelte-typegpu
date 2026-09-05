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
      '  <ambientLight color={[1, 1, 1]} intensity={0.25}></ambientLight>',
      '  <directionalLight rotation={[-0.8, 0.4, 0]} intensity={1.4}></directionalLight>',
      '  <mesh position={[0, 1, 0]}>',
      '    <boxGeometry width={1} height={1} depth={1}></boxGeometry>',
      '    <standardMaterial {color}></standardMaterial>',
      '  </mesh>',
      '</scene>'
    ].join('\n')
  },
  {
    id: 'quickstartInstall',
    filename: 'terminal',
    lang: 'bash',
    code: 'pnpm add svelte@https://pkg.svelte.dev/svelte/c/17e37a51bc539cdb6a923b424e5746fc6505ba89 svelte-typegpu'
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
      compilerOptions: {
        runes: true,
        experimental: {
          customRenderer: ({ filename }) =>
            filename.endsWith('.typegpu.svelte') ? typeGpuRenderer : null
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
      "  import Canvas from 'svelte-typegpu/canvas';",
      "  import Scene from './Scene.typegpu.svelte';",
      '</script>',
      '',
      '<Canvas',
      '  scene={Scene}',
      '  sceneProps={{}}',
      "  options={{ frameloop: 'demand' }}",
      '  style="height: 400px"',
      '/>'
    ].join('\n')
  }
] satisfies readonly DocSnippetDefinition[];
