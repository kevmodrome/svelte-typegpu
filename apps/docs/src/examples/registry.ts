import {
  exampleCode,
  exampleSourceFiles,
  type ExampleSourceFile,
  exampleSourceStats,
  type ExampleSourceStats,
  highlightedExampleCode,
  type HighlightedCodeLine
} from '../generated/code-samples';
import { exampleDefinitions, type ExampleSlug } from './example-definitions';

export interface DocsExample {
  slug: ExampleSlug;
  title: string;
  category: string;
  tags: readonly string[];
  description: string;
  typeGpuSourceUrl?: string;
  notes: string;
  code: string;
  sourceFiles: ExampleSourceFile[];
  sourceStats: ExampleSourceStats;
  highlightedCode: HighlightedCodeLine[];
}

export const examples = exampleDefinitions.map(
  ({ slug, title, category, tags, description, typeGpuSourceUrl, notes }) =>
    ({
      slug,
      title,
      category,
      tags,
      description,
      typeGpuSourceUrl,
      notes,
      code: exampleCode[slug],
      sourceFiles: exampleSourceFiles[slug],
      sourceStats: exampleSourceStats[slug],
      highlightedCode: highlightedExampleCode[slug]
    }) satisfies DocsExample
);

export function getExampleBySlug(slug: string): DocsExample {
  const fallback = examples[0];
  if (!fallback) {
    throw new Error('Docs example registry is empty.');
  }

  return examples.find((example) => example.slug === slug) ?? fallback;
}
