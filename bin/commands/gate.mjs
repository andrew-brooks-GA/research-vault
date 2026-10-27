// Claims-gate CLI: derive a draft's evidence list, record a reviewer verdict keyed to the
// draft's content hash, and report whether the current content carries a passing verdict.
import { resolve, dirname } from 'node:path';
import { resolveVault } from '../lib/resolve.mjs';
import { findProjectConfig } from '../lib/projectconfig.mjs';
import { isInsideVault } from '../lib/containment.mjs';
import { csvList } from '../lib/args.mjs';
import { VERDICTS, recordVerdict, gateStatus, evidenceFor, renderEvidence, changedUnits, codeLang, ledgerKey } from '../lib/gate.mjs';
import { readVersions } from '../lib/codelinks.mjs';

const USAGE = `usage: research-vault gate evidence <draft> [--extra ids] [--changed] [--json] | changed <draft> | record <file> <${VERDICTS.join('|')}> [note] | status <file> [--check]`;

export async function run(args) {
  const cwd = args.cwd ?? process.cwd();
  const [, sub, file, verdict, note] = args._;
  const usage = () => { process.stderr.write(USAGE + '\n'); return 2; };
  if (!file || !['evidence', 'changed', 'record', 'status'].includes(sub)) return usage();
  if (sub === 'record' && !VERDICTS.includes(verdict)) return usage();
  const abs = resolve(cwd, file);
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: dirname(abs) });
  const cfg = findProjectConfig(dirname(abs));
  // A vault entry outside any bound repo (e.g. a synthesis in an OS-default vault) is
  // gated with the vault directory as the ledger root.
  const repoRoot = cfg ? dirname(cfg.path) : isInsideVault(vaultPath, abs) ? resolve(vaultPath) : null;
  if (!repoRoot) {
    process.stderr.write(`gate: ${file} is not inside a repo bound with .research-vault.json\n`);
    return 2;
  }

  if (sub === 'evidence') {
    const extra = csvList(args.extra);
    const c = codeLang(repoRoot, abs);
    const r = evidenceFor(abs, vaultPath, { extra, code: c && { lang: c.lang, versions: readVersions(c.cfg, repoRoot) } });
    if (args.changed) r.changed = changedUnits(repoRoot, abs);
    if (args.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0; }
    let out = renderEvidence(r);
    if (args.changed) {
      out += `changed units: ${r.changed.join(', ') || 'none'}\n`;
      // One line per changed code unit: its range and the worst status of its links, for the reviewer.
      for (const u of r.units ?? []) if (r.changed.includes(u.unit)) out += `unit ${u.unit} ${ledgerKey(repoRoot, abs)}:${u.start}-${u.end} ${u.status}\n`;
    }
    process.stdout.write(out);
    return 0;
  }
  if (sub === 'changed') {
    const units = changedUnits(repoRoot, abs);
    process.stdout.write(`changed units: ${units.join(', ') || 'none'}\n`);
    return units.length ? 1 : 0;
  }
  if (sub === 'record') {
    const row = recordVerdict(repoRoot, abs, verdict, note);
    process.stdout.write(`recorded claims ${verdict} for ${row.file} @ ${row.sha256.slice(0, 12)}\n`);
    return 0;
  }
  const s = gateStatus(repoRoot, abs);
  process.stdout.write(`${s.file}: ${s.verdict ?? 'none'} @ ${s.sha256.slice(0, 12)}${s.units?.length && !(s.units.length === 1 && s.units[0] === 'all') ? ` (changed units: ${s.units.join(', ')})` : ''}\n`);
  return args.check && !s.verdict ? 1 : 0;
}
