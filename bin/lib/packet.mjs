import { join, resolve, relative, isAbsolute } from 'node:path';
import { existsSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { walkEntries, readEntry, writeEntry, TYPE_FOLDER } from './fsutil.mjs';
import { loadSchema, fieldOrder } from './schema.mjs';
import { writeManifest } from './manifest.mjs';

export const RUN_KEY = /^run-[A-Za-z0-9]{6,}$/;
// As in the prototype measured in spec 54 (T9): a source of 8,000 bytes or less is copied whole.
export const PACKET_SMALL_BYTES = 8000;
const AROUND = 3;
// A `quote-matched` row for a quote found in a stored body: `<quote hash 8> L<line>@<body hash 8>[ <run key>]: <quote>`.
const LINE_ROW = /^[0-9a-f]{8} L(\d+)@([0-9a-f]{8})(?: (run-[A-Za-z0-9]+))?: /;
const h8 = s => createHash('sha256').update(s).digest('hex').slice(0, 8);

// An evidence packet (spec 54 item 5): a copy of the listed entries in which a source's stored text
// is cut to the lines within three of a quote its run checked. Three rules. It is built only when
// every line row on every listed source carries this run's key and the hash of the body as it
// stands, so no excerpt is cut around another draft's quotes or an older text. A round on a packet
// can fail a draft and cannot pass one: an excerpt cannot show that a page lacks something. The
// reviewer's file is not touched: the packet is a vault-shaped directory given to it as the vault.
export function buildPacket(vaultPath, entries, dir, runKey, repoRoot) {
  if (!RUN_KEY.test(String(runKey))) throw new Error('--packet needs --run <key>: run- and six or more letters or digits');
  const out = resolve(dir);
  const rel = relative(resolve(vaultPath), out);
  if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('--packet: the directory must be outside the vault');
  if (existsSync(out) && readdirSync(out).length) throw new Error(`--packet: ${dir} is not empty`);
  const want = new Set(entries.map(e => e.id));
  const plan = [];
  for (const abs of walkEntries(vaultPath)) {
    const e = readEntry(abs);
    if (!want.has(e.id)) continue;
    const item = { abs, e, lines: null };
    if (e.data.type === 'source') {
      const rows = (e.data.verifications || []).filter(v => v.method === 'quote-matched').map(v => LINE_ROW.exec(v.notes || '')).filter(Boolean);
      const bodyHash = h8(e.body);
      const other = rows.find(m => m[3] !== runKey || m[2] !== bodyHash);
      if (other) throw new Error(`no packet: ${e.id} has a quote row ${other[3] !== runKey ? `of ${other[3] || 'no run'}, not of ${runKey}` : 'for an earlier text of its body'}`);
      if (rows.length && Buffer.byteLength(e.body) > PACKET_SMALL_BYTES) item.lines = rows.map(m => Number(m[1]));
    }
    plan.push(item);
  }
  if (!plan.some(p => p.lines)) throw new Error(`no packet: no listed source holds a quote row of ${runKey} on a text over ${PACKET_SMALL_BYTES} bytes, so there is nothing to cut`);
  const schema = loadSchema(repoRoot, { vaultPath });
  let excerpted = 0;
  for (const { abs, e, lines } of plan) {
    const folder = join(out, TYPE_FOLDER[e.data.type]);
    mkdirSync(folder, { recursive: true });
    const to = join(folder, `${e.id}.md`);
    if (!lines) { copyFileSync(abs, to); continue; }
    const body = e.body.split('\n');
    const keep = new Set();
    for (const at of lines) for (let k = Math.max(1, at - AROUND); k <= Math.min(body.length, at + AROUND); k++) keep.add(k);
    const cut = [`# ${e.data.title}`, '', `Excerpt of the stored page text: the lines within ${AROUND} of a quote this run checked, each with its line number in the stored body. The rest is left out, so this excerpt cannot show that the page lacks something.`, ''];
    let last = 0;
    for (const k of [...keep].sort((a, b) => a - b)) {
      if (last && k > last + 1) cut.push('[...]');
      cut.push(`L${k}: ${body[k - 1]}`);
      last = k;
    }
    writeEntry(to, e.data, cut.join('\n') + '\n', fieldOrder(schema, 'source'));
    excerpted++;
  }
  writeManifest(out);
  return { dir: out, entries: plan.length, excerpted };
}
