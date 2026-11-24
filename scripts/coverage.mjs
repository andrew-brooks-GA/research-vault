import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runGit } from '../bin/lib/git.mjs';

const excluded = new Map([
  // Vendored browser bundles: exercise through the browser, not Node's test loader.
  ['skills/research-teach/terminal/xterm.mjs', 'vendored browser terminal bundle'],
  ['skills/research-teach/terminal/addon-fit.mjs', 'vendored browser terminal sizing addon'],
]);
// Node's default coverage exclusions drop test-like names (*.test.mjs,
// test-*.mjs and files under test/). Empty files also have no lcov record.
// Such code files would be reported as loaded by no test; none are tracked today.
const files = runGit(['ls-files', '-z', '--', 'bin/', 'hooks/', 'scripts/', 'skills/'])
  .split('\0').filter((file) => /\.(?:mjs|js)$/.test(file) && !excluded.has(file)).sort();
const input = process.argv.slice(2);
// Filters and other runner options can also narrow discovery; only a default run
// can establish that the complete suite loads every file.
const partial = input.length > 0;
const temp = mkdtempSync(join(tmpdir(), 'rv-coverage-'));
try {
  const lcov = join(temp, 'coverage.lcov');
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run-tests.mjs', import.meta.url)),
    '--experimental-test-coverage', '--test-reporter=spec', '--test-reporter-destination=stdout',
    '--test-reporter=lcov', `--test-reporter-destination=${lcov}`, ...input],
  { stdio: 'inherit', timeout: 1220000 });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`Coverage suite failed (${result.signal ?? result.status}); not-loaded check was not evaluated.`);
    process.exitCode = result.status ?? 1;
  } else process.exitCode = 0;
  const rows = new Map();
  let source;
  for (const line of readFileSync(lcov, 'utf8').split('\n')) {
    if (line.startsWith('SF:')) {
      source = relative(process.cwd(), resolve(line.slice(3))).replaceAll('\\', '/');
      rows.set(source, {});
    } else {
      const match = /^(LF|LH|BRF|BRH|FNF|FNH):(\d+)$/.exec(line);
      if (match && source) rows.get(source)[match[1]] = Number(match[2]);
    }
  }
  const totals = { LF: 0, LH: 0, BRF: 0, BRH: 0, FNF: 0, FNH: 0 };
  const percent = (row, hit, found) => row[found] ? `${(100 * row[hit] / row[found]).toFixed(2)}%` : 'n/a';
  const print = (file, row) => console.log(`${file} | ${row ? [percent(row, 'LH', 'LF'), percent(row, 'BRH', 'BRF'), percent(row, 'FNH', 'FNF')].join(' | ') : 'not loaded'}`);
  console.log('\nFile | Lines | Branches | Functions');
  const missing = [];
  for (const file of files) {
    const row = rows.get(file);
    print(file, row);
    if (!row) missing.push(file);
    else for (const key of Object.keys(totals)) totals[key] += row[key] ?? 0;
  }
  print('TOTAL (loaded code files)', totals);
  for (const [file, reason] of excluded) console.log(`Excluded: ${file} (${reason})`);
  if (partial) console.log('Not-loaded check skipped: partial run.');
  else if (result.status === 0 && missing.length) {
    console.error(`Loaded by no test:\n${missing.join('\n')}`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error.code !== 'ENOENT' || error.path !== join(temp, 'coverage.lcov')) throw error;
  console.error('No coverage data was written.');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
