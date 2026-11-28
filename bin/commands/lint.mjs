import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintAndReport, fixVault } from '../lib/lintrules.mjs';
import { resolveVault, reportFallback } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export { lintAndReport };

export async function run(args) {
  const resolved = resolveVault({ flag: args.vault ?? null });
  const vaultPath = resolved.path;
  if (args.fix) {
    reportFallback(resolved);
    // `--topics` takes no value here (a boolean in lint's table, args.ts): present means rewrite aliased topics (spec 24).
    const { fixed } = fixVault(vaultPath, REPO_ROOT, { topics: args.topics === true });
    if (!args.json) process.stdout.write(`fixed ${fixed} file(s)\n`);
  }
  const { violations, warnings } = lintAndReport(vaultPath, { check: !!args.check });
  if (args.json) {
    process.stdout.write(JSON.stringify({ violations, warnings }, null, 2) + '\n');
  } else {
    if (violations.length === 0) process.stdout.write('lint: clean\n');
    else for (const v of violations) process.stdout.write(`${v.code}  ${v.file}: ${v.msg}\n`);
    for (const w of warnings) process.stdout.write(`warning ${w.code}  ${w.file}: ${w.msg}\n`);
  }
  return violations.length ? 1 : 0;
}
