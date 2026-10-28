#!/usr/bin/env node
// Graphviz DOT from the two outputs listed in docs/REFERENCE.md "Reading the graph from outside":
// the vault manifest (entries and typed edges, rebuilt here without validation) and `check --json`
// (which code cites which entry).
// A project with its own graph tool does the same join; this is the smallest worked example.
//
//   node examples/graph-dot.mjs <repo-root> > graph.dot && dot -Tsvg graph.dot > graph.svg
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(process.argv[2] ?? '.');
const bin = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'research-vault.mjs');
const run = (...args) => execFileSync(process.execPath, [bin, ...args], { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
const cfg = JSON.parse(readFileSync(join(repo, '.research-vault.json'), 'utf8'));
run('manifest', '--rebuild', '--vault', cfg.vault);
const manifest = JSON.parse(readFileSync(join(repo, cfg.vault, '.vault-manifest.json'), 'utf8'));
const check = JSON.parse(run('check', '--json'));

const q = (s) => JSON.stringify(String(s));
const out = ['digraph research {', '  rankdir=LR; node [shape=box fontname=Helvetica];'];
for (const e of manifest.entries) out.push(`  ${q(e.id)} [label=${q(`${e.type}\n${e.title || e.id}`)}${e.status === 'superseded' ? ' style=dashed' : ''}];`);
for (const e of manifest.edges) out.push(`  ${q(e.from)} -> ${q(e.to)} [label=${q(e.rel)}];`);
for (const r of check.rows) {
  // A code row names its symbol; a prose row is the document itself.
  const node = r.symbol ? `${r.file}#${r.symbol}` : r.file;
  const pin = r.key ? `${r.key}=${r.version}` : '';
  out.push(`  ${q(node)} [shape=ellipse];`, `  ${q(node)} -> ${q(r.value)} [label=${q(pin)} color=${r.status === 'ok' ? 'black' : 'red'}];`);
}
out.push('}');
process.stdout.write(out.join('\n') + '\n');
