<script lang="ts">
  import type {
    ExampleSourceFile,
    HighlightedCodeLine,
    HighlightedCodeToken
  } from '../generated/code-samples';

  interface CodePanelProps {
    title?: string;
    files?: ExampleSourceFile[];
    filename?: string;
    code?: string;
  }

  let { title, files = [], filename, code }: CodePanelProps = $props();

  const panelFiles = $derived(normalizeFiles(files, filename, code));
  const panelTitle = $derived(title ?? filename ?? 'source');
  const headerTitle = $derived(
    panelFiles.length === 1 ? (panelFiles[0]?.filename ?? panelTitle) : panelTitle
  );

  function tokenStyle(token: HighlightedCodeToken): string {
    const styles = [`color: ${token.color ?? 'var(--text)'}`];
    const fontStyle = token.fontStyle ?? 0;

    if ((fontStyle & 1) === 1) styles.push('font-style: italic');
    if ((fontStyle & 2) === 2) styles.push('font-weight: 700');
    if ((fontStyle & 4) === 4) styles.push('text-decoration: underline');

    return styles.join('; ');
  }

  function normalizeFiles(
    sourceFiles: ExampleSourceFile[],
    singleFilename?: string,
    singleCode?: string
  ): ExampleSourceFile[] {
    if (sourceFiles.length > 0) {
      return sourceFiles;
    }

    if (!singleFilename || singleCode === undefined) {
      return [];
    }

    return [
      {
        filename: singleFilename,
        source: singleCode,
        loc: countSourceLines(singleCode),
        highlightedCode: codeToHighlightedLines(singleCode)
      }
    ];
  }

  function countSourceLines(source: string): number {
    return source.split(/\r?\n/).filter((line) => line.trim().length > 0).length;
  }

  function codeToHighlightedLines(source: string): HighlightedCodeLine[] {
    return source
      .split(/\r?\n/)
      .map((line) => (line.length > 0 ? [{ content: line }] : []));
  }

  function sourcePanelId(file: ExampleSourceFile, index: number): string {
    return `source-${slugify(panelTitle)}-${index + 1}-${slugify(file.filename)}`;
  }

  function slugify(value: string): string {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'file';
  }
</script>

<section class="code-panel" aria-label={`Source for ${panelTitle}`}>
  <header>
    <span>{headerTitle}</span>
    <span>Svelte custom renderer</span>
  </header>
  {#if panelFiles.length > 1}
    <nav class="code-tabs" aria-label={`${panelTitle} source files`}>
      {#each panelFiles as file, index (file.filename)}
        <a href={`#${sourcePanelId(file, index)}`}>
          <span>{file.filename}</span>
          <small>{file.loc} LoC</small>
        </a>
      {/each}
    </nav>
  {/if}
  <div class="source-panels">
    {#each panelFiles as file, index (file.filename)}
      <section
        class="source-panel"
        id={sourcePanelId(file, index)}
        aria-label={file.filename}
        tabindex="-1"
      >
        <div class="code-scroll">
          <pre><code>{#each file.highlightedCode as line, lineIndex (lineIndex)}<span class="code-line"><span class="line-number" aria-hidden="true">{lineIndex + 1}</span><span class="line-source">{#each line as token, tokenIndex (tokenIndex)}<span style={tokenStyle(token)}>{token.content}</span>{/each}</span></span>{/each}</code></pre>
        </div>
      </section>
    {/each}
  </div>
</section>
