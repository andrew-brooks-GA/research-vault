import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { lintVault, fixVault } from '../lib/lintrules.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function lintAndReport(vaultPath, { check = false } = {}) {
  const { violations } = lintVault(vaultPath, REPO_ROOT);
  if (check) {
    const fresh = JSON.stringify(buildManifest(vaultPath).entries);
    const mfPath = join(vaultPath, '.vault-manifest.json');
    const cur = existsSync(mfPath) ? JSON.stringify(JSON.parse(readFileSync(mfPath, 'utf8')).entries) : null;
    if (cur !== fresh) violations.push({ file: mfPath, code: 'MANIFEST_STALE', msg: 'manifest out of date (run lint)' });
  } else {
    writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
  }
  return violations;
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  if (args.fix) {
    const { fixed } = fixVault(vaultPath, REPO_ROOT);
    process.stdout.write(`lint --fix: normalized ${fixed} file(s)\n`);
  }
  const violations = lintAndReport(vaultPath, { check: !!args.check });
  if (args.json) process.stdout.write(JSON.stringify(violations, null, 2) + '\n');
  else if (violations.length === 0) process.stdout.write('lint: clean\n');
  else for (const v of violations) process.stdout.write(`${v.code}  ${v.file}: ${v.msg}\n`);
  return violations.length ? 1 : 0;
}
