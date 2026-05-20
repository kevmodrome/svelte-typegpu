import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const target = '.svelte-pr';
const repo = 'https://github.com/sveltejs/svelte.git';
const branch = 'svelte-custom-renderer';
const expectedCommit = '078a77c9ad367d7836b6f59125fb15c94cf2880d';

function git(args, options = {}) {
  execFileSync('git', args, { stdio: 'inherit', ...options });
}

if (!existsSync(target)) {
  git(['clone', '--depth=1', '--branch', branch, repo, target]);
} else {
  git(['fetch', '--depth=1', 'origin', branch], { cwd: target });
  git(['checkout', branch], { cwd: target });
  git(['reset', '--hard', `origin/${branch}`], { cwd: target });
}

const actualCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: target,
  encoding: 'utf8'
}).trim();

if (actualCommit !== expectedCommit) {
  console.warn(
    `Svelte PR branch moved from ${expectedCommit.slice(0, 7)} to ${actualCommit.slice(0, 7)}.`
  );
}

