import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
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
        [18, 2353] // Initialization options are not host attributes.
      ].map(([line, code]) => ({
        type: 'ERROR',
        filename: 'type-tests/invalid/Consumer.svelte',
        line,
        code
      }))
    );
  });
});
