// Claims-gate CLI: derive a draft's evidence list, record a reviewer verdict keyed to the
// draft's content hash, and report whether the current content carries a passing verdict.
import { resolve, dirname, join } from 'node:path';
import { lstatSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../lib/resolve.mjs';
import { loadProjectConfig, PROJECT_CONFIG_FILENAME } from '../lib/projectconfig.mjs';
import { loadSchema } from '../lib/schema.mjs';
import { csvList } from '../lib/args.ts';
import { VERDICTS, draftState, recordVerdict, gateStatus, evidenceFor, renderEvidence, changedUnits, codeLang, ledgerKey, ledgerRoot, stagedGates, missingEvidence } from '../lib/gate.mjs';
import { readVersions } from '../lib/codelinks.mjs';
import { buildPacket } from '../lib/packet.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// `none (reviewer changed)`: the file's passing rows were given by another version of the reviewer.
// Issue 72 item 12: a file with no verdict names each cause the gate can see: another reviewer, cited ids this vault lacks,
// or (gate staged) a file beside it whose staged and working copies differ.
const label = (s) => {
  if (s.verdict) return s.verdict;
  const why = [s.reviewerChanged && 'reviewer changed', s.missing && `${s.missing} cited id${s.missing === 1 ? '' : 's'} not in this vault`, ...(s.differs ?? []).map((d) => `${d}: staged and working copies differ`)].filter(Boolean);
  return why.length ? `none (${why.join('; ')})` : 'none';
};
const USAGE = `usage: research-vault gate evidence <draft> [--extra ids] [--changed] [--json] [--packet <dir> --run <key>] | changed <draft> | record <file> <${VERDICTS.join('|')}> [note] [--expect <hash>] | status <file> [--check] | staged [--check]`;

export async function run(args) {
  const cwd = args.cwd ?? process.cwd();
  const [, sub, file, verdict, note] = args._;
  const usage = () => { process.stderr.write(USAGE + '\n'); return 2; };
  if (!['evidence', 'changed', 'record', 'status', 'staged'].includes(sub) || (!file && sub !== 'staged')) return usage();
  // --expect (or --expect=<hash>) is refused unless it is a SHA-256 in hex.
  if (sub === 'record' && (!VERDICTS.includes(verdict) || ('expect' in args && !/^[0-9a-f]{64}$/i.test(args.expect ?? '')))) return usage();

  // The pre-commit form: every staged gated file and the verdict for its staged content; --check exits 1 while one has none.
  // A git failure throws (exit 2): a state that could not be inspected is never reported as none.
  if (sub === 'staged') {
    const hit = loadProjectConfig(cwd, { schema: loadSchema(REPO_ROOT) });
    if (!hit) {
      for (let dir = resolve(cwd); ; dir = dirname(dir)) {
        const candidate = join(dir, PROJECT_CONFIG_FILENAME);
        if (lstatSync(candidate, { throwIfNoEntry: false })) {
          process.stderr.write(`gate: ${candidate}: binding exists but cannot be read\n`);
          return 2;
        }
        if (dirname(dir) === dir) break;
      }
      process.stdout.write('staged gated files: none (no .research-vault.json binding here, so nothing is gated)\n'); return 0;
    }
    const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd });
    const rows = stagedGates(dirname(hit.path), vaultPath, hit.config, cwd);
    if (!rows.length) process.stdout.write('staged gated files: none\n');
    for (const r of rows) process.stdout.write(`${r.file}: ${label(r)}\n`);
    return args.check && rows.some((r) => !r.verdict) ? 1 : 0;
  }
  const abs = resolve(cwd, file);
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: dirname(abs) });
  // A vault entry outside any bound repo (e.g. a synthesis in an OS-default vault) is
  // gated with the vault directory as the ledger root.
  const repoRoot = ledgerRoot(abs, vaultPath);
  if (!repoRoot) {
    process.stderr.write(`gate: ${file} is not inside a repo bound with .research-vault.json\n`);
    return 2;
  }

  if (sub === 'evidence') {
    const extra = csvList(args.extra);
    // What gate record --expect compares: the hash of what a row would store, taken before the list is derived.
    const { reviewHash } = draftState(repoRoot, abs);
    const c = codeLang(repoRoot, abs);
    // With --changed, a Markdown draft's list holds only the citations in the changed units (evidenceFor).
    const changed = args.changed ? changedUnits(repoRoot, abs) : null;
    const r = evidenceFor(abs, vaultPath, { extra, changed, code: c && { lang: c.lang, versions: readVersions(c.cfg, repoRoot) } });
    if (changed) r.changed = changed;
    // An evidence packet for a run's own synthesis (spec 54 item 5): built before anything is printed, or not at all.
    let packet = null;
    if (args.packet) {
      try { packet = buildPacket(vaultPath, r.entries, resolve(cwd, String(args.packet)), args.run, REPO_ROOT); } catch (err) { process.stderr.write(`gate: ${err.message}\n`); return 1; }
      r.packet = packet;
    }
    r.reviewHash = reviewHash;
    if (args.json) { process.stdout.write(JSON.stringify(r, null, 2) + '\n'); return 0; }
    let out = renderEvidence(r);
    if (args.changed) {
      out += `changed units: ${r.changed.join(', ') || 'none'}\n`;
      // One line per changed code unit: its range and the worst status of its links, for the reviewer.
      for (const u of r.units ?? []) if (r.changed.includes(u.unit)) out += `unit ${u.unit} ${ledgerKey(repoRoot, abs)}:${u.start}-${u.end} ${u.status}\n`;
    }
    if (packet) out += `packet: ${packet.dir} (${packet.excerpted} of ${packet.entries} entries cut to the lines around this run's quotes; a round on it can fail the draft and cannot pass it)\n`;
    out += `review hash: ${reviewHash}\n`;
    process.stdout.write(out);
    return 0;
  }
  if (sub === 'changed') {
    const units = changedUnits(repoRoot, abs);
    process.stdout.write(`changed units: ${units.join(', ') || 'none'}\n`);
    return units.length ? 1 : 0;
  }
  if (sub === 'record') {
    let row;
    try { row = recordVerdict(repoRoot, abs, verdict, note, args.expect); } catch (err) {
      if (err.code !== 'DRAFT_CHANGED') throw err;
      process.stderr.write(`gate: ${file} or a file beside it changed since gate evidence (review hash ${args.expect.slice(0, 12).toLowerCase()}, now ${err.actual.slice(0, 12)}); nothing recorded\n`);
      return 1;
    }
    process.stdout.write(`recorded claims ${verdict} for ${row.file} @ ${row.sha256.slice(0, 12)}\n`);
    return 0;
  }
  const s = gateStatus(repoRoot, abs);
  if (!s.verdict) s.missing = missingEvidence(repoRoot, abs, vaultPath, s.units);
  process.stdout.write(`${s.file}: ${label(s)} @ ${s.sha256.slice(0, 12)}${s.units?.length && !(s.units.length === 1 && s.units[0] === 'all') ? ` (changed units: ${s.units.join(', ')})` : ''}\n`);
  return args.check && !s.verdict ? 1 : 0;
}
