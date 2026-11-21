import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs Git without a shell, with fixed overrides for discovery, hooks, optional writes and lazy fetch.
// No fixed option disables repository-configured clean or process filter drivers.
// With a split index, Git still refreshes the shared index file's timestamp on read.
// Implicit bare-repository refusal needs Git 2.38+, boolean core.fsmonitor 2.36+,
// GIT_NO_LAZY_FETCH 2.45.1+, and hook.<event>.enabled 2.55+.
export const GIT_TIMEOUT_MS = 3000;

export function gitInvocation(args, { cwd, processCwd, timeout = GIT_TIMEOUT_MS, stderr = 'ignore' } = {}) {
  return {
    args: [
      '--no-optional-locks',
      '-c', 'core.fsmonitor=false', '-c', 'safe.bareRepository=explicit',
      '-c', `core.hooksPath=${fileURLToPath(import.meta.url)}`,
      '-c', 'hook.post-index-change.enabled=false',
      ...(cwd === undefined ? [] : ['-C', cwd]),
      ...args,
    ],
    options: { cwd: processCwd, encoding: 'utf8', stdio: ['ignore', 'pipe', stderr], shell: false, timeout, killSignal: 'SIGKILL', env: { ...process.env, GIT_NO_LAZY_FETCH: '1' } },
  };
}

export function runGit(args, options) {
  const invocation = gitInvocation(args, options);
  return execFileSync('git', invocation.args, invocation.options);
}
