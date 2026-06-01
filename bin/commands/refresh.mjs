import { resolveVault } from '../lib/resolve.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { listStale } from '../lib/stale.mjs';
import { fetchSource } from '../lib/fetchsource.mjs';

function gather(vaultPath, opts) {
  const manifest = buildManifest(vaultPath);
  const byId = new Map(manifest.entries.map(e => [e.id, e]));
  if (opts.id) {
    const e = byId.get(opts.id);
    if (!e) throw new Error(`entry not found: ${opts.id}`);
    if (e.type !== 'source' || !e.source_url) throw new Error(`not a fetchable source: ${opts.id}`);
    return [e];
  }
  const staleIds = new Set(listStale(vaultPath, { now: opts.now }).map(s => s.id));
  return manifest.entries.filter(e => e.type === 'source' && e.source_url && staleIds.has(e.id));
}

export async function refreshVault(vaultPath, opts = {}) {
  const fetch = opts.fetch || fetchSource;
  const targets = opts.targets || gather(vaultPath, opts);
  const results = [];
  for (const e of targets) {
    let outcome;
    try {
      const { status, hash } = await fetch(e.source_url, {});
      if (status >= 400) outcome = { id: e.id, result: 'unreachable', detail: `http ${status}` };
      else if (hash === e.content_hash) outcome = { id: e.id, result: 'confirmed' };
      else outcome = { id: e.id, result: 'changed', detail: 'run verify' };
    } catch (err) {
      outcome = { id: e.id, result: 'unreachable', detail: err.message };
    }
    results.push(outcome);
  }
  return results;
}

export async function run(args) {
  if (process.env.RESEARCH_VAULT_ALLOW_NETWORK !== '1') {
    process.stderr.write('refresh: refused. Network access is off by default.\n');
    process.stderr.write('Set RESEARCH_VAULT_ALLOW_NETWORK=1 to enable the double-gated web refresh.\n');
    return 1;
  }
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null });
  const targets = gather(vaultPath, { id: args.id });
  if (args['dry-run']) {
    if (targets.length === 0) process.stdout.write('refresh: no targets\n');
    for (const e of targets) process.stdout.write(`would-fetch  ${e.id}  ${e.source_url}\n`);
    return 0;
  }
  const results = await refreshVault(vaultPath, { targets });
  for (const r of results) process.stdout.write(`${r.result}  ${r.id}${r.detail ? '  (' + r.detail + ')' : ''}\n`);
  return 0;
}
