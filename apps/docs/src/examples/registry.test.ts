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

describe('docs example registry', () => {
  it('contains the curated TypeGPU adaptations in display order', () => {
    expect(examples.map((example) => example.slug)).toEqual([
      'two-boxes',
      'phong-reflection',
      'simple-shadow',
      'interactive-orbit-field'
    ]);
  });

  it('keeps metadata complete for every example', () => {
    for (const example of examples) {
      expect(example.title).toMatch(/\S/);
      expect(example.description).toMatch(/\S/);
      expect(example.category).toMatch(/\S/);
      expect(example.tags.length).toBeGreaterThan(0);
      expect(example.typeGpuSourceUrl).toMatch(
        /^https:\/\/github\.com\/software-mansion\/TypeGPU/
      );
      expect(example.notes).toMatch(/adapted/i);
      expect(example.code).toContain('<scene');
      expect(example.sourceFiles.length).toBe(example.sourceStats.svelteFileCount);
      expect(example.sourceFiles[0]?.filename).toMatch(/\.(svelte|ts)$/);
      expect(example.sourceFiles[0]?.source).toContain('<scene');
      expect(example.sourceFiles[0]?.highlightedCode.flat().some((token) => token.color)).toBe(
        true
      );
      expect(example.sourceStats.svelteLoc).toBeGreaterThan(0);
      expect(example.sourceStats.typeGpuLoc).toBeGreaterThan(0);
      expect(example.sourceStats.deltaLoc).toBe(
        example.sourceStats.svelteLoc - example.sourceStats.typeGpuLoc
      );
      expect(example.highlightedCode.flat().some((token) => token.color)).toBe(true);
      expect(example.highlightedCode.flat().map((token) => token.content).join('')).toContain(
        '<scene'
      );
    }
  });

  it('includes the Disco shader-pass example built from renderer primitives', () => {
    const example = getExampleBySlug('interactive-orbit-field');

    expect(example.category).toBe('rendering');
    expect(example.tags).toEqual(expect.arrayContaining(['animation', 'shader', 'fullscreen']));
    expect(example.code).toContain('<shaderPass');
    expect(example.code).toContain("uniforms={{ time: 'time', resolution: 'resolution' }}");
    expect(example.code).toContain('discoFragment');
    expect(example.code).not.toContain('<instancedMesh');
  });

  it('mirrors the official examples through declarative renderer features', () => {
    const twoBoxes = sourceBundleForSlug('two-boxes');
    const phong = sourceBundleForSlug('phong-reflection');
    const simpleShadow = sourceBundleForSlug('simple-shadow');
    const disco = sourceBundleForSlug('interactive-orbit-field');

    expect(twoBoxes).toContain('<bufferGeometry');
    expect(twoBoxes).toContain('layoutKey="position:normal:uv:color"');
    expect(twoBoxes).toContain('drag="rotate"');
    expect(twoBoxes).toContain('ondragmove=');
    expect(twoBoxes).toContain('rotateBothBoxes');

    expect(phong).toContain('<model');
    expect(phong).toContain('src="/assets/phong/teapot.obj"');

    expect(simpleShadow).toContain('castShadow');
    expect(simpleShadow).toContain('receiveShadow');
    expect(simpleShadow).toContain('shadowMapSize={2048}');
    expect(simpleShadow).toContain('shadowBias={1}');
    expect(simpleShadow).toContain('shadowSlopeBias={4}');

    expect(disco).toContain('<shaderPass');
    expect(disco).toContain('fragment={discoFragment}');
    expect(disco).toContain("uniforms={{ time: 'time', resolution: 'resolution' }}");
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
      const svelteSources = definition.sourceFiles
        .filter((sourceUrl) => fileURLToPath(sourceUrl).endsWith('.svelte'))
        .map((sourceUrl) => readFileSync(sourceUrl, 'utf8'));

      for (const source of svelteSources) {
        for (const pattern of forbiddenRawOrchestration) {
          expect(source).not.toMatch(pattern);
        }
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

  it('points every definition at a real typegpu scene source', () => {
    for (const definition of exampleDefinitions) {
      const source = readFileSync(definition.sourceUrl, 'utf8');

      expect(source).toContain('<scene');
      expect(source).toContain('<perspectiveCamera');
      expect(definition.sourceFiles[0]?.toString()).toBe(definition.sourceUrl.toString());
      expect(definition.sourceFiles.length).toBeGreaterThan(1);
      expect(definition.typeGpuSourceFiles.length).toBeGreaterThan(0);
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
    const absolutePathPattern = /(?:\/Users\/|\/home\/|\/tmp\/|\/private\/|[A-Za-z]:\\)/;

    for (const fileUrl of generatedFiles(generatedRoot)) {
      const source = readFileSync(fileUrl, 'utf8');

      expect(source).not.toMatch(absolutePathPattern);
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
