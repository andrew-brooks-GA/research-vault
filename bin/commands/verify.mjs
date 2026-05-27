import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { loadSchema, fieldOrder } from '../lib/schema.mjs';
import { walkEntries, readEntry, writeEntry } from '../lib/fsutil.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function findEntry(vaultPath, id) {
  for (const abs of walkEntries(vaultPath)) if (basename(abs).replace(/\.md$/, '') === id) return abs;
  throw new Error(`entry not found: ${id}`);
}

export function applyVerification(vaultPath, opts) {
  const repoRoot = opts.repoRoot || REPO_ROOT;
  const schema = loadSchema(repoRoot);
  const now = opts.now || new Date().toISOString().slice(0, 10);
  const abs = findEntry(vaultPath, opts.id);
  const entry = readEntry(abs);

  if (!schema.taxonomy.verification_method.includes(opts.method)) throw new Error(`invalid method: ${opts.method}`);
  if (opts.method === 'inferred-stable') {
    const durable = schema.taxonomy.durable_source_types.includes(entry.data.source_type);
    if (entry.data.volatility !== 'stable' || !durable)
      throw new Error('inferred-stable requires volatility=stable AND a durable source type');
  }
  if (opts.result === 'inconclusive') return { action: 'none' };

  entry.data.verifications = entry.data.verifications || [];
  entry.data.verifications.push({ date: now, by_type: opts.byId ? 'agent' : 'human', by_id: opts.byId || '', method: opts.method, result: opts.result, notes: opts.notes || '' });

  if (opts.succession) {
    // Version succession: entry remains correct for its version → stay active, do NOT supersede.
    // The newer version is captured as a separate sibling entry sharing the same `series`.
    entry.data.updated = now;
    writeEntry(abs, entry.data, entry.body, fieldOrder(schema, entry.data.type));
    writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
    return { action: 'version-succeeded' };
  }

  if (opts.result === 'outdated') {
    entry.data.status = 'superseded';
    if (opts.supersededBy) entry.data.superseded_by = opts.supersededBy;
  } else {
    entry.data.updated = now;
  }
  writeEntry(abs, entry.data, entry.body, fieldOrder(schema, entry.data.type));
  writeFileSync(join(vaultPath, '.vault-manifest.json'), JSON.stringify(buildManifest(vaultPath), null, 2), 'utf8');
  return { action: opts.result === 'outdated' ? 'superseded' : 'updated' };
}

export function listStale(vaultPath, opts = {}) {
  const schema = loadSchema(opts.repoRoot || REPO_ROOT);
  const now = new Date(opts.now || new Date().toISOString().slice(0, 10));
  const out = [];
  for (const e of buildManifest(vaultPath).entries) {
    const win = schema.taxonomy.volatility[e.volatility]?.refresh_after_days;
    if (win === undefined) continue;
    if (win === 0) { out.push({ id: e.id, volatility: e.volatility, reason: 'always re-check' }); continue; }
    const last = e.last_verified ? new Date(e.last_verified) : null;
    const ageDays = last ? (now - last) / 86400000 : Infinity;
    if (ageDays > win) out.push({ id: e.id, volatility: e.volatility, ageDays: Math.round(ageDays) });
  }
  return out;
}

export async function run(args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  if (args.stale || !args.id) {
    const stale = listStale(vaultPath, {});
    if (args.json) process.stdout.write(JSON.stringify(stale, null, 2) + '\n');
    else stale.forEach(s => process.stdout.write(`${s.id}  ${s.volatility}  ${s.reason || s.ageDays + 'd'}\n`));
    return 0;
  }
  const r = applyVerification(vaultPath, { id: args.id, method: args.method, result: args.result, byId: args['by-id'], notes: args.notes, supersededBy: args['superseded-by'], succession: !!args.succession });
  process.stdout.write(`verify: ${r.action}\n`);
  if (r.action === 'version-succeeded') process.stdout.write(`Entry kept active. Capture the new version as a sibling: research-vault capture --type source --title "..." --subject-version <new> --series <same-series>\n`);
  return 0;
}
