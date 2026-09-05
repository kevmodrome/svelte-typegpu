import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeToTokens } from 'shiki';
import { compile } from 'svelte/compiler';
import { compileTypeGpu } from 'svelte-typegpu/compiler';
import ts from 'typescript';

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(scriptRoot, '..');
const generatedRoot = path.join(appRoot, 'src/generated');
const sceneOutDir = path.join(generatedRoot, 'typegpu-scenes');
const rendererPath = resolveRendererPath();
const { exampleDefinitions } = await import(
  new URL('../src/examples/example-definitions.ts', import.meta.url).href
);
const { exampleSourceTexts } = await import(
  new URL('./example-source-texts.ts', import.meta.url).href
);
const { docSnippetDefinitions } = await import(
  new URL('../src/snippets/doc-snippets.ts', import.meta.url).href
);

rmSync(sceneOutDir, { recursive: true, force: true });
mkdirSync(sceneOutDir, { recursive: true });

const codeEntries: string[] = [];
const highlightedCodeEntries: string[] = [];
const sourceFileEntries: string[] = [];
const sourceStatsEntries: string[] = [];
const sceneExports: string[] = [];

for (const definition of exampleDefinitions) {
  const sourcePath = fileURLToPath(definition.sourceUrl);
  const sourceFiles = definition.sourceFiles.map((sourceUrl, index) => ({
    label: sourceFileLabel(sourceUrl),
    path: fileURLToPath(sourceUrl),
    source: sourceTextFor(definition.slug, index)
  }));
  const sceneDirectory = path.join(sceneOutDir, definition.slug);

  mkdirSync(sceneDirectory, { recursive: true });

  const displaySource = formatSourceBundle(sourceFiles);
  const svelteLoc = sourceFiles.reduce((total, file) => total + countSourceLines(file.source), 0);
  const typeGpuLoc = definition.typeGpuSourceFiles.reduce(
    (total, file) => total + file.loc,
    0
  );

  for (const sourceFile of sourceFiles) {
    writeGeneratedSourceFile(sourceFile, sceneDirectory, sourceFiles);
  }

  const entryModuleName = generatedModuleName(sourcePath);
  const dtsPath = path.join(sceneDirectory, entryModuleName.replace(/\.js$/, '.d.ts'));

  writeFileSync(dtsPath, sceneDeclaration(sourcePath));

  codeEntries.push(`  ${JSON.stringify(definition.slug)}: ${JSON.stringify(displaySource)}`);
  sourceFileEntries.push(
    [
      `  ${JSON.stringify(definition.slug)}: [`,
      (
        await Promise.all(
          sourceFiles.map(async (sourceFile) => {
            const highlightedCode = await highlightSource(
              sourceFile.source,
              sourceFile.label.endsWith('.ts') ? 'ts' : 'svelte'
            );

            return [
              '    {',
              `      filename: ${JSON.stringify(sourceFile.label)},`,
              `      source: ${JSON.stringify(sourceFile.source)},`,
              `      loc: ${countSourceLines(sourceFile.source)},`,
              `      highlightedCode: ${JSON.stringify(highlightedCode)}`,
              '    }'
            ].join('\n');
          })
        )
      ).join(',\n'),
      '  ]'
    ].join('\n')
  );
  sourceStatsEntries.push(
    [
      `  ${JSON.stringify(definition.slug)}: {`,
      `    svelteFileCount: ${sourceFiles.length},`,
      `    svelteLoc: ${svelteLoc},`,
      `    typeGpuFileCount: ${definition.typeGpuSourceFiles.length},`,
      `    typeGpuLoc: ${typeGpuLoc},`,
      `    deltaLoc: ${svelteLoc - typeGpuLoc}`,
      '  }'
    ].join('\n')
  );
  const highlightedTokens = await highlightSource(displaySource, 'svelte');

  highlightedCodeEntries.push(
    `  ${JSON.stringify(definition.slug)}: ${JSON.stringify(highlightedTokens)}`
  );
  sceneExports.push(
    `export { default as ${definition.exportName} } from './${definition.slug}/${entryModuleName}';`
  );
}

writeFileSync(
  path.join(generatedRoot, 'code-samples.ts'),
  [
    header('example scene sources'),
    "import type { ExampleSlug } from '../examples/example-definitions';",
    '',
    'export interface HighlightedCodeToken {',
    '  content: string;',
    '  color?: string;',
    '  fontStyle?: number;',
    '}',
    '',
    'export type HighlightedCodeLine = HighlightedCodeToken[];',
    '',
    'export interface ExampleSourceStats {',
    '  svelteFileCount: number;',
    '  svelteLoc: number;',
    '  typeGpuFileCount: number;',
    '  typeGpuLoc: number;',
    '  deltaLoc: number;',
    '}',
    '',
    'export interface ExampleSourceFile {',
    '  filename: string;',
    '  source: string;',
    '  loc: number;',
    '  highlightedCode: HighlightedCodeLine[];',
    '}',
    '',
    'export const exampleCode = {',
    codeEntries.join(',\n'),
    '} satisfies Record<ExampleSlug, string>;',
    '',
    'export const exampleSourceStats = {',
    sourceStatsEntries.join(',\n'),
    '} satisfies Record<ExampleSlug, ExampleSourceStats>;',
    '',
    'export const exampleSourceFiles = {',
    sourceFileEntries.join(',\n'),
    '} satisfies Record<ExampleSlug, ExampleSourceFile[]>;',
    '',
    'export const highlightedExampleCode = {',
    highlightedCodeEntries.join(',\n'),
    '} satisfies Record<ExampleSlug, HighlightedCodeLine[]>;',
    ''
  ].join('\n')
);

writeFileSync(path.join(sceneOutDir, 'index.ts'), [header('compiled typegpu scenes'), ...sceneExports, ''].join('\n'));
await writeDocSnippetSamples();

function sourceTextFor(slug: string, index: number): string {
  const source = exampleSourceTexts[slug as keyof typeof exampleSourceTexts]?.[index];

  if (typeof source !== 'string') {
    throw new Error(`Missing imported source text for ${slug} source file ${index}`);
  }

  return source;
}

function writeGeneratedSourceFile(
  sourceFile: { label: string; path: string; source: string },
  sceneDirectory: string,
  sourceFiles: { label: string; path: string; source: string }[]
): void {
  const outPath = path.join(sceneDirectory, generatedModuleName(sourceFile.path));

  if (sourceFile.label.endsWith('.svelte')) {
    const custom = sourceFile.label.endsWith('.typegpu.svelte');
    const compiled = (custom ? compileTypeGpu : compile)(sourceFile.source, {
      filename: sourceFile.path,
      generate: 'client',
      runes: true,
      experimental: custom ? { customRenderer: rendererPath } : undefined
    });
    const diagnostics = compiled.warnings.filter((warning) => warning.code.startsWith('typegpu_'));
    if (diagnostics.length) {
      throw new Error(diagnostics.map((warning) =>
        `${sourceFile.path}:${warning.start?.line ?? 1} [${warning.code}] ${warning.message}\n${warning.frame ?? ''}`
      ).join('\n\n'));
    }
    if (compiled.css?.code) {
      writeFileSync(outPath.replace(/\.js$/, '.css'), compiled.css.code);
    }
    const portableCode = rewriteGeneratedImports(
      compiled.js.code.replaceAll(rendererPath, 'svelte-typegpu/svelte-renderer'),
      sourceFiles
    );

    const cssImport = compiled.css?.code ? `import './${path.basename(outPath).replace(/\.js$/, '.css')}';\n` : '';
    writeFileSync(outPath, `${header(sourceFile.path)}\n${cssImport}${portableCode}`);
    if (!custom) {
      writeFileSync(outPath.replace(/\.js$/, '.d.ts'), sceneDeclaration(sourceFile.path));
    }
    return;
  }

  if (sourceFile.label.endsWith('.ts')) {
    const transpiled = ts.transpileModule(sourceFile.source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
        verbatimModuleSyntax: true
      }
    });

    writeFileSync(outPath, `${header(sourceFile.path)}\n${transpiled.outputText}`);
    return;
  }

  throw new Error(`Unsupported source file type: ${sourceFile.label}`);
}

function rewriteGeneratedImports(
  code: string,
  sourceFiles: { label: string; path: string; source: string }[]
): string {
  let rewritten = code;

  for (const sourceFile of sourceFiles) {
    const sourceBaseName = path.basename(sourceFile.path);
    const generatedName = generatedModuleName(sourceFile.path);
    const importSpecifiers =
      path.extname(sourceBaseName) === '.ts'
        ? [`./${sourceBaseName}`, `./${sourceBaseName.replace(/\.ts$/, '')}`]
        : [`./${sourceBaseName}`];

    for (const specifier of importSpecifiers) {
      rewritten = rewritten
        .replaceAll(`'${specifier}'`, `'./${generatedName}'`)
        .replaceAll(`"${specifier}"`, `"./${generatedName}"`);
    }
  }

  return rewritten;
}

function generatedModuleName(sourcePath: string): string {
  return path
    .basename(sourcePath)
    .replace(/\.svelte$/, '.js')
    .replace(/\.ts$/, '.js');
}

function sceneDeclaration(sourcePath: string): string {
  return [
    header(sourcePath),
    "import type { Component } from 'svelte';",
    '',
    'type TypeGpuSceneComponent = Component<any>;',
    '',
    'declare const component: TypeGpuSceneComponent;',
    'export default component;',
    ''
  ].join('\n');
}

function formatSourceBundle(files: { label: string; source: string }[]): string {
  return files
    .map(({ label, source }) => [`// File: ${label}`, source.trimEnd()].join('\n'))
    .join('\n\n');
}

async function writeDocSnippetSamples(): Promise<void> {
  const docSnippetFiles = await Promise.all(
    docSnippetDefinitions.map(async (snippet) => {
      const highlightedCode = await highlightSource(snippet.code, snippet.lang);

      return [
        `  ${snippet.id}: [`,
        '    {',
        `      filename: ${JSON.stringify(snippet.filename)},`,
        `      source: ${JSON.stringify(snippet.code)},`,
        `      loc: ${countSourceLines(snippet.code)},`,
        `      highlightedCode: ${JSON.stringify(highlightedCode)}`,
        '    }',
        '  ]'
      ].join('\n');
    })
  );

  writeFileSync(
    path.join(generatedRoot, 'doc-snippets.ts'),
    [
      header('documentation snippets'),
      "import type { DocSnippetId } from '../snippets/doc-snippets';",
      "import type { ExampleSourceFile } from './code-samples';",
      '',
      'export const docSnippetFiles = {',
      docSnippetFiles.join(',\n'),
      '} satisfies Record<DocSnippetId, ExampleSourceFile[]>;',
      ''
    ].join('\n')
  );
}

async function highlightSource(source: string, lang: 'bash' | 'svelte' | 'ts') {
  const { tokens } = await codeToTokens(source, {
    lang,
    theme: 'vesper'
  });

  return tokens.map((line) =>
    line.map(({ content, color, fontStyle }) => ({
      content,
      ...(color ? { color } : {}),
      ...(fontStyle ? { fontStyle } : {})
    }))
  );
}

function countSourceLines(source: string): number {
  return source.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
}

function sourceFileLabel(sourceUrl: URL): string {
  return path.basename(fileURLToPath(sourceUrl));
}

function header(sourcePath: string): string {
  const sourceLabel = path.isAbsolute(sourcePath) ? path.relative(appRoot, sourcePath) : sourcePath;

  return [
    '// This file is generated by scripts/compile-typegpu-scenes.ts.',
    `// Source: ${sourceLabel}`,
    '// Do not edit this file directly.'
  ].join('\n');
}

function resolveRendererPath(): string {
  if (typeof import.meta.resolve === 'function') {
    return fileURLToPath(import.meta.resolve('svelte-typegpu/svelte-renderer'));
  }

  return path.join(appRoot, 'node_modules/svelte-typegpu/src/svelte-renderer.ts');
}
