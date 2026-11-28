#!/usr/bin/env node
// Optional, non-load-bearing: before WebFetch/WebSearch, search the vault for the query or URL and
// hand the matches to the model as context. Never blocks the call; silent when no vault; always exits 0.
import { resolveVault, hasVaultContent } from '../bin/lib/resolve.mjs';
import { walkEntries, readEntry } from '../bin/lib/fsutil.mjs';
import { listStale } from '../bin/lib/stale.mjs';
import { termsOf } from '../bin/lib/terms.ts';
import { appendUsage } from '../bin/lib/usagelog.ts';
import { loadBlocklist, matchBlock } from '../bin/lib/blocklist.mjs';
import { loadProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { normalizeUrlSafe, verKey } from '../bin/lib/ids.ts';
import { screenText } from '../bin/lib/screen.ts';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function vaultContext(vaultPath, toolName, toolInput = {}, opts = {}) {
  // The URL key capture uses (normalizeUrl): host and scheme case and tracking parameters do not count, path and query case do.
  const url = toolName === 'WebFetch' ? normalizeUrlSafe(String(toolInput.url || '').trim()) : null;
  // The source blocklist (spec 32): name the reason before a fetch; a broken list never changes the answer.
  // Every value from the vault or the query passes screenText (S-11): one line each, no hidden characters.
  let block = null;
  try { block = url ? matchBlock(loadBlocklist(vaultPath), toolInput.url) : null; } catch { /* lint reports the list */ }
  const withBlock = rest => [block && `research-vault: this URL is on the vault's source blocklist (${screenText(block.pattern)}, ${screenText(block.scope)}): ${screenText(block.reason)}.`, rest].filter(Boolean).join('\n');
  const text = [toolInput.query, toolInput.prompt, toolInput.url].filter(Boolean).join(' ');
  const terms = termsOf(text).slice(0, 12);
  // ponytail: term-count scoring over title+topics+summary; swap for the manifest search index if it proves too coarse.
  const min = terms.length >= 3 ? 2 : 1;
  const stale = new Set(listStale(vaultPath).map(s => s.id));
  const hits = [];
  const urlHits = [];
  for (const abs of walkEntries(vaultPath)) {
    const e = readEntry(abs);
    if (e.data.status === 'superseded') continue;
    if (url && normalizeUrlSafe(e.data.source_url) === url) urlHits.push(e);
    const hay = `${e.data.title || ''} ${(e.data.topics || []).join(' ')} ${e.data.summary || ''}`.toLowerCase();
    const score = terms.filter(t => hay.includes(t)).length;
    if (score >= min) hits.push({ e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const line = e => `- ${screenText(e.id)} [${screenText(e.data.type)}${stale.has(e.id) ? ', STALE' : ''}] ${screenText(e.data.title)}`;
  const top = hits.slice(0, 5);
  // The usage log (spec 29): what was asked, what was surfaced. Free text only behind usage.text.
  urlHits.sort((a, b) => a.id.localeCompare(b.id));
  const ids = urlHits.length ? urlHits.map(e => e.id) : top.map(h => h.e.id);
  try { appendUsage(vaultPath, { kind: 'queried', via: 'pre-web', tool: toolName, outcome: urlHits.length ? 'url-hit' : ids.length ? 'hits' : 'no-match', ids, text: opts.text ? terms.join(' ') : undefined }, opts.now); } catch { /* never change the hook's answer */ }
  const [urlHit] = urlHits;
  if (urlHits.length === 1) return withBlock(`research-vault: this URL is already captured as ${screenText(urlHit.id)}${stale.has(urlHit.id) ? ' (STALE: verify it rather than re-reading from memory)' : ''}. Cite it; do not capture a duplicate.`);
  if (urlHits.length) return withBlock(`research-vault: this URL is captured as more than one entry: ${urlHits.map(e => `${screenText(e.id)} (${screenText(verKey(e.data.subject?.version) ?? 'no version')}, ${stale.has(e.id) ? 'STALE' : 'fresh'})`).join(', ')}; cite the one for the version you need.`);
  if (top.length) return withBlock(`Vault entries matching this query:\n${top.map(h => line(h.e)).join('\n')}`);
  return withBlock(terms.length ? `research-vault: no entry matches [${screenText(terms.join(', '))}].` : '');
}

// Entry point for this hook, called by the guard below when started directly and by the launcher after conversion.
export function main() {
  const now = new Date();
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const evt = JSON.parse(input || '{}');
      const { path: vaultPath } = resolveVault({ cwd: evt.cwd });
      if (!hasVaultContent(vaultPath)) process.exit(0);
      const cfg = loadProjectConfig(evt.cwd || process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config;
      const ctx = vaultContext(vaultPath, evt.tool_name, evt.tool_input || {}, { text: cfg?.usage?.text === true, now });
      if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ctx } }) + '\n');
    } catch { /* never block the call */ }
    process.exit(0);
  });
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) main();
