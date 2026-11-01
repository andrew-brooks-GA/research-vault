#!/usr/bin/env node
// Blast radius of one vault entry across code, from the two outputs listed in docs/REFERENCE.md
// "Reading the graph from outside": the manifest's `sources` and `contributing_ids` edges walked
// inward (the entries that rest on the id, at any depth: what `related <id> --direction in
// --rel sources,contributing_ids` follows) and every row of one or more `check --json` outputs
// whose `id` is one of them. Nothing is rebuilt here; run `lint` and `check --json` first.
//
//   node examples/blast-radius.mjs <vault>/.vault-manifest.json <id> <check.json> [<check.json> ...]
//
// Prints the dependent entries by distance, then one line per citing row:
//   <check.json>  <file>[#<symbol>:<line>]  <status>  cites <id> (distance N)
import { readFileSync } from 'node:fs';

const [manifestPath, start, ...checks] = process.argv.slice(2);
if (!manifestPath || !start || !checks.length) {
  process.stderr.write('usage: blast-radius.mjs <manifest.json> <id> <check.json>...\n');
  process.exit(2);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (!manifest.entries.some((e) => e.id === start)) process.stderr.write(`${start} is not in the manifest; walking its edges anyway\n`);

const DEPENDENCY_RELS = ['sources', 'contributing_ids']; // bin/lib/graph.mjs DEPENDENCY_RELS
const restsOn = new Map(); // id -> the ids whose claims rest on it
for (const e of manifest.edges) if (DEPENDENCY_RELS.includes(e.rel)) (restsOn.get(e.to) ?? restsOn.set(e.to, []).get(e.to)).push(e.from);
const distance = new Map([[start, 0]]);
for (const queue = [start]; queue.length;) {
  const cur = queue.shift();
  for (const d of restsOn.get(cur) ?? []) if (!distance.has(d)) { distance.set(d, distance.get(cur) + 1); queue.push(d); }
}

const out = [`downstream of ${start}: ${[...distance].filter(([, d]) => d).map(([id, d]) => `${id} (${d})`).join(', ') || 'nothing'}`];
for (const path of checks) {
  for (const r of JSON.parse(readFileSync(path, 'utf8')).rows) {
    if (!distance.has(r.id)) continue; // an uncovered row has no id and cites nothing in the vault
    const where = r.symbol ? `${r.file}#${r.symbol}:${r.line}` : r.file;
    out.push(`${path}  ${where}  ${r.status}  cites ${r.id} (distance ${distance.get(r.id)})`);
  }
}
process.stdout.write(out.join('\n') + '\n');
