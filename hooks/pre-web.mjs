#!/usr/bin/env node
// Optional, non-load-bearing: before WebFetch/WebSearch, search the vault for the query or URL and
// hand the matches to the model as context. Never blocks the call; silent when no vault; always exits 0.
import { existsSync } from 'node:fs';
import { resolveVault } from '../bin/lib/resolve.mjs';
import { walkEntries, readEntry } from '../bin/lib/fsutil.mjs';
import { listStale } from '../bin/lib/stale.mjs';

const STOP = new Set('the a an and or of to in on for with how what why does is are was be this that from into about using use vs'.split(' '));
const normUrl = u => String(u || '').trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase();

export function vaultContext(vaultPath, toolName, toolInput = {}) {
  const url = toolName === 'WebFetch' ? normUrl(toolInput.url) : '';
  const text = [toolInput.query, toolInput.prompt, toolInput.url].filter(Boolean).join(' ');
  const terms = [...new Set(text.toLowerCase().replace(/https?:\/\/\S+/g, ' ').split(/[^a-z0-9_.-]+/).filter(t => t.length >= 3 && !STOP.has(t)))].slice(0, 12);
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
  const out = [];
  if (urlHit) out.push(`research-vault: this URL is already captured as ${urlHit.id}${stale.has(urlHit.id) ? ' (STALE: verify it rather than re-reading from memory)' : ''}. Cite it; do not capture a duplicate.`);
  const top = hits.slice(0, 5).map(h => line(h.e));
  if (top.length) out.push(`research-vault: ${hits.length} entr${hits.length === 1 ? 'y' : 'ies'} match [${terms.join(', ')}]. Read these before fetching; answer from them if they are fresh:\n${top.join('\n')}`);
  else if (terms.length) out.push(`research-vault: no entry matches [${terms.join(', ')}]. If you fetch, capture the source before citing it.`);
  return out.join('\n');
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  let input = '';
  process.stdin.on('data', d => input += d);
  process.stdin.on('end', () => {
    try {
      const evt = JSON.parse(input || '{}');
      const { path: vaultPath } = resolveVault({});
      if (!existsSync(vaultPath)) process.exit(0);
      const ctx = vaultContext(vaultPath, evt.tool_name, evt.tool_input || {});
      if (ctx) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: ctx } }) + '\n');
    } catch { /* never block the call */ }
    process.exit(0);
  });
}
