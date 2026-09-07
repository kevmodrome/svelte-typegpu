import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  exampleCode,
  exampleSourceStats,
  exampleSourceFiles,
  highlightedExampleCode
} from '../generated/code-samples';
import { exampleDefinitions } from './example-definitions';
import { examples, getExampleBySlug } from './registry';

const officialExampleUrls = {
  'two-boxes': 'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--two-boxes',
  'phong-reflection':
    'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--phong-reflection',
  'simple-shadow': 'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--simple-shadow',
  'disco-shader-pass': 'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--disco',
  'smoky-triangle': 'https://docs.swmansion.com/TypeGPU/examples/#example=rendering--smoky-triangle',
  gravity: 'https://docs.swmansion.com/TypeGPU/examples/#example=simulation--gravity'
} as const;

describe('docs example registry', () => {
  it('contains the curated TypeGPU adaptations in display order', () => {
    expect(examples.map((example) => example.slug)).toEqual([
      'two-boxes',
      'asset-world',
      'occlusion',
      'svelte-motion',
      'native-events',
      'shared-stores',
      'reactive-collections',
      'phong-reflection',
      'simple-shadow',
      'disco-shader-pass',
      'smoky-triangle',
      'multiple-smoky-triangles',
      'gravity'
    ]);
  });

  it('publishes the asset world with reusable components and local GLB loading', () => {
    const example = getExampleBySlug('asset-world');
    expect(example.sourceFiles.map(file => file.filename)).toEqual([
      'AssetWorld.svelte', 'WorldViewport.typegpu.svelte', 'Campsite.typegpu.svelte',
      'Canoe.typegpu.svelte', 'Player.typegpu.svelte', 'MovementPad.svelte',
      'player-controller.ts', 'player-input.ts', 'world.ts', 'Landscape.typegpu.svelte',
      'WorldCamera.typegpu.svelte', 'landscape.ts', 'model-detail.ts', 'world-profile.ts',
      'Tree.typegpu.svelte', 'Rock.typegpu.svelte', 'Log.typegpu.svelte', 'Tent.typegpu.svelte',
      'Campfire.typegpu.svelte', 'Bridge.typegpu.svelte', 'Sign.typegpu.svelte',
      'SelectionMarker.typegpu.svelte', 'Terrain.typegpu.svelte', 'WorldLighting.typegpu.svelte'
    ]);
    for (const syntax of ['<canvas', '<model', '<frameTask', 'loadModel(', 'onclick=', 'AbortController']) {
      expect(example.code).toContain(syntax);
    }
    expect(example.code).not.toContain('requestAnimationFrame');
    expect(example.code).not.toContain('sceneProps');
    for (const syntax of ['<Tree', '<Rock', '<Log', '<WorldLighting', '<Terrain', '<SelectionMarker']) {
      expect(example.code).toContain(syntax);
    }
  });

  it('publishes composable occlusion walls and a renderer-owned camera sweep', () => {
    const example = getExampleBySlug('occlusion');
    expect(example.sourceFiles.map(file => file.filename)).toEqual([
      'Occlusion.svelte', 'Courtyard.typegpu.svelte', 'Wall.typegpu.svelte', 'Sculpture.typegpu.svelte', 'world-profile.ts'
    ]);
    for (const syntax of ['<Wall', '<Sculpture', '<frameTask', 'occlusion={', 'Triangles (upper bound)']) {
      expect(example.code).toContain(syntax);
    }
    expect(example.code).not.toContain('requestAnimationFrame');
  });

  it('keeps metadata complete for every example', () => {
    for (const example of examples) {
      expect(example.title).toMatch(/\S/);
      expect(example.description).toMatch(/\S/);
      expect(example.category).toMatch(/\S/);
      expect(example.tags.length).toBeGreaterThan(0);
      expect(example.typeGpuSourceUrl).toBe(
        officialExampleUrls[example.slug as keyof typeof officialExampleUrls]
      );
      expect(example.notes).toMatch(/\S/);
      expect(example.code).toContain('<scene');
      expect(example.code).not.toContain('<resources>');
      expect(example.code).not.toContain('<instancedMesh');
      expect(example.code).not.toMatch(/\sgeometry="[^"]+"/);
      expect(example.code).not.toMatch(/\smaterial="[^"]+"/);
      expect(example.code).not.toContain('layoutKey=');
      expect(example.sourceFiles.length).toBe(example.sourceStats.svelteFileCount);
      expect(example.sourceFiles[0]?.filename).toMatch(/\.(svelte|ts)$/);
      expect(example.sourceFiles.some(file => file.source.includes('<scene'))).toBe(true);
      expect(example.sourceFiles[0]?.highlightedCode.flat().some((token) => token.color)).toBe(
        true
      );
      expect(example.sourceStats.svelteLoc).toBeGreaterThan(0);
      if (example.typeGpuSourceUrl) {
        expect(example.sourceStats.typeGpuLoc).toBeGreaterThan(0);
      } else {
        expect(example.sourceStats.typeGpuLoc).toBe(0);
      }
      expect(example.sourceStats.deltaLoc).toBe(
        example.sourceStats.svelteLoc - example.sourceStats.typeGpuLoc
      );
      expect(example.highlightedCode.flat().some((token) => token.color)).toBe(true);
      expect(example.highlightedCode.flat().map((token) => token.content).join('')).toContain(
        '<scene'
      );
    }
  });

  it('publishes a self-contained scene with direct primitive event handlers', () => {
    const example = getExampleBySlug('native-events');
    expect(example.category).toBe('interaction');
    expect(example.sourceFiles.map((file) => file.filename)).toEqual([
      'NativeEvents.typegpu.svelte'
    ]);
    for (const event of [
      'onclick', 'onpointerover', 'onpointerout', 'ondblclick', 'oncontextmenu', 'onwheel'
    ]) {
      expect(example.code).toContain(event);
    }
    expect(example.code).toContain('let objects = $state(');
    expect(example.code).toContain('<canvas');
    expect(example.code).toContain('onkeydown=');
    expect(example.code).not.toContain('canvasProps');
    expect(example.code).not.toContain('sceneProps');
    expect(example.code).not.toContain('requestAnimationFrame');
  });

  it('publishes shared stores with native DOM bindings and a dedicated viewport', () => {
    const example = getExampleBySlug('shared-stores');
    expect(example.sourceFiles.map(file => file.filename)).toEqual([
      'SharedStores.svelte', 'StoreViewport.typegpu.svelte'
    ]);
    expect(example.sourceFiles[0].source).toContain('const position = writable<Vector3Tuple>');
    expect(example.sourceFiles[0].source).toContain('bind:value={$position[0]}');
    expect(example.sourceFiles[1].source).toContain('position={$position}');
    expect(example.sourceFiles[1].source).toContain('onclick={() => $selected = !$selected}');
    expect(example.code).not.toContain('requestAnimationFrame');
    expect(example.code).not.toContain('sceneProps');
  });

  it('publishes reactive collections with per-key reads and direct selection events', () => {
    const example = getExampleBySlug('reactive-collections');
    expect(example.sourceFiles.map(file => file.filename)).toEqual([
      'ReactiveCollections.svelte', 'CollectionViewport.typegpu.svelte', 'collection.ts'
    ]);
    expect(example.sourceFiles[0].source).toContain('createCollection()');
    expect(example.sourceFiles[1].source).toContain('{#each objects.keys() as id (id)}');
    expect(example.sourceFiles[1].source).toContain('objects.get(id)');
    expect(example.sourceFiles[1].source).toContain('onclick={() => selected.has(id) ? selected.delete(id) : selected.add(id)}');
    expect(example.sourceFiles[2].source).toContain('new SvelteMap');
    expect(example.sourceFiles[2].source).toContain('new SvelteSet');
    expect(example.code).not.toContain('requestAnimationFrame');
    expect(example.code).not.toContain('sceneProps');
  });

  it('includes the Disco shader-pass example built from renderer primitives', () => {
    const example = getExampleBySlug('disco-shader-pass');
    const disco = sourceBundleForSlug('disco-shader-pass');

    expect(example.category).toBe('rendering');
    expect(example.tags).toEqual(expect.arrayContaining(['animation', 'shader', 'fullscreen']));
    expect(example.code).toContain('<shaderPass');
    expect(example.code).toContain('fragments[discoControls.pattern]');
    expect(example.code).toContain("uniforms={{ time: 'time', resolution: 'resolution' }}");
    expect(example.code).toContain('discoFragment');
    expect(example.code).not.toContain('active={discoControls.pattern');
    expect(example.code).not.toContain('<instancedMesh');
    expect(disco).toContain('const aspectCorrected');
    expect(disco).toContain('const palette');
    expect(disco).toContain('const accumulate');
    expect(disco).toContain('fract(aspectUv * (1.3 * sin(time))) - 0.5');
    expect(disco).toContain('let mirroredUv');
    expect(disco).toContain('let swirl = sin(radius * 10.0 - time * (1.2 + iterationF32 * 0.2))');
    expect(disco).not.toContain('function createDiscoFragment');
  });

  it('mirrors the official examples through declarative renderer features', () => {
    const twoBoxes = sourceBundleForSlug('two-boxes');
    const phong = sourceBundleForSlug('phong-reflection');
    const simpleShadow = sourceBundleForSlug('simple-shadow');
    const disco = sourceBundleForSlug('disco-shader-pass');
    const smokyTriangle = sourceBundleForSlug('smoky-triangle');
    const gravity = sourceBundleForSlug('gravity');

    expect(twoBoxes).toContain('<bufferGeometry');
    expect(twoBoxes).toContain('<group quaternion={boxRotation}>');
    expect(twoBoxes).toContain('<Floor />');
    expect(exampleCode['two-boxes']).toContain('// File: Floor.typegpu.svelte');
    expect(twoBoxes).not.toContain('layoutKey=');
    expect(twoBoxes).toContain('drag="rotate"');
    expect(twoBoxes).toContain('ondragmove=');
    expect(twoBoxes).toContain('rotateBothBoxes');

    expect(phong).toContain('<model');
    expect(phong).toContain("'/assets/phong/teapot.obj'");
    expect(phong).toContain('{#await request}');
    expect(phong).toContain('{:then asset}');
    expect(phong).toContain('getAbortSignal()');
    expect(phong).toContain('{:catch error}');

    expect(simpleShadow).toContain('castShadow');
    expect(simpleShadow).toContain('receiveShadow');
    expect(simpleShadow).toContain('shadowMapSize={simpleShadowControls.shadowMapSize}');
    expect(simpleShadow).toContain('shadowBias={TYPEGPU_SHADOW_DEPTH_BIAS}');
    expect(simpleShadow).toContain('shadowSlopeBias={TYPEGPU_SHADOW_SLOPE_BIAS}');

    expect(disco).toContain('<shaderPass');
    expect(disco).toContain('fragments[discoControls.pattern]');
    expect(disco).toContain("uniforms={{ time: 'time', resolution: 'resolution' }}");

    expect(smokyTriangle).toContain('<shaderPass');
    expect(smokyTriangle).toContain('smokyTriangleFragment');
    expect(smokyTriangle).toContain('shaderPassBindGroupLayout');
    expect(smokyTriangle).toContain('triangleMask');

    expect(gravity).toContain('{#each bodies as body (body.id)}');
    expect(gravity).toContain('<sphereGeometry');
    expect(gravity).toContain('<phongMaterial');
    expect(gravity).toContain('stepGravity');
  });

  it('includes the multiple smoky triangles lattice example', () => {
    const example = getExampleBySlug('multiple-smoky-triangles');
    const source = sourceBundleForSlug('multiple-smoky-triangles');

    expect(example.title).toBe('Multiple Smoky Triangles');
    expect(example.category).toBe('rendering');
    expect(example.tags).toEqual(expect.arrayContaining(['shader', 'noise', 'pattern']));
    expect(source).toContain('{#each triangles as triangle (triangle.id)}');
    expect(source).toContain('<Triangle');
    expect(source).toContain('randomColorForTriangle');
    expect(source).toContain('hashTriangleSeed');
    expect(source).toContain('smoky: firstTriangleIndex % 2 === 1');
    expect(source).toContain('<shaderMaterial');
    expect(source).toContain('smokyTriangleMaterialFragment');
    expect(source).toContain('<basicMaterial color={[1, 1, 1, 1]}');
    expect(source).toContain('triangleVertices');
    expect(example.typeGpuSourceUrl).toBeUndefined();
    expect(example.sourceStats.typeGpuLoc).toBe(0);
    expect(source).not.toContain('<instancedMesh');
    expect(source).not.toContain('<shaderPass');
  });

  it('keeps typegpu example components declarative', () => {
    const forbiddenRawOrchestration = [
      /\btgpu\.init\b/,
      /\bcreateRoot\b/,
      /\bcreateRenderPipeline\b/,
      /\bcreateCommandEncoder\b/,
      /\bbeginRenderPass\b/,
      /\bcommandEncoder\b/,
      /\bpassEncoder\b/,
      /\bdevice\.create/
    ];

    for (const definition of exampleDefinitions) {
      const sourceFiles = definition.sourceFiles.map((sourceUrl) => ({
        filename: fileURLToPath(sourceUrl).split('/').at(-1) ?? '',
        source: readFileSync(sourceUrl, 'utf8')
      }));

      for (const { source } of sourceFiles) {
        for (const pattern of forbiddenRawOrchestration) {
          expect(source).not.toMatch(pattern);
        }
      }

      if (definition.slug === 'disco-shader-pass') {
        const shaderHelper = sourceFiles.find((sourceFile) =>
          sourceFile.filename.endsWith('disco-fragment.ts')
        );

        expect(shaderHelper?.source).toMatch(/tgpu\s*\.\s*fragmentFn/);
      }
    }
  });

  it('retains portable TypeScript declarations for generated example helpers', () => {
    for (const definition of exampleDefinitions) {
      for (const source of definition.sourceFiles.filter(url => url.pathname.endsWith('.ts'))) {
        const filename = source.pathname.split('/').at(-1)!.replace(/\.ts$/, '.d.ts');
        const declaration = new URL(`../generated/typegpu-scenes/${definition.slug}/${filename}`, import.meta.url);
        const text = readFileSync(declaration, 'utf8');
        const specifier = text.match(/export \* from "([^"]+)"/)![1];
        expect(specifier.startsWith('../')).toBe(true);
        expect(new URL(`${specifier}.ts`, declaration).href).toBe(source.href);
      }
    }
  });

  it('ships the teapot OBJ asset used by the Phong example', () => {
    const assetSource = readFileSync(
      new URL('../../public/assets/phong/teapot.obj', import.meta.url),
      'utf8'
    );

    expect(assetSource).toContain('v ');
    expect(assetSource).toContain('f ');
    expect(assetSource.split(/\r?\n/).length).toBeGreaterThan(1000);
  });

  it('falls back to the first example for unknown slugs', () => {
    expect(getExampleBySlug('unknown').slug).toBe('two-boxes');
  });

  it('points every definition at a real entry component with a typegpu scene in its source bundle', () => {
    for (const definition of exampleDefinitions) {
      const source = readFileSync(definition.sourceUrl, 'utf8');

      expect(source).toContain('<');
      const bundle = sourceBundleForSlug(definition.slug);
      expect(bundle).toContain('<scene');
      expect(bundle).toContain('<perspectiveCamera');
      expect(definition.sourceFiles[0]?.toString()).toBe(definition.sourceUrl.toString());
      expect(definition.sourceFiles.length).toBeGreaterThan(0);
      expect(definition.typeGpuSourceFiles.every((file) => file.loc > 0)).toBe(true);
    }
  });

  it('keeps generated source samples current with every component file', () => {
    for (const definition of exampleDefinitions) {
      const componentSources = definition.sourceFiles.map((sourceUrl) =>
        readFileSync(sourceUrl, 'utf8')
      );
      const expectedSvelteLoc = componentSources.reduce(
        (total, source) => total + countSourceLines(source),
        0
      );
      const expectedTypeGpuLoc = definition.typeGpuSourceFiles.reduce(
        (total, sourceFile) => total + sourceFile.loc,
        0
      );

      for (const source of componentSources) {
        expect(exampleCode[definition.slug]).toContain(source.trim());
      }

      for (const sourceUrl of definition.sourceFiles) {
        const filename = fileURLToPath(sourceUrl).split('/').at(-1);

        expect(exampleCode[definition.slug]).toContain(
          `// File: ${filename}`
        );
        expect(exampleSourceFiles[definition.slug]).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              filename,
              source: readFileSync(sourceUrl, 'utf8'),
              loc: countSourceLines(readFileSync(sourceUrl, 'utf8'))
            })
          ])
        );
      }

      expect(exampleSourceStats[definition.slug]).toEqual({
        svelteFileCount: definition.sourceFiles.length,
        svelteLoc: expectedSvelteLoc,
        typeGpuFileCount: definition.typeGpuSourceFiles.length,
        typeGpuLoc: expectedTypeGpuLoc,
        deltaLoc: expectedSvelteLoc - expectedTypeGpuLoc
      });
      expect(highlightedExampleCode[definition.slug].flat().some((token) => token.color)).toBe(
        true
      );
    }
  });

  it('keeps generated files portable across checkout locations', () => {
    const generatedRoot = new URL('../generated/', import.meta.url);
    const absolutePathPattern = /(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|\b[A-Za-z]:\\)/;
    expect(JSON.stringify('default:\n  return;')).not.toMatch(absolutePathPattern);
    expect(String.raw`C:\workspace\scene.ts`).toMatch(absolutePathPattern);

    for (const fileUrl of generatedFiles(generatedRoot)) {
      const source = readFileSync(fileUrl, 'utf8');

      expect(source.match(absolutePathPattern), fileURLToPath(fileUrl)).toBeNull();
    }
  });

  it('declares every compiled GPU component, including children imported by DOM wrappers', () => {
    for (const definition of exampleDefinitions) {
      for (const sourceUrl of definition.sourceFiles) {
        const name = fileURLToPath(sourceUrl).split('/').at(-1)!;
        if (!name.endsWith('.typegpu.svelte')) continue;
        const declaration = readFileSync(new URL(
          `../generated/typegpu-scenes/${definition.slug}/${name.replace(/\.svelte$/, '.d.ts')}`,
          import.meta.url
        ), 'utf8');
        expect(declaration).toContain("import type { Component } from 'svelte'");
        expect(declaration).toContain('export default component;');
      }
    }
  });
});

function countSourceLines(source: string): number {
  return source.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function sourceBundleForSlug(slug: string): string {
  const definition = exampleDefinitions.find((candidate) => candidate.slug === slug);

  if (!definition) {
    throw new Error(`Unknown example definition: ${slug}`);
  }

  return definition.sourceFiles.map((sourceUrl) => readFileSync(sourceUrl, 'utf8')).join('\n');
}

function generatedFiles(directory: URL): URL[] {
  const files: URL[] = [];

  for (const entry of readdirSync(directory)) {
    const entryUrl = new URL(entry, directory);
    const stats = statSync(entryUrl);

    if (stats.isDirectory()) {
      files.push(...generatedFiles(new URL(`${entry}/`, directory)));
    } else {
      files.push(entryUrl);
    }
  }

  return files;
}
