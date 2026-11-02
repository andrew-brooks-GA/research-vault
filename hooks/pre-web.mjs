#!/usr/bin/env node
// Optional, non-load-bearing: before WebFetch/WebSearch, search the vault for the query or URL and
// hand the matches to the model as context. Never blocks the call; silent when no vault; always exits 0.
import { existsSync } from 'node:fs';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { walkEntries, readEntry } from '../bin/lib/fsutil.mjs';
import { listStale } from '../bin/lib/stale.mjs';
import { termsOf } from '../bin/lib/terms.mjs';
import { appendUsage } from '../bin/lib/usagelog.mjs';
import { loadProjectConfig } from '../bin/lib/projectconfig.mjs';
import { loadSchema } from '../bin/lib/schema.mjs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const normUrl = u => String(u || '').trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

export function vaultContext(vaultPath, toolName, toolInput = {}, opts = {}) {
  const url = toolName === 'WebFetch' ? normUrl(toolInput.url) : '';
  const text = [toolInput.query, toolInput.prompt, toolInput.url].filter(Boolean).join(' ');
  const terms = termsOf(text).slice(0, 12);
  // ponytail: term-count scoring over title+topics+summary; swap for the manifest search index if it proves too coarse.
  const min = terms.length >= 3 ? 2 : 1;
  const stale = new Set(listStale(vaultPath).map(s => s.id));
  const hits = [];
  let urlHit = null;
  for (const abs of walkEntries(vaultPath)) {
    const e = readEntry(abs);
    if (e.data.status === 'superseded') continue;
    if (url && normUrl(e.data.source_url) === url) urlHit = e;
    const hay = `${e.data.title || ''} ${(e.data.topics || []).join(' ')} ${e.data.summary || ''}`.toLowerCase();
    const score = terms.filter(t => hay.includes(t)).length;
    if (score >= min) hits.push({ e, score });
  }
  hits.sort((a, b) => b.score - a.score);
  const line = e => `- ${e.id} [${e.data.type}${stale.has(e.id) ? ', STALE' : ''}] ${e.data.title}`;
  const top = hits.slice(0, 5);
  // The usage log (spec 29): what was asked, what was surfaced. Free text only behind usage.text.
  const ids = urlHit ? [urlHit.id] : top.map(h => h.e.id);
  try { appendUsage(vaultPath, { kind: 'queried', via: 'pre-web', tool: toolName, outcome: urlHit ? 'url-hit' : ids.length ? 'hits' : 'no-match', ids, text: opts.text ? terms.join(' ') : undefined }); } catch { /* never change the hook's answer */ }
  if (urlHit) return `research-vault: this URL is already captured as ${urlHit.id}${stale.has(urlHit.id) ? ' (STALE: verify it rather than re-reading from memory)' : ''}. Cite it; do not capture a duplicate.`;
  if (top.length) return `Vault entries matching this query:\n${top.map(h => line(h.e)).join('\n')}`;
  return terms.length ? `research-vault: no entry matches [${terms.join(', ')}].` : '';
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const evt = JSON.parse(input || '{}');
      const { path: vaultPath } = resolveVault({ cwd: evt.cwd });
      if (!existsSync(vaultPath)) process.exit(0);
      const cfg = loadProjectConfig(evt.cwd || process.cwd(), { schema: loadSchema(REPO_ROOT) })?.config;
      const ctx = vaultContext(vaultPath, evt.tool_name, evt.tool_input || {}, { text: cfg?.usage?.text === true });
      if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ctx } }) + '\n');
    } catch { /* never block the call */ }
    process.exit(0);
  });
}
