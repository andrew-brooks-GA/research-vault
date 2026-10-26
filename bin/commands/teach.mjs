// research-teach workspace verbs: record, attempt, lint and next (spec 12 "Workspace store").
import { existsSync, readdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveVault } from '../lib/resolve.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../lib/schema.mjs';
import { writeRecord, supersedeRecord, writeAttempt, fixRecordFrontmatter, teachIndex, createServer, progress, progressText } from '../lib/teach.mjs';
import { lintWorkspace } from '../lib/lesson.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: research-vault teach record add|supersede ... | attempt add ... | lint [--fix] [workspace] | next [workspace] | progress [workspace] | serve [workspace]';

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
  const findings = lintWorkspace(ws, {
    workspaceDir: ws, vaultPath, entries: buildManifest(vaultPath).entries,
    schema: loadSchema(REPO_ROOT, { vaultPath }), teachSchema: loadTeachSchema(REPO_ROOT), now: new Date(),
  });
  const violations = findings.filter((f) => !f.warning);
  if (violations.length === 0) out('lint: clean');
  else for (const v of violations) out(`${v.code}  ${v.file}: ${v.message}`);
  for (const w of findings.filter((f) => f.warning)) out(`warning ${w.code}  ${w.file}: ${w.message}`);
  return violations.length ? 1 : 0;
}

function next(ws) {
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
  ].join('\n'));
  return 0;
}

// Runs until killed: the returned promise settles only when the server closes.
async function serve(ws, teachSchema) {
  const server = createServer(ws, { schema: teachSchema });
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
  if (verb === 'lint' || verb === 'next') {
    const ws = workspace(sub);
    if (!ws) return usage();
    return verb === 'lint' ? lint(ws, args) : next(ws);
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
    if (!ws || !args.lesson || !args.answers) return usage();
    const r = writeAttempt(ws, { lesson: args.lesson, answers: parseAnswers(args.answers), now }, teachSchema);
    out(`recorded ${r.id}: ${r.score}/${r.total}`);
    return 0;
  }
  if (verb === 'serve') {
    const ws = workspace(sub);
    if (!ws) return usage();
    return serve(ws, teachSchema);
  }
  return usage();
}
