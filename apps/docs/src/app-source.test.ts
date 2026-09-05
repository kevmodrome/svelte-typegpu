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

    expect(manifest.scripts?.['generate:typegpu']).toContain('bun');
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

  it('shows the live preview FPS from the TypeGPU root', () => {
    const previewSource = read('./components/ExamplePreview.svelte');
    const styleSource = read('./style.css');

    expect(previewSource).toContain('let fps = $state<number | null>(null)');
    expect(previewSource).toContain('onFps: (value) => (fps = value)');
    expect(previewSource).toContain('aria-label="Preview frames per second"');
    expect(previewSource).toContain('{fps === null ?');
    expect(styleSource).toContain('.fps-badge');
    expect(styleSource).toContain('position: absolute');
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
    expect(read('./snippets/doc-snippets.ts')).toContain(
      "filename.endsWith('.typegpu.svelte') ? typeGpuRenderer : null"
    );
    expect(source).toContain("import { codeToTokens } from 'shiki'");
    expect(source).toContain('highlightedExampleCode');
    expect(generated).toContain("from 'svelte-typegpu/svelte-renderer'");
    expect(generated).not.toContain('/Users/');
    expect(source).toContain('exampleCode');
  });

  it('rewrites generated scene imports to generated bundle files', () => {
    const twoBoxes = read('./generated/typegpu-scenes/two-boxes/TwoBoxes.typegpu.js');
    const orbitField = read(
      './generated/typegpu-scenes/disco-shader-pass/DiscoShaderPass.typegpu.js'
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

  it('keeps numeric example control outputs from resizing range sliders', () => {
    const source = read('./style.css');

    expect(source).toContain('font-variant-numeric: tabular-nums');
    expect(source).toContain('min-width: 5ch');
  });

  it('mirrors official TypeGPU example controls in the hydrated preview', () => {
    const previewSource = read('./components/ExamplePreview.svelte');
    const phongSource = read('./examples/phong-reflection/PhongReflection.typegpu.svelte');
    const simpleShadowSource = read('./examples/simple-shadow/SimpleShadow.typegpu.svelte');
    const simpleShadowLightsSource = read('./examples/simple-shadow/ShadowLights.typegpu.svelte');
    const discoSource = read('./examples/disco-shader-pass/DiscoShaderPass.typegpu.svelte');
    const smokySource = read('./examples/smoky-triangle/SmokyTriangle.typegpu.svelte');
    const smokyFragmentSource = read('./examples/smoky-triangle/smoky-triangle-fragment.ts');
    const gravitySource = read('./examples/gravity/Gravity.typegpu.svelte');
    const gravitySimulationSource = read('./examples/gravity/gravity-simulation.ts');

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
      'Pattern',
      'distortion',
      'sharpness',
      'From Color',
      'To Color',
      'Polar Coordinates',
      'Squashed',
      'Clouds Preset',
      'Fire Preset',
      'preset',
      'simulation speed modifier'
    ]) {
      expect(previewSource).toContain(label);
    }

    expect(phongSource).toContain('phongControls');
    expect(phongSource).toContain('phongControls.lightDirection');
    expect(phongSource).toContain('specularExponent={phongControls.specularExponent}');
    expect(phongSource).toContain('{#await request}');
    expect(previewSource).toContain('onModelStatus:');
    expect(previewSource).toContain('Model URL');
    const phongInputs = previewSource.split("{:else if slug === 'phong-reflection'}")[1]
      .split("{:else if slug === 'simple-shadow'}")[0];
    expect(phongInputs).not.toContain('rerenderScene()');
    const phongSetters = previewSource.split('function setColor(')[1]
      .split('function setSimpleValue')[0];
    expect(phongSetters).not.toContain('rerenderScene()');
    expect(simpleShadowSource).toContain('simpleShadowControls');
    expect(previewSource).toContain('handleSimpleShadowCameraChange');
    expect(previewSource).toContain('setSimpleCameraX');
    expect(previewSource).toContain('onCameraChange: handleSimpleShadowCameraChange');
    expect(simpleShadowSource).toContain('onCameraChange');
    expect(simpleShadowSource).toContain('oncamerachange={onCameraChange}');
    expect(simpleShadowSource).toContain('position={simpleShadowControls.cameraPosition}');
    expect(simpleShadowSource).toContain('target={simpleShadowControls.cameraTarget}');
    expect(simpleShadowSource).toContain('color={[0.8, 0.7, 0.7, 1]}');
    expect(simpleShadowSource).toContain('color={[0.5, 0.4, 0.7, 1]}');
    expect(simpleShadowSource).toContain('simpleShadowControls.cuboidThickness');
    expect(simpleShadowSource).toContain('simpleShadowControls.shadowMapSize');
    expect(simpleShadowLightsSource).toContain('shadowMapSize={shadowMapSize}');
    expect(simpleShadowLightsSource).toContain('lightPosition');
    expect(simpleShadowLightsSource).toContain('-lightDirection[1]');
    expect(simpleShadowLightsSource).toContain('TYPEGPU_SHADOW_DEPTH_BIAS = 1 / 1_000_000');
    expect(simpleShadowLightsSource).toContain('TYPEGPU_SHADOW_SLOPE_BIAS = 4');
    expect(simpleShadowLightsSource).toContain('shadowBias={TYPEGPU_SHADOW_DEPTH_BIAS}');
    expect(simpleShadowLightsSource).toContain('shadowSlopeBias={TYPEGPU_SHADOW_SLOPE_BIAS}');
    expect(discoSource).toContain('discoControls');
    expect(discoSource).toContain('fragments[discoControls.pattern]');
    expect(discoSource).toContain('pattern7: discoFragment7');
    expect(discoSource).not.toContain('active={discoControls.pattern');

    expect(previewSource).toContain('setSmokyPreset');
    expect(previewSource).toContain('setSmokyColor');
    expect(previewSource).toContain('type="color"');
    expect(previewSource).toContain("oninput={(event) => setSmokyColor('fromColor', event.currentTarget.value)}");
    expect(previewSource).toContain("oninput={(event) => setSmokyColor('toColor', event.currentTarget.value)}");
    expect(smokySource).toContain('smokyTriangleControls');
    expect(smokySource).toContain('createSmokyTriangleFragment(smokyTriangleControls)');
    expect(smokySource).toContain('smokyTriangleUniforms');
    expect(smokySource).toContain('value0: smokyTriangleControls.fromColor');
    expect(smokySource).toContain('value1: smokyTriangleControls.toColor');
    expect(smokyFragmentSource).toContain('interface SmokyTriangleControls');
    expect(smokyFragmentSource).toContain('controls.distortion');
    expect(smokyFragmentSource).toContain('controls.sharpness ** 2');
    expect(smokyFragmentSource).toContain('uniforms.value0.rgb');
    expect(smokyFragmentSource).toContain('uniforms.value1.rgb');
    expect(smokyFragmentSource).not.toContain('vec3fLiteral');

    expect(previewSource).toContain('Solar System');
    expect(gravitySimulationSource).toContain('Asteroids');
    expect(gravitySimulationSource).toContain('Colliding asteroids');
    expect(gravitySimulationSource).toContain('Bouncy dust');
    expect(gravitySimulationSource).toContain('Merging dust');
    expect(gravitySource).toContain('gravityControls.preset');
    expect(gravitySimulationSource).toContain('export type GravityPreset =');
    expect(gravitySimulationSource).toContain("| 'Solar System'");
  });

  it('generates aggregate source samples and LoC metadata', () => {
    const source = read('../scripts/compile-typegpu-scenes.ts');
    const sourceTextImports = read('../scripts/example-source-texts.ts');

    expect(source).toContain('sourceFiles');
    expect(source).toContain('typeGpuSourceFiles');
    expect(source).toContain('exampleSourceStats');
    expect(source).toContain('exampleSourceFiles');
    expect(source).toContain('countSourceLines');
    expect(source).toContain('exampleSourceTexts');
    expect(sourceTextImports).toContain('with { type: \'text\' }');
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
