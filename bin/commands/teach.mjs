// research-teach workspace verbs: record, attempt, lint and next (spec 12 "Workspace store").
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../lib/resolve.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../lib/schema.mjs';
import { TYPE_FOLDER } from '../lib/fsutil.mjs';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { csvList } from '../lib/args.mjs';
import { writeRecord, supersedeRecord, writeAttempt, fixRecordFrontmatter, teachIndex, createServer, progress, progressText, readmeDraft } from '../lib/teach.mjs';
import { gateStatus, ledgerRoot } from '../lib/gate.mjs';
import { lintWorkspace, proseMetrics, readPath, pathFringe, pathCandidates, missionFloor, pathEdges, lessonUses, commandTools, parseLesson, topicSlug } from '../lib/lesson.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: research-vault teach record add|supersede ... | attempt add ... | lint [--fix] [--prose] [workspace] | next [workspace] | path candidates [--topic a,b] [workspace] | path edges [workspace] | progress [workspace] | readme [workspace] | serve [workspace]';

const usage = () => { process.stderr.write(USAGE + '\n'); return 2; };
const out = (s) => process.stdout.write(s + '\n');

// The positional path, else the cwd; either must hold MISSION.md, else null (usage).
function workspace(pos) {
  const ws = pos ? resolve(pos) : process.cwd();
  return existsSync(join(ws, 'MISSION.md')) ? ws : null;
}

function parseAnswers(list) {
  return list.split(',').map((s) => {
    if (!/^\s*-?\d+\s*$/.test(s)) throw new Error(`answers must be a comma list of integers: ${list}`);
    return Number(s);
  });
}

function lint(ws, args) {
  if (args.fix) {
    const dir = join(ws, 'learning-records');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
    out(`fixed ${files.filter((f) => fixRecordFrontmatter(ws, f, new Date())).length} record(s)`);
  }
  // Resolve from the workspace, so a project config there wins over the process cwd.
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws });
  if (!existsSync(vaultPath)) {
    process.stderr.write(`teach lint: no vault at ${vaultPath}\n`);
    return 2;
  }
  const schema = loadSchema(REPO_ROOT, { vaultPath });
  const findings = lintWorkspace(ws, {
    workspaceDir: ws, vaultPath, entries: buildManifest(vaultPath).entries,
    schema, teachSchema: loadTeachSchema(REPO_ROOT), now: new Date(),
    lab: loadProjectConfig(ws, { schema })?.config.lab,
  });
  const violations = findings.filter((f) => !f.warning);
  if (violations.length === 0) out('lint: clean');
  else for (const v of violations) out(`${v.code}  ${v.file}: ${v.message}`);
  for (const w of findings.filter((f) => f.warning)) out(`warning ${w.code}  ${w.file}: ${w.message}`);
  // Spec 39: numbers, not findings; the exit code is unchanged.
  if (args.prose) for (const r of proseMetrics(ws)) out(`prose ${r.file} ${r.block}: ${r.paragraphs} paragraphs, ${r.sentences} sentences, avg ${r.avg} words, longest ${r.longest}`);
  return violations.length ? 1 : 0;
}

// Spec 17 D1: one `fringe:` line per PATH.md line whose prerequisites are all built (the first is the
// default) and one `inner:` line per built non-review line nothing depends on yet, most recent first.
const fmt = (l) => `${l.n}. ${l.title}` + [['terms', l.terms.join(', ')], ['tool', l.tool], ['after', l.after.join(', ')], ['lesson', l.lesson]]
  .filter(([, v]) => v).map(([k, v]) => ` | ${k}: ${v}`).join('');

// Issue 66: after `fringe: complete`, the README's state: missing (no regular file), ok (a PASS or MERIT for its
// current content, by gate status's own rule and ledger) or ungated (none, or no ledger resolves).
function readmeLine(ws, args) {
  const file = join(ws, 'README.md');
  if (!statSync(file, { throwIfNoEntry: false })?.isFile()) return 'readme: missing';
  try {
    const root = ledgerRoot(file, resolveVault({ flag: args.vault ?? null, cwd: ws }).path);
    return root && gateStatus(root, file).verdict ? 'readme: ok' : 'readme: ungated';
  } catch { return 'readme: ungated'; }
}

function pathLines(ws, args) {
  const path = readPath(ws);
  if (path === null) return ['fringe: none (write PATH.md)'];
  const { fringe, inner } = pathFringe(path);
  const head = path.every((l) => l.lesson) ? ['fringe: complete', readmeLine(ws, args)]
    : fringe.length ? fringe.map((l) => `fringe: ${fmt(l)}`)
      : ['fringe: none (every untaken line waits on an untaken or unknown line; run teach lint)'];
  return [...head, ...(inner.length ? inner.map((l) => `inner: ${fmt(l)}`) : ['inner: none'])];
}

function next(ws, args) {
  const idx = teachIndex(ws, { now: new Date() });
  if (!idx.criteria.length) {
    process.stderr.write('teach next: MISSION.md has no "Success looks like" section\n');
    return 2;
  }
  const active = idx.records.filter((r) => r.status === 'active');
  const ids = (rows) => rows.map((r) => r.id).join(', ') || 'none';
  const last = (a) => (a ? `${a.score}/${a.total} on ${a.date}` : 'none');
  out([
    ...idx.criteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '| id | kind | date | lesson | last attempt |',
    '|---|---|---|---|---|',
    ...active.map((r) => `| ${r.id} | ${r.kind} | ${r.date} | ${r.lesson ?? ''} | ${last(r.lastAttempt)} |`),
    '',
    `review-due: ${ids(active.filter((r) => r.reviewDue))}`,
    `review-failed: ${ids(active.filter((r) => r.reviewFailed))}`,
    ...pathLines(ws, args),
  ].join('\n'));
  return 0;
}

// Spec 20 D1-D3: `teach path candidates`. Reads the workspace and the vault, writes nothing, prints every
// candidate entry under the PATH.md line it would follow with the query that produced it.
function candidates(ws, args) {
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws });
  if (!existsSync(vaultPath)) {
    process.stderr.write(`teach path candidates: no vault at ${vaultPath}\n`);
    return 2;
  }
  const schema = loadSchema(REPO_ROOT, { vaultPath });
  const topics = args.topic ? csvList(args.topic) : (loadProjectConfig(ws, { schema })?.config.defaults?.topics ?? []);
  if (!topics.length) {
    process.stderr.write('teach path candidates: no topic (pass --topic a,b or set defaults.topics in .research-vault.json)\n');
    return 2;
  }
  const idx = teachIndex(ws, { now: new Date() });
  const manifest = buildManifest(vaultPath);
  const byId = new Map(manifest.entries.map((e) => [e.id, e]));
  const readBody = (id) => { const p = join(vaultPath, TYPE_FOLDER[byId.get(id)?.type] ?? '', `${id}.md`); return existsSync(p) ? readFileSync(p, 'utf8') : ''; };
  const r = pathCandidates({
    lines: readPath(ws) ?? [], floor: missionFloor(ws), topics, manifest, readBody, aliases: schema.taxonomy.topic_aliases,
    cites: [...idx.lessons.flatMap((l) => l.cites), ...idx.reference.flatMap((d) => d.cites)],
  });
  const entry = (c, reasons = c.reasons) => `  ${c.id} [${c.type}] ${c.title}${reasons?.length ? ` | ${reasons.join(', ')}` : ''} | ${c.queries.join('; ')}`;
  const lessons = idx.lessons.filter((l) => l.cites.length).map((l) => l.number);
  const lines = [`candidates for ${ws} | topics: ${r.poolTopics.map(([t, n]) => `${t} ${n}`).join(', ')} | pool ${r.pool} | cited ${r.cited.length} (lessons ${lessons.join(', ') || 'none'})`];
  if (!r.groups.length && !r.noLine.length && !r.uncovered.length) lines.push('candidates: none');
  for (const g of r.groups) lines.push(fmt(g.line), ...g.candidates.map((c) => entry(c)));
  if (r.noLine.length) lines.push('no line', ...r.noLine.map((c) => entry(c)));
  for (const u of r.uncovered) lines.push(`term "${u.term}": no path line covers it`, ...(u.hits.length ? u.hits.map((h) => entry(h, null)) : ['  (no entry)']));
  if (!r.uncovered.length) lines.push('terms with no line: none');
  out(lines.join('\n'));
  return 0;
}

// Spec 19 D1-D3: `teach path edges`. Reads PATH.md and the built lessons, writes nothing, prints one after:
// proposal per term or tool a line uses that an earlier line its after: does not reach introduces or teaches.
function edges(ws) {
  const path = readPath(ws);
  if (path === null) { out('edges: none (write PATH.md)'); return 0; }
  const terms = [...new Set(path.flatMap((l) => [...l.terms, ...(l.tool ? [l.tool] : [])]))];
  const uses = new Map();
  for (const l of path) {
    const file = l.lesson ? join(ws, 'lessons', `${l.lesson}.html`) : null;
    if (file && existsSync(file)) {
      const html = readFileSync(file, 'utf8');
      uses.set(l.n, [...lessonUses(html, terms).map((term) => ({ term, via: 'uses' })), ...[...commandTools(parseLesson(html).blocks).keys()].map((term) => ({ term, via: 'runs' }))]);
    } else if (!l.lesson) {
      const slug = topicSlug(l.title);
      uses.set(l.n, terms.filter((t) => slug.includes(topicSlug(t))).map((term) => ({ term, via: 'names' })));
    }
  }
  const groups = pathEdges({ lines: path, uses });
  const n = groups.reduce((s, g) => s + g.proposals.length, 0);
  const lines = [`edges for ${ws} | built ${path.filter((l) => l.lesson).map((l) => l.lesson.slice(0, 4)).join(', ') || 'none'} | proposals ${n}`];
  if (!n) lines.push('edges: none');
  for (const g of groups) lines.push(fmt(g.line), ...g.proposals.map((p) => `  after: ${p.after} | ${g.line.lesson ?? 'title'} ${p.via} "${p.term}" | line ${p.after} ${p.by.tool === p.term ? 'teaches' : 'introduces'} it (${p.by.lesson ?? 'untaken'})`));
  out(lines.join('\n'));
  return 0;
}

// Runs until killed: the returned promise settles only when the server closes.
async function serve(ws, teachSchema, titles) {
  const server = createServer(ws, { schema: teachSchema, titles });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const { port } = server.address();
  const file = join(ws, '.teach-serve.json');
  writeFileSync(file, JSON.stringify({ port, pid: process.pid }) + '\n');
  process.on('exit', () => rmSync(file, { force: true }));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0)); // exit handler removes the file
  out(`serving ${ws} at http://127.0.0.1:${port}/`);
  await new Promise((ok) => server.on('close', ok));
  return 0;
}

export async function run(args) {
  const [, verb, sub, ...rest] = args._;
  const teachSchema = loadTeachSchema(REPO_ROOT);
  const now = new Date();

  if (verb === 'progress') {
    const ws = workspace(sub);
    if (!ws) return usage();
    process.stdout.write(progressText(progress(ws, { now: new Date() })));
    return 0;
  }
  // Issue 66: the README's lesson map and lab list on stdout; nothing is written.
  if (verb === 'readme') {
    const ws = workspace(sub);
    if (!ws) return usage();
    process.stdout.write(readmeDraft(ws));
    return 0;
  }
  if (verb === 'lint' || verb === 'next') {
    const ws = workspace(sub);
    if (!ws) return usage();
    return verb === 'lint' ? lint(ws, args) : next(ws, args);
  }
  if (verb === 'path' && (sub === 'candidates' || sub === 'edges')) {
    const ws = workspace(rest[0]);
    if (!ws) return usage();
    return sub === 'edges' ? edges(ws) : candidates(ws, args);
  }
  if (verb === 'record' && sub === 'add') {
    const ws = workspace(rest[0]);
    if (!ws || !args.title || !args.kind) return usage();
    const body = args['body-file'] ? readFileSync(resolve(args['body-file']), 'utf8') : undefined;
    out(writeRecord(ws, { title: args.title, kind: args.kind, lesson: args.lesson, body, now }, teachSchema).id);
    return 0;
  }
  if (verb === 'record' && sub === 'supersede') {
    const [id, pos] = rest;
    const ws = workspace(pos);
    if (!ws || !id || !args.by) return usage();
    supersedeRecord(ws, id, args.by, args.reason, teachSchema);
    out(`superseded ${id} by ${args.by}`);
    return 0;
  }
  if (verb === 'attempt' && sub === 'add') {
    const ws = workspace(rest[0]);
    if (!ws || !args.lesson || !args.answers === !args.result) return usage(); // exactly one of --answers, --result
    const r = writeAttempt(ws, { lesson: args.lesson, answers: args.answers && parseAnswers(args.answers), result: args.result, now }, teachSchema);
    out(`recorded ${r.id}: ${r.result ?? `${r.score}/${r.total}`}`);
    return 0;
  }
  if (verb === 'serve') {
    const ws = workspace(sub);
    if (!ws) return usage();
    // Vault titles for the footnote rendering; a missing vault just leaves ids as titles.
    let titles = {};
    try {
      const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws });
      if (existsSync(vaultPath)) titles = Object.fromEntries(buildManifest(vaultPath).entries.map((e) => [e.id, e.title ?? e.id]));
    } catch { /* serve without titles */ }
    return serve(ws, teachSchema, titles);
  }
  return usage();
}
