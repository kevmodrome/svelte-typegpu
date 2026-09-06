import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('keeps ESM and CommonJS compiler output and diagnostics identical', () => {
  const directory = fileURLToPath(new URL('../..', import.meta.url));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    import { resolve } from 'node:path';
    const directory = process.env.SVELTE_PROBE_DIR;
    const esm = await import(pathToFileURL(resolve(directory, 'src/compiler/index.js')));
    const cjs = createRequire(import.meta.url)(resolve(directory, 'compiler/index.js'));
    const original = createRequire(import.meta.url)('svelte/compiler');
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    const fixtures = [
      '<svelte:boundary><mesh />{#snippet failed(error)}<mesh name={error.message} />{/snippet}</svelte:boundary>',
      '<script>let { n } = $props();</script><svelte:boundary>{@const x = n * 2}' +
        '{#snippet failed(error)}<mesh name={x + error.message} />{/snippet}<mesh name={x} /></svelte:boundary>',
      '<svelte:boundary>{#snippet pending()}<mesh />{/snippet}{#snippet item(n)}<mesh name={n} />{/snippet}' +
        '{@render item(1)}</svelte:boundary>',
      '<svelte:boundary>{#snippet failed(error)}<mesh name={error.message} />{/snippet}' +
        '<svelte:boundary>{#snippet failed(error)}<mesh />{/snippet}<mesh /></svelte:boundary></svelte:boundary>',
      '{#snippet failed(error)}<mesh name={error.message} />{/snippet}<svelte:boundary {failed}><mesh /></svelte:boundary>',
      '<svelte:boundary unknown={true} />',
      '<svelte:boundary failed="invalid" />'
    ];
    function output(compiler, source, options) {
      try {
        const result = compiler.compile(source, options);
        return JSON.parse(JSON.stringify({ js: result.js, css: result.css, warnings: result.warnings, metadata: result.metadata }));
      } catch (error) {
        return { error: { name: error.name, code: error.code, message: error.message,
          filename: error.filename, position: error.position, frame: error.frame } };
      }
    }
    let comparisons = 0, successes = 0, expectedErrors = 0;
    for (const dev of [false, true]) for (const async of [false, true])
      for (const generate of ['client', 'server']) for (const customRenderer of [undefined, 'svelte-typegpu/svelte-renderer'])
        for (const [index, fixture] of fixtures.entries()) {
          const source = customRenderer ? fixture : fixture.replaceAll('mesh', 'div');
          const options = { filename: 'Parity.svelte', dev, generate, hmr: false, experimental: { async, customRenderer } };
          const a = output(esm, source, options), b = output(cjs, source, options);
          assert.deepEqual(b, a, JSON.stringify({ dev, async, generate, customRenderer, index }));
          if (!customRenderer) assert.deepEqual(b, output(original, source, options));
          if (index >= 5 || (index === 1 && async)) {
            assert.match(a.error?.code ?? '', /^(svelte_boundary_invalid_attribute(_value)?|const_tag_invalid_reference)$/);
            expectedErrors++;
          } else { assert(!a.error, JSON.stringify(a.error)); successes++; }
          comparisons++;
        }
    console.log(JSON.stringify({ comparisons, successes, expectedErrors }));
  `], { cwd: directory, env: process.env, encoding: 'utf8', timeout: 15000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ comparisons: 112, successes: 72, expectedErrors: 40 });
}, 20000);

it('refuses installed, mismatched and symlinked CommonJS compiler targets without writing them', () => {
  const directory = fileURLToPath(new URL('../..', import.meta.url));
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFile, realpath, mkdtemp, mkdir, cp, appendFile, rm, symlink } from 'node:fs/promises';
    import { dirname, join } from 'node:path';
    import { tmpdir } from 'node:os';
    import { fileURLToPath } from 'node:url';
    import { patchCommonJsCompiler } from './repros/boundary-snippets/patch-commonjs.mjs';
    const installed = dirname(await realpath(fileURLToPath(import.meta.resolve('svelte/package.json'))));
    const originalPath = join(installed, 'compiler/index.js');
    const original = await readFile(originalPath);
    await assert.rejects(() => patchCommonJsCompiler(installed), /Only a runner-owned temporary copy/);
    const temporary = await mkdtemp(join(tmpdir(), 'typegpu-svelte-probe-guard-'));
    try {
      const copy = join(temporary, 'svelte');
      const path = join(copy, 'compiler/index.js');
      await mkdir(dirname(path), { recursive: true });
      await cp(originalPath, path); await appendFile(path, '\\n');
      const mismatched = await readFile(path);
      await assert.rejects(() => patchCommonJsCompiler(copy), /Unrecognized Svelte compiler bundle/);
      assert.deepEqual(await readFile(path), mismatched);
      await rm(path); await symlink(originalPath, path);
      await assert.rejects(() => patchCommonJsCompiler(copy), /temporary compiler must not be a symlink/);
    } finally { await rm(temporary, { recursive: true, force: true }); }
    assert.deepEqual(await readFile(originalPath), original);
    console.log('guarded');
  `], { cwd: directory, env: process.env, encoding: 'utf8', timeout: 15000 });
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr || result.stdout).toBe(0);
  expect(result.stdout.trim()).toBe('guarded');
}, 20000);
