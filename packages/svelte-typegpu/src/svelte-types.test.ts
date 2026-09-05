import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { typeGpuRendererPath } from './test-paths';

const require = createRequire(import.meta.url);
const checker = join(dirname(require.resolve('svelte-check/package.json')), 'bin/svelte-check');
const workspace = dirname(dirname(typeGpuRendererPath));

interface Diagnostic {
  type: 'ERROR' | 'WARNING';
  filename: string;
  start: { line: number; character: number };
  code?: number | string;
  message: string;
}

function check(config: string) {
  const result = spawnSync(
    process.execPath,
    [checker, '--tsconfig', `type-tests/${config}`, '--output', 'machine-verbose'],
    { cwd: workspace, encoding: 'utf8', timeout: 60_000 }
  );
  if (result.error) throw result.error;
  expect(result.signal, result.stderr).toBe(null);
  expect(result.stdout, result.stderr).toContain(' COMPLETED ');

  // The checker prefixes JSON diagnostic records with a timestamp; lifecycle
  // records (START/COMPLETED) have a separate, non-JSON format.
  const diagnostics: Diagnostic[] = result.stdout
    .split('\n')
    .map((line) => line.slice(line.indexOf(' ') + 1))
    .filter((record) => record.startsWith('{'))
    .map((record) => JSON.parse(record));
  return { status: result.status, diagnostics, output: result.stdout + result.stderr };
}

describe('Canvas public Svelte types', () => {
  it('accepts inferred scene props, callbacks, DOM attributes and root bindings', () => {
    const result = check('tsconfig.json');
    expect(result.diagnostics, result.output).toEqual([]);
    expect(result.status, result.output).toBe(0);
  });

  it('rejects invalid props and proves callback arguments are not any', () => {
    const result = check('tsconfig.invalid.json');
    expect(result.status, result.output).toBe(1);
    expect(
      result.diagnostics.map(({ type, filename, start, code }) => ({
        type,
        filename: filename.replaceAll('\\', '/'),
        line: start.line + 1,
        code
      })),
      result.output
    ).toEqual(
      [
        [7, 2741], // Missing required scene prop.
        [8, 2322], // Incorrect scene prop value.
        [9, 2353], // Unknown scene prop must not widen generic inference.
        [10, 2339], // Scene callback argument is a number.
        [11, 2339], // onready argument is a TypeGpuRoot.
        [12, 2339], // onfps argument is a number.
        [13, 18046], // onerror argument is unknown.
        [14, 2322], // Root binding rejects numbers.
        [15, 2353], // Canvas owns the canvas option.
        [16, 2353], // Canvas owns the target option.
        [17, 2353], // The live onfps callback replaces the onFps option.
        [18, 2353], // Initialization options are not host attributes.
        [19, 2353], // The renderer owns drawing-buffer width.
        [20, 2353], // The renderer owns drawing-buffer height.
        [21, 2353], // Canvas contents are not user-owned DOM children.
        [22, 2551], // Native keyboard event keys are strings, not any.
        [23, 2339] // Native canvas currentTarget is not an input element.
      ].map(([line, code]) => ({
        type: 'ERROR',
        filename: 'type-tests/invalid/Consumer.svelte',
        line,
        code
      }))
    );
  });
});

describe('released language-tools custom renderer compatibility', () => {
  it('tracks case rewriting and the unsafe generic action target fallback', () => {
    const result = check('renderer-compat/tsconfig.json');
    expect(result.status, result.output).toBe(1);
    expect(
      result.diagnostics.map(({ type, filename, start, code }) => ({
        type,
        filename: filename.replaceAll('\\', '/'),
        line: start.line + 1,
        code
      })),
      result.output
    ).toEqual([
      { type: 'ERROR', filename: 'type-tests/renderer-compat/Probe.svelte', line: 5, code: 2353 },
      { type: 'ERROR', filename: 'type-tests/renderer-compat/Probe.svelte', line: 8, code: 2339 }
    ]);
    expect(result.diagnostics[0].message).toContain('clearcolor');
    expect(result.diagnostics[1].message).toContain('TypeGpuNode');

    // This is a compatibility canary, not a support claim. When language-tools
    // fixes the casing/action gaps, revisit the deferred element declarations.
    // The actual preview compiler already preserves the attribute's casing.
    const source = readFileSync(join(workspace, 'type-tests/renderer-compat/Probe.svelte'), 'utf8');
    const compiled = compile(source, {
      filename: 'Probe.typegpu.svelte',
      generate: 'client',
      runes: true,
      experimental: { customRenderer: typeGpuRendererPath }
    });
    expect(compiled.warnings).toEqual([]);
    expect(compiled.js.code).toContain('clearColor');
    expect(compiled.js.code).not.toContain('clearcolor');
  });
});
