import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { findSuppressions } from './suppressions.mjs';

const repo = resolve(import.meta.dirname, '..');
const tools = resolve(process.env.RV_TOOLING_DIR ?? import.meta.dirname);
const oxlint = join(tools, 'node_modules/oxlint/bin/oxlint');

if (!existsSync(oxlint)) {
  console.error('Run npm ci --ignore-scripts in tooling/ to install the linter.');
  process.exit(1);
}

const paths = process.argv.slice(2);
const defaultFolders = ["bin", "hooks", "scripts"];
if (!paths.length) {
  const missing = defaultFolders.find((folder) => !statSync(join(repo, folder), { throwIfNoEntry: false })?.isDirectory());
  if (missing) {
    console.error(`Missing default lint folder: ${missing}`);
    process.exit(1);
  }
}

const require = createRequire(join(tools, 'package.json'));
const binary = process.platform === 'win32' ? 'tsgolint.exe' : 'tsgolint';
let tsgolint;
try {
  tsgolint = require.resolve(`@oxlint-tsgolint/${process.platform}-${process.arch}/${binary}`);
} catch {
  console.error(`The type-aware linter has no package for ${process.platform}-${process.arch}, or the tools are incompletely installed. Run npm ci --ignore-scripts in tooling/.`);
  process.exit(1);
}

const findings = findSuppressions(repo, paths.length ? paths : defaultFolders);
if (findings.length) {
  for (const { file, line, marker } of findings) {
    console.error(`${file}:${line}: ${marker}: a comment that switches a check off is not allowed`);
  }
  process.exitCode = 1;
} else {
  const result = spawnSync(process.execPath, [
    oxlint, '-c', 'tooling/.oxlintrc.json',
    '--deny-warnings', '--report-unused-disable-directives-severity=error',
    // Skip legacy JavaScript during the migration.
    '--ignore-pattern=**/*.js', '--ignore-pattern=**/*.mjs',
    ...(paths.length ? ['--', ...paths] : defaultFolders),
  ], {
    cwd: repo,
    env: { ...process.env, OXLINT_TSGOLINT_PATH: tsgolint },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
