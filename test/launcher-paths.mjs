// Files that stay JavaScript, with the source each launcher may import once converted.
export const javascriptFiles = new Map([
  ['bin/lib/node-floor.mjs', null],
  ['scripts/run-tests.mjs', null],
  ['scripts/coverage.mjs', null],
  ...[
    'hooks/post-tool-use.mjs',
    'hooks/session-start.mjs',
    'hooks/pre-web.mjs',
    'hooks/stop-gate.mjs',
    'hooks/codex.mjs',
    'bin/research-vault.mjs',
    'scripts/deps.mjs',
    'scripts/check-encoding.mjs',
    'scripts/check-agentsmd-drift.mjs',
  ].map((file) => [file, file.replace(/\.mjs$/, '.ts')]),
]);
