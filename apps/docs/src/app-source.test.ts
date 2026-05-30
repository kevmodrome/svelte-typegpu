import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('docs app source wiring', () => {
  it('defines the expected Mochi documentation routes', () => {
    const source = read('./routes.ts');

    expect(source).toContain("'/': Mochi.page('./src/routes/Overview.svelte'");
    expect(source).toContain("'/quickstart': Mochi.page('./src/routes/Quickstart.svelte'");
    expect(source).toContain("'/examples': Mochi.page('./src/routes/Examples.svelte'");
    expect(source).toContain("'/examples/:slug': Mochi.page('./src/routes/Examples.svelte'");
  });

  it('declares direct docs dependencies for shader helpers and local Mochi builds', () => {
    const manifest = JSON.parse(read('../package.json')) as {
      scripts?: Record<string, string>;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };

    expect(manifest.scripts?.['generate:typegpu']).toContain('node --disable-warning=ExperimentalWarning --experimental-strip-types');
    expect(manifest.scripts?.['generate:typegpu']).toContain('scripts/compile-typegpu-scenes.ts');
    expect(manifest.dependencies?.typegpu).toBe('^0.11.6');
    expect(manifest.devDependencies?.bun).toBe('1.3.14');
    expect(manifest.devDependencies?.['vite-node']).toBeUndefined();
  });

  it('uses svelte-typegpu as the product name in the shell', () => {
    const source = read('./components/SiteShell.svelte');

    expect(source).toContain('svelte-typegpu');
    expect(source).toContain('<SiteNav');
  });

  it('keeps WebGPU preview failures local', () => {
    const source = read('./components/ExamplePreview.svelte');

    expect(source).toContain('createTypeGpuRoot');
    expect(source).toContain('WebGPU is not available');
    expect(source).toContain('Unable to start this preview');
  });

  it('renders generated Shiki tokens without raw HTML injection', () => {
    const source = read('./components/CodePanel.svelte');

    expect(source).toContain('highlightedCode');
    expect(source).toContain('tokenStyle');
    expect(source).toContain('{token.content}');
    expect(source).not.toContain('@html');
  });

  it('precompiles typegpu scenes with the custom renderer', () => {
    const source = read('../scripts/compile-typegpu-scenes.ts');
    const generated = read('./generated/typegpu-scenes/two-boxes/TwoBoxes.typegpu.js');

    expect(source).toContain("import { compile } from 'svelte/compiler'");
    expect(source).toContain("import.meta.resolve('svelte-typegpu/svelte-renderer')");
    expect(source).toContain('resolveRendererPath');
    expect(source).toContain('customRenderer: rendererPath');
    expect(source).toContain("import { codeToTokens } from 'shiki'");
    expect(source).toContain('highlightedExampleCode');
    expect(generated).toContain("from 'svelte-typegpu/svelte-renderer'");
    expect(generated).not.toContain('/Users/');
    expect(source).toContain('exampleCode');
  });

  it('rewrites generated scene imports to generated bundle files', () => {
    const twoBoxes = read('./generated/typegpu-scenes/two-boxes/TwoBoxes.typegpu.js');
    const orbitField = read(
      './generated/typegpu-scenes/interactive-orbit-field/InteractiveOrbitField.typegpu.js'
    );

    expect(twoBoxes).toContain("from './SceneBox.typegpu.js'");
    expect(twoBoxes).toContain("from './box-geometry.js'");
    expect(orbitField).toContain("from './disco-fragment.js'");
    expect(twoBoxes).not.toMatch(/from ['"].*\.typegpu\.svelte['"]/);
    expect(orbitField).not.toMatch(/from ['"]\.\/disco-fragment['"]/);
  });

  it('hydrates the live preview but keeps the code panel static on the examples route', () => {
    const routeSource = read('./routes/Examples.svelte');
    const workbenchSource = read('./components/ExampleWorkbench.svelte');
    const previewSource = read('./components/ExamplePreview.svelte');

    expect(routeSource).toContain('<ExampleWorkbench');
    expect(workbenchSource).toContain('<ExamplePreview');
    expect(workbenchSource).toContain('<ExamplePreview mochi:hydrate');
    expect(workbenchSource).not.toMatch(/<CodePanel[\s\S]*?mochi:hydrate/);
    expect(workbenchSource).toContain('files={selected.sourceFiles}');
    expect(previewSource).toContain('Example controls');
    expect(previewSource).toContain('controlStateForSlug');
  });

  it('renders source files as static anchor navigation instead of hydrated tabs', () => {
    const source = read('./components/CodePanel.svelte');

    expect(source).toContain('<nav class="code-tabs"');
    expect(source).toContain('href={`#${sourcePanelId(file, index)}`}');
    expect(source).toContain('class="source-panel"');
    expect(source).toContain('id={sourcePanelId(file, index)}');
    expect(source).toContain('function sourcePanelId');
    expect(source).not.toContain('role="tab"');
    expect(source).not.toContain('aria-selected');
    expect(source).not.toContain('onclick');
    expect(source).not.toContain('$state');
    expect(source).not.toContain('setActiveFile');
  });

  it('keeps the single-snippet code panel fallback available', () => {
    const source = read('./components/CodePanel.svelte');

    expect(source).toContain('filename?: string');
    expect(source).toContain('code?: string');
    expect(source).toContain('panelFiles');
    expect(source).toContain('codeToHighlightedLines');
    expect(source).not.toContain('files[activeIndex]');
  });

  it('uses generated Shiki-highlighted snippets on overview and quickstart', () => {
    const buildSource = read('../scripts/compile-typegpu-scenes.ts');
    const overviewSource = read('./routes/Overview.svelte');
    const quickstartSource = read('./routes/Quickstart.svelte');

    expect(buildSource).toContain('docSnippetDefinitions');
    expect(buildSource).toContain('docSnippetFiles');
    expect(overviewSource).toContain("import { docSnippetFiles } from '../generated/doc-snippets'");
    expect(overviewSource).toContain('files={docSnippetFiles.overviewIntro}');
    expect(overviewSource).not.toContain('code={introCode}');
    expect(quickstartSource).toContain("import { docSnippetFiles } from '../generated/doc-snippets'");
    expect(quickstartSource).toContain('files={docSnippetFiles.quickstartInstall}');
    expect(quickstartSource).toContain('files={docSnippetFiles.quickstartVite}');
    expect(quickstartSource).toContain('files={docSnippetFiles.quickstartMount}');
    expect(quickstartSource).not.toContain('code={installCode}');
  });

  it('shows inert line numbers in highlighted code blocks', () => {
    const componentSource = read('./components/CodePanel.svelte');
    const styleSource = read('./style.css');

    expect(componentSource).toContain('lineIndex + 1');
    expect(componentSource).toContain('class="line-number"');
    expect(componentSource).toContain('aria-hidden="true"');
    expect(styleSource).toContain('.line-number');
    expect(styleSource).toContain('font-variant-numeric: tabular-nums');
  });

  it('uses CSS target state to reveal one static source panel at a time', () => {
    const source = read('./style.css');

    expect(source).toContain('.source-panel:target');
    expect(source).toContain('.code-panel:has(.source-panel:target)');
    expect(source).toContain('.code-tabs a');
    expect(source).toContain('.code-tabs a:nth-child(2)');
    expect(source).not.toContain('.code-tabs button');
  });

  it('surfaces source line-count comparison near the example workbench', () => {
    const source = read('./components/ExampleWorkbench.svelte');

    expect(source).toContain('sourceStats');
    expect(source).toContain('deltaLabel');
    expect(source).toContain('codeRatio');
    expect(source).toContain('formatCodeRatio');
    expect(source).toContain('formatFileCount');
    expect(source).toContain('TypeGPU LoC');
    expect(source).toContain('svelte-typegpu LoC');
    expect(source).toContain('less code');
  });

  it('mirrors official TypeGPU example controls in the hydrated preview', () => {
    const previewSource = read('./components/ExamplePreview.svelte');
    const phongSource = read('./examples/phong-reflection/PhongReflection.typegpu.svelte');
    const simpleShadowSource = read('./examples/simple-shadow/SimpleShadow.typegpu.svelte');
    const simpleShadowLightsSource = read('./examples/simple-shadow/ShadowLights.typegpu.svelte');
    const discoSource = read('./examples/interactive-orbit-field/InteractiveOrbitField.typegpu.svelte');

    for (const label of [
      'light color',
      'light direction',
      'ambient color',
      'ambient strength',
      'specular exponent',
      'camera X',
      'light X',
      'light Y',
      'light Z',
      'cuboid thickness',
      'shadow map size',
      'shadow map filtering',
      'display mode',
      'Pattern'
    ]) {
      expect(previewSource).toContain(label);
    }

    expect(phongSource).toContain('phongControls');
    expect(phongSource).toContain('phongControls.lightDirection');
    expect(phongSource).toContain('specularExponent={phongControls.specularExponent}');
    expect(simpleShadowSource).toContain('simpleShadowControls');
    expect(previewSource).toContain('handleSimpleShadowCameraChange');
    expect(previewSource).toContain('setSimpleCameraX');
    expect(previewSource).toContain('onCameraChange: handleSimpleShadowCameraChange');
    expect(simpleShadowSource).toContain('onCameraChange');
    expect(simpleShadowSource).toContain('oncamerachange={onCameraChange}');
    expect(simpleShadowSource).toContain('position={simpleShadowControls.cameraPosition}');
    expect(simpleShadowSource).toContain('target={simpleShadowControls.cameraTarget}');
    expect(simpleShadowSource).toContain('color={[0.9, 0.5, 0.34, 1]}');
    expect(simpleShadowSource).toContain('color={[0.82, 0.86, 0.92, 1]}');
    expect(simpleShadowSource).toContain('simpleShadowControls.cuboidThickness');
    expect(simpleShadowSource).toContain('simpleShadowControls.shadowMapSize');
    expect(simpleShadowLightsSource).toContain('shadowMapSize={shadowMapSize}');
    expect(simpleShadowLightsSource).toContain('lightPosition');
    expect(simpleShadowLightsSource).toContain('-lightDirection[1]');
    expect(discoSource).toContain('discoControls');
    expect(discoSource).toContain("discoControls.pattern === 'pattern1'");
    expect(discoSource).toContain("discoControls.pattern === 'pattern7'");
  });

  it('generates aggregate source samples and LoC metadata', () => {
    const source = read('../scripts/compile-typegpu-scenes.ts');

    expect(source).toContain('sourceFiles');
    expect(source).toContain('typeGpuSourceFiles');
    expect(source).toContain('exampleSourceStats');
    expect(source).toContain('exampleSourceFiles');
    expect(source).toContain('countSourceLines');
  });

  it('defines stable preview and responsive example layouts', () => {
    const source = read('./style.css');
    const previewCodeGridRule =
      source.match(/\n\.preview-code-grid \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(source).toContain('.preview-panel');
    expect(source).toContain('aspect-ratio: 16 / 10');
    expect(source).toContain('.preview-code-grid');
    expect(previewCodeGridRule).toContain('grid-template-columns: 1fr');
    expect(previewCodeGridRule).not.toContain('minmax(340px');
    expect(source).toContain('@media (max-width: 820px)');
  });

  it('sets the dark shell background before first paint without page transition scripts', () => {
    const indexSource = read('./index.ts');
    const shellSource = read('./html-shell.ts');

    expect(indexSource).toContain('htmlShell');
    expect(indexSource).toContain('htmlShell,');
    expect(shellSource).toContain('criticalShellStyle');
    expect(shellSource).toContain('<style>${criticalShellStyle}</style>');
    expect(shellSource).toContain('background:#080d0f');
    expect(shellSource.indexOf('<style>${criticalShellStyle}</style>')).toBeLessThan(
      shellSource.indexOf('{{mochi.head}}')
    );
    expect(shellSource).not.toContain('viewTransitionHeadScript');
    expect(shellSource).not.toContain('<script>');
  });

  it('does not enable CSS page transitions', () => {
    const source = read('./style.css');

    expect(source).not.toContain('@view-transition');
    expect(source).not.toContain(':active-view-transition-type');
    expect(source).not.toContain('view-transition-name');
    expect(source).not.toContain('::view-transition');
    expect(source).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('gives the docs a distinctive shader workbench treatment', () => {
    const source = read('./style.css');

    expect(source).toContain('.site-frame::before');
    expect(source).toContain('.site-frame::after');
    expect(source).toContain('.doc-header::before');
    expect(source).toContain('.preview-panel::after');
    expect(source).toContain('.example-rail a.active::before');
    expect(source).toContain('repeating-linear-gradient');
    expect(source).toContain('clip-path: polygon');
  });

  it('keeps example navigation tiles unclipped with a restrained palette', () => {
    const source = read('./style.css');
    const exampleRailCardRule =
      source.match(/\n\.example-rail a \{[\s\S]*?\n\}/)?.[0] ?? '';

    expect(exampleRailCardRule).not.toContain('clip-path');
    expect(source).not.toContain('--acid');
    expect(source).not.toContain('--rose');
  });
});
