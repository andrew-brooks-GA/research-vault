// research-teach workspace verbs: record, attempt, lint and next (spec 12 "Workspace store").
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync, realpathSync, statSync, lstatSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTSIDE_PROJECT_VAULT, resolveVault } from '../lib/resolve.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { loadSchema, loadTeachSchema } from '../lib/schema.mjs';
import { TYPE_FOLDER, walkEntries } from '../lib/fsutil.ts';
import { loadProjectConfig } from '../lib/projectconfig.mjs';
import { csvList } from '../lib/args.ts';
import { writeRecord, supersedeRecord, writeAttempt, importAttempts, RESULTS_MAX, fixRecordFrontmatters, teachIndex, createServer, progress, progressText, readmeDraft, exportWorkspace, writeExport, lessonIndex, missionPrefs, taskSummary, previousTaskAttempt, certificationRuns } from '../lib/teach.mjs';
import { LESSON_ID_RE, readPath } from '../lib/lesson-format.ts';
import { escapeHtml } from '../lib/escape.ts';
import { readRequirements, reportLines, checkAttempt, answeredAttempt, taskLesson, checkTask, readRun, runLine, openLine, startRun, endRun, cancelRun } from '../lib/task.mjs';
import { scanCast, castTranscript } from '../lib/cast.ts';
import { hasVerdict } from '../lib/gate.mjs';
import { readLabs, secretHits } from '../lib/labs.mjs';
import { readBrand } from '../lib/brand.mjs';
import { ptyAvailable } from '../lib/terminal.mjs';
import { assertInsideWorkspaceFolder, isInsideVault, isInsideWorkspaceFolder, mayBeInside, VAULT_PATH_OUTSIDE } from '../lib/containment.ts';
import { screenText } from '../lib/screen.ts';
import { lintWorkspace, proseMetrics, pathFringe, pathCandidates, missionFloor, pathEdges, lessonUses, commandTools, parseLesson, topicSlug } from '../lib/lesson.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const USAGE = 'usage: research-vault teach record add|supersede ... | attempt add ... | attempt import <file> [workspace] | cast check <file> [--needle <value>]... | cast transcript <file> | check [--dry-run] [--hints] <N> [workspace] | check --start <N>... [--minutes <M>] [--pass <P>] [--no-hints] [workspace] | check --certify [workspace] | check --cancel [workspace] | export [workspace] --out <dir> [--skip-ungated] | lint [--fix] [--prose] [workspace] | next [workspace] | path candidates [--topic a,b] [workspace] | path edges [workspace] | progress [workspace] | readme [workspace] | serve [--labs] [--terminal] [workspace]';

const usage = () => { process.stderr.write(USAGE + '\n'); return 2; };
const out = (s) => process.stdout.write(s + '\n');

// The positional path, else the cwd; either must hold MISSION.md, else null (usage).
function workspace(pos, checkMission = false) {
  const ws = pos ? resolve(pos) : process.cwd();
  const mission = join(ws, 'MISSION.md');
  return (!checkMission || isInsideVault(ws, mission)) && existsSync(mission) ? ws : null;
}

function parseAnswers(list) {
  return list.split(',').map((s) => {
    if (!/^\s*-?\d+\s*$/.test(s)) throw new Error(`answers must be a comma list of integers: ${list}`);
    return Number(s);
  });
}

function lint(ws, args) {
  // Resolve from the workspace before writing any fixes.
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws });
  if (args.fix) {
    const dir = join(ws, 'learning-records');
    assertInsideWorkspaceFolder(ws, dir);
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')) : [];
    out(`fixed ${fixRecordFrontmatters(ws, files)} record(s)`);
  }
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
  if (!isInsideVault(ws, file) || !statSync(file, { throwIfNoEntry: false })?.isFile()) return 'readme: missing';
  try {
    const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws, workspaceDir: ws });
    return hasVerdict(file, vaultPath, ws) ? 'readme: ok' : 'readme: ungated';
  } catch (err) {
    if (err.code === OUTSIDE_PROJECT_VAULT) throw err;
    return 'readme: ungated';
  }
}

// Spec 48: `teach export`. Exit 2 before any work on a bad --out or no vault; every check runs before the first
// write, so a refusal (exit 1) leaves nothing behind.
function exportCopy(ws, args) {
  if (typeof args.out !== 'string') return usage();
  const dir = resolve(args.out);
  const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws, workspaceDir: ws });
  const refuse = (why) => { process.stderr.write(`teach export: ${why}\n`); return 2; };
  if (!existsSync(vaultPath)) return refuse(`no vault at ${vaultPath}`);
  if (lstatSync(dir, { throwIfNoEntry: false })?.isSymbolicLink()) return refuse(`--out ${dir} is a symlink`);
  if (mayBeInside(vaultPath, dir)) return refuse(`--out ${dir} is inside the vault`);
  for (const d of ['lessons', 'reference', 'assets', 'brand']) if (mayBeInside(join(ws, d), dir)) return refuse(`--out ${dir} is inside the workspace's ${d}/`);
  const st = statSync(dir, { throwIfNoEntry: false });
  if (st && !(st.isDirectory() && readdirSync(dir).length === 0)) return refuse(`--out ${dir} exists and is not an empty directory`);
  const r = exportWorkspace(ws, { vaultPath, entries: buildManifest(vaultPath).entries, skipUngated: args['skip-ungated'] === true });
  if (r.lines.length) out(r.lines.join('\n'));
  if (r.error) process.stderr.write(r.error + '\n');
  if (r.code) return r.code;
  try { writeExport(dir, r.files); } catch (e) {
    return refuse(`cannot write under ${dir} (${e.code ?? e.message}); removed what this run wrote`);
  }
  out(`wrote ${r.files.size} files to ${dir}`);
  return 0;
}

// Issue 65 (spec 47 D2): `teach cast check` exits 0 when the cast is clean and 1 with one line per hit, naming the
// needle's kind and the event, never the value; `teach cast transcript` prints the output events, HTML-escaped, for the
// replay's <pre>. Exit 2 on usage, or a file that cannot be read or is no asciicast (no parser message: it may quote the file).
function cast(sub, file, args) {
  const needles = args.needle ?? [];
  if (!['check', 'transcript'].includes(sub) || !file || needles.some((n) => !n)) return usage();
  try {
    const text = readFileSync(file, 'utf8');
    if (sub === 'transcript') { process.stdout.write(escapeHtml(castTranscript(text))); return 0; }
    const hits = scanCast(text, needles);
    out(hits.length ? hits.map((h) => `secret ${file}: ${h.kind} at ${h.at === 'header' ? 'the header' : `event ${h.at}`}`).join('\n') : 'cast: clean');
    return hits.length ? 1 : 0;
  } catch (e) {
    process.stderr.write(`teach cast: ${file}: ${e.code ? `cannot read (${e.code})` : 'not an asciicast v2 or v3 file'}\n`);
    return 2;
  }
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
  const run = readRun(ws);
  const ids = (rows) => rows.map((r) => r.id).join(', ') || 'none';
  // Issue 79 D6: a task attempt reads ok, failed or answered, never a score.
  const last = (a) => (a ? `${a.kind === 'answered' ? 'answered' : a.kind === 'task' ? (a.wrongHere ? 'failed' : 'ok') : `${a.score}/${a.total}`} on ${a.date}` : 'none');
  out([
    ...idx.criteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '| id | kind | date | lesson | last attempt |',
    '|---|---|---|---|---|',
    ...active.map((r) => `| ${r.id} | ${r.kind} | ${r.date} | ${r.lesson ?? ''} | ${last(r.lastAttempt)} |`),
    '',
    // Issue 79 D1, D2: review-due only with reminders; the preferences the skill reads, and those to ask for.
    ...(idx.prefs.reminders ? [`review-due: ${ids(active.filter((r) => r.reviewDue))}`] : []),
    `review-failed: ${ids(active.filter((r) => r.reviewFailed))}`,
    `answered: ${ids(active.filter((r) => r.answered))}`,
    // Issue 79 D8: the latest run's grade, derived from its attempts, and the open run.
    ...certificationRuns(idx.attempts).slice(-1).map((g) => `certification: ${g.id} ${g.ok} of ${g.total} (${g.tasks.map((t) => `${t.lesson.slice(0, 4)} ${t.ok} of ${t.total}`).join(', ')})`),
    ...(run.state ? [openLine(run.state, new Date())] : run.problem ? [`certification: ${run.problem}`] : []),
    `preferences: hints ${idx.prefs.hints}, path reviews ${idx.prefs.pathReviews ? 'yes' : 'no'}, reminders ${
      idx.prefs.reminders ? `every ${idx.prefs.reminders} day${idx.prefs.reminders === 1 ? '' : 's'}` : 'none'}`,
    ...(idx.prefs.unset.length ? [`preferences-unset: ${idx.prefs.unset.join(', ')}`] : []),
    ...pathLines(ws, args),
  ].join('\n'));
  return 0;
}

// Issue 79 D3, D4: `teach check [--dry-run] [--hints] <N> [workspace]`. A word of one to four digits is the lesson
// number; at most one other word is the workspace. Without --dry-run, N must also name one lessons/NNNN-*.html. Exit 0
// when every requirement is ok, 1 otherwise, and 2 for a problem, with one problem line on stderr
// (the checker's last stderr line added to a problem with its output) and no report. Issue 79 D4: without --dry-run, an
// attempt is written when the three lists differ from those of the lesson's last attempt that has a `tested` list, or
// there is none. D8: `--start <N>... [--minutes <M>] [--pass <P>] [--no-hints]`, `--certify` and `--cancel` start, end
// and drop a certification run; a check of a task in an open run records nothing and ends with the run's line.
const RUN_ONLY = ['minutes', 'pass', 'no-hints'];
const checkWithAnnouncement = (ws, nnnn, env) => checkTask(ws, nnnn, {
  // Accessing the stream initializes POSIX pipes as nonblocking before writing directly to the descriptor.
  err: (line) => writeFileSync(process.stderr.fd, line + '\n'),
  env,
});
async function check(words, args, schema) {
  const nums = words.filter((w) => /^\d{1,4}$/.test(w));
  const other = words.filter((w) => !/^\d{1,4}$/.test(w));
  const flags = Object.keys(args).filter((k) => k !== '_');
  const mode = Object.entries({ start: args.start, certify: args.certify, cancel: args.cancel }).filter(([, v]) => v === true).map(([k]) => k);
  if (mode.length > 1 || other.length > 1) return usage();
  if (mode[0] === 'certify' || mode[0] === 'cancel' ? nums.length || flags.length !== 1
    : mode[0] === 'start' ? !nums.length || flags.some((k) => k !== 'start' && !RUN_ONLY.includes(k))
      : nums.length !== 1 || flags.some((k) => RUN_ONLY.includes(k))) return usage();
  const ws = workspace(other[0]);
  if (!ws) return usage();
  const io = { now: () => new Date(), out, err: (s) => process.stderr.write(s + '\n') };
  // A flag given with no value is '', which startRun refuses as out of range.
  const given = (k, v) => (k in args ? v ?? '' : null);
  if (mode[0] === 'start') return startRun(ws, nums, { minutes: given('minutes', args.minutes), pass: given('pass', args.pass), hints: args['no-hints'] !== true }, io);
  if (mode[0] === 'certify') return endRun(ws, schema, { ...io, checker: checkWithAnnouncement });
  if (mode[0] === 'cancel') return cancelRun(ws, io);
  const nnnn = nums[0].padStart(4, '0');
  const refuse = (why) => { process.stderr.write(`teach check: ${nnnn}: ${why}\n`); return 2; };
  if (!statSync(join(ws, 'evidence', nnnn), { throwIfNoEntry: false })?.isDirectory()) return refuse(`no evidence/${nnnn}/ folder`);
  let lesson = null;
  if (args['dry-run'] !== true) {
    const l = taskLesson(ws, nnnn);
    if (l.problem) return refuse(l.problem);
    lesson = l.lesson;
  }
  const open = readRun(ws);
  if (open.problem) return refuse(open.problem);
  const run = open.state?.tasks.includes(nnnn) ? open.state : null;
  if (run && !run.hints && args.hints === true) return refuse(`hints are held back in certification run ${run.id}`);
  if (lesson && !run) assertInsideWorkspaceFolder(ws, join(ws, 'attempts'));
  const c = await checkWithAnnouncement(ws, nnnn);
  if (c.problem) return refuse(c.problem);
  const { requirements, parsed } = c;
  // The attempt is written before the report, so a write that fails leaves nothing on stdout.
  if (lesson && !run) {
    const task = checkAttempt(requirements, parsed);
    const prev = previousTaskAttempt(ws, lesson);
    if (!prev || ['passed', 'failed', 'unreached'].some((k) => JSON.stringify(task[k]) !== JSON.stringify(prev[k]))) writeAttempt(ws, { lesson, task, now: new Date() }, schema);
  }
  const held = run?.hints === false;
  const hints = !held && (args.hints === true || missionPrefs(ws).hints === 'always');
  out([...reportLines(requirements, parsed, { hints, n: Number(nnnn), ask: !held }), ...(run ? [runLine(run, new Date())] : [])].join('\n'));
  return parsed.failed.length || parsed.unreached.length ? 1 : 0;
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
  const entryPaths = new Set(walkEntries(vaultPath));
  const readBody = (id) => {
    const type = byId.get(id)?.type; // a string from the entry: `constructor` names no folder (S-13)
    const p = join(vaultPath, Object.hasOwn(TYPE_FOLDER, type) ? TYPE_FOLDER[type] : '', `${id}.md`);
    return entryPaths.has(p) && existsSync(p) ? readFileSync(p, 'utf8') : '';
  };
  const r = pathCandidates({
    lines: readPath(ws) ?? [], floor: missionFloor(ws), topics, manifest, readBody, aliases: schema.taxonomy.topic_aliases,
    cites: [...idx.lessons.flatMap((l) => l.cites), ...idx.reference.flatMap((d) => d.cites)],
  });
  // Each value from an entry passes screenText (S-11): one line each, no hidden characters.
  const entry = (c, reasons = c.reasons) => `  ${screenText(c.id)} [${screenText(c.type)}] ${screenText(c.title)}${reasons?.length ? ` | ${reasons.join(', ')}` : ''} | ${c.queries.map((q) => screenText(q)).join('; ')}`;
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

// Runs until killed: the returned promise settles only when the server closes. Spec 49 D4: with --labs, an invalid
// labs/labs.json exits 2, and the lab address is printed once, here, and nowhere else. D6: a lesson or reference page
// that holds a declared env value gets one warning line. D5: with --labs, SIGINT, SIGTERM and SIGHUP run the Stop
// sequence on every running lab group before exiting (a second signal exits at once), and exit sends each SIGKILL.
// Spec 50 D4: an invalid brand/brand.json gets one line at start, and the pages are served unbranded. Plan 2026-11-18
// browser terminal D1 and D2: --terminal needs python3 with its pty module, else exit 2; it makes t as --labs does and,
// without --labs, prints the terminal: open line in place of the labs: open one; SIGINT, SIGTERM and SIGHUP send SIGHUP
// to the shell's helper group before exiting, and exit sends it SIGKILL.
async function serve(ws, teachSchema, titles, labs, terminal) {
  const name = '.teach-serve.json';
  const stateError = `${name}: cannot use as a regular workspace state file`;
  const invalidState = () => Object.assign(new Error(stateError), { code: VAULT_PATH_OUTSIDE });
  const refuseState = () => { process.stderr.write(`teach serve: ${stateError}\n`); return 2; };
  let root;
  try { root = realpathSync.native(ws); } catch { return refuseState(); }
  const file = join(root, name);
  const checkState = () => {
    try {
      if (realpathSync.native(root) === root) {
        const stat = lstatSync(file, { throwIfNoEntry: false });
        if ((!stat || stat.isFile()) && isInsideVault(root, file)) return stat;
      }
    } catch { /* refuse an unavailable workspace state path */ }
    throw invalidState();
  };
  try { checkState(); } catch { return refuseState(); }
  if (readBrand(ws).problems.length) process.stderr.write('brand: brand/brand.json is invalid; run teach lint\n');
  if (labs) {
    let manifest;
    try { ({ labs: manifest } = readLabs(ws)); } catch {
      process.stderr.write('teach serve: labs/labs.json is invalid; run teach lint\n');
      return 2;
    }
    const { lessons, reference } = lessonIndex(ws);
    const pages = [...lessons, ...reference].flatMap(({ path }) => {
      const file = join(ws, path);
      return isInsideWorkspaceFolder(ws, dirname(file), file) ? [[path.slice(1), readFileSync(file, 'utf8')]] : [];
    });
    for (const [p, name] of secretHits(pages, manifest, process.env)) process.stderr.write(`warning: ${p} holds the value of ${name}\n`);
  }
  if (terminal && !ptyAvailable('python3')) {
    process.stderr.write('teach serve: --terminal needs python3 with its pty module\n');
    return 2;
  }
  const t = labs || terminal ? randomBytes(32).toString('hex') : undefined;
  const server = createServer(ws, { schema: teachSchema, titles, labs, terminal, t, log: out });
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const { port } = server.address();
  const state = JSON.stringify({ port, pid: process.pid }) + '\n';
  try {
    if (checkState()) {
      unlinkSync(file);
      checkState();
    }
    writeFileSync(file, state, { flag: 'wx' });
  } catch (e) {
    server.close();
    if (e.code === VAULT_PATH_OUTSIDE || e.code === 'EEXIST') return refuseState();
    throw e;
  }
  process.on('exit', () => {
    // Check the directory holding the name. Unlink the name even if it has become a link.
    try { if (realpathSync.native(root) === root) unlinkSync(file); } catch { /* allow the remaining exit handlers to run */ }
  });
  if (labs || terminal) {
    let stopping = false;
    for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
      process.on(sig, () => {
        if (stopping) process.exit(0);
        stopping = true;
        server.stopShell?.();
        Promise.resolve(server.stopLabs?.()).finally(() => process.exit(0));
      });
    }
    process.on('exit', () => { server.killLabs?.(); server.killShell?.(); });
  } else {
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => process.exit(0)); // exit handler removes the file
  }
  out(`serving ${ws} at http://127.0.0.1:${port}/`);
  if (labs) out(`labs: open http://127.0.0.1:${port}/labs/open?t=${t}`);
  else if (terminal) out(`terminal: open http://127.0.0.1:${port}/labs/open?t=${t}`);
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
    if (!ws || !args.lesson || [args.answers, args.result, args.answered].filter((x) => x !== undefined).length !== 1) return usage(); // exactly one of --answers, --result, --answered
    // Issue 79 D5, D7: --answered <ids> (or all) records the answer to those requirements of the lesson's task.
    let task;
    if (args.answered !== undefined) {
      if (!LESSON_ID_RE.test(String(args.lesson))) return usage();
      const { requirements, problems } = readRequirements(ws, args.lesson.slice(0, 4));
      if (problems.length) { process.stderr.write(`teach attempt add: ${problems[0]}\n`); return 2; }
      task = answeredAttempt(requirements, csvList(args.answered));
    }
    const r = writeAttempt(ws, { lesson: args.lesson, answers: args.answers && parseAnswers(args.answers), result: args.result, task, now }, teachSchema);
    out(`recorded ${r.id}: ${task ? taskSummary(task) : r.result ?? `${r.score}/${r.total}`}`);
    return 0;
  }
  // Spec 48 D4: the results file of an exported copy; exit 2 before any read of its content.
  if (verb === 'attempt' && sub === 'import') {
    const [file, pos] = rest;
    const ws = workspace(pos);
    if (!file || !ws) return usage();
    let text;
    try {
      if (statSync(file).size > RESULTS_MAX) {
        process.stderr.write(`teach attempt import: ${file} is over 1 MiB\n`);
        return 2;
      }
      text = readFileSync(file, 'utf8');
    } catch (e) {
      process.stderr.write(`teach attempt import: cannot read ${file} (${e.code ?? e.message})\n`);
      return 2;
    }
    const { code, lines } = importAttempts(ws, text, { schema: teachSchema, now });
    if (lines.length) out(lines.join('\n'));
    return code;
  }
  if (verb === 'cast') return cast(sub, rest[0], args);
  if (verb === 'check') return check([sub, ...rest].filter((w) => w !== undefined), args, teachSchema);
  if (verb === 'export') {
    const ws = workspace(sub, true);
    if (!ws) return usage();
    return exportCopy(ws, args);
  }
  if (verb === 'serve') {
    const ws = workspace(sub, true);
    if (!ws) return usage();
    // Vault titles for the footnote rendering; a missing vault just leaves ids as titles.
    let titles = {};
    try {
      const { path: vaultPath } = resolveVault({ flag: args.vault ?? null, cwd: ws, workspaceDir: ws });
      if (existsSync(vaultPath)) titles = Object.fromEntries(buildManifest(vaultPath).entries.map((e) => [e.id, e.title ?? e.id]));
    } catch (err) {
      if (err.code === OUTSIDE_PROJECT_VAULT) throw err;
      // Serve without titles when the vault cannot otherwise be read.
    }
    return serve(ws, teachSchema, titles, args.labs === true, args.terminal === true);
  }
  return usage();
}
