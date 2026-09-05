import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

it('records the pinned async-boundary teardown failure without enabling async in apps', () => {
  const directory = fileURLToPath(new URL('..', import.meta.url));
  const cli = fileURLToPath(new URL('./vitest.mjs', import.meta.resolve('vitest/package.json')));
  const result = spawnSync(
    process.execPath,
    [cli, 'run', '--config', 'repros/vitest.config.ts', '--reporter', './repros/error-reporter.ts'],
    { cwd: directory, env: process.env, encoding: 'utf8', timeout: 15000 }
  );
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(1);
  const report = JSON.parse(result.stdout);
  expect(report.tests).toHaveLength(2);
  expect(report.tests.map((test: { state: string }) => test.state)).toEqual(['passed', 'passed']);
  expect(report.errors).toHaveLength(2);
  for (const error of report.errors) {
    expect(error.name).toBe('TypeError');
    expect(error.message).toBe('ref_node.before is not a function');
    expect(error.stack).toContain('Boundary.#update_pending_count');
  }
}, 20000);
