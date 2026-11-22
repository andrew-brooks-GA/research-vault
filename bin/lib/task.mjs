// Issue 79 D3, D4: a checked task's requirements file, the run of its checker for `teach check`, the checker's output
// read against the file, and the lines `teach check` prints. The checker is started here, not by labs.mjs's launch,
// which needs a pin (R12). D8: a certification run's start, end and cancel.
import { accessSync, constants, existsSync, lstatSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { parseFrontmatter } from './frontmatter.mjs';
import { LAB_TEXT_BAD_RE, LAB_OUTPUT_MAX, STOP_GRACE, KILL_WAIT, stopGroup } from './labs.mjs';
import { show, RECORD_ID_RE, LESSON_ID_RE, nextAttemptId, writeAttempt, missionPrefs } from './teach.mjs';
import { assertInsideWorkspaceFolder, isInsideVault, VAULT_PATH_OUTSIDE } from './containment.mjs';

const TASK_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
const KEYS = ['id', 'text', 'records', 'read'];
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v) => typeof v === 'string' && v.length >= 1 && v.length <= 300 && !LAB_TEXT_BAD_RE.test(v);
const extraKey = (o, keys) => Object.keys(o).find((k) => !keys.includes(k));

// evidence/NNNN/requirements.json: { timeout (seconds), requirements, problems }. With any problem, the timeout is 60
// and the list holds only the requirements whose id, text and read are valid, so the lint can still check each read
// and text; a value the file holds that broke its rule is printed through show.
export function readRequirements(ws, nnnn) {
  const fail = (problems, requirements = []) => ({ timeout: 60, requirements, problems });
  const file = join(ws, 'evidence', nnnn, 'requirements.json');
  if (!existsSync(file)) return fail([`evidence/${nnnn}/requirements.json is missing`]);
  let doc;
  try { doc = JSON.parse(readFileSync(file, 'utf8')); } catch { return fail(['requirements.json is not JSON']); }
  if (!isObject(doc)) return fail(['requirements.json is not a JSON object']);
  const problems = [];
  const extra = extraKey(doc, ['version', 'timeout', 'requirements']);
  if (extra !== undefined) problems.push(`requirements.json has the key ${show(extra)}, which is not allowed`);
  if (doc.version !== 1) problems.push('version must be 1');
  if (doc.timeout !== undefined && !(Number.isInteger(doc.timeout) && doc.timeout >= 1 && doc.timeout <= 600)) problems.push('timeout must be a whole number of seconds from 1 to 600');
  if (!Array.isArray(doc.requirements) || !doc.requirements.length) problems.push('requirements must be a list of one or more');
  const seen = new Set();
  const usable = [];
  (Array.isArray(doc.requirements) ? doc.requirements : []).forEach((r, i) => {
    const at = `requirement ${i + 1}`;
    if (!isObject(r)) return problems.push(`${at} is not an object`);
    const k = extraKey(r, KEYS);
    if (k !== undefined) return problems.push(`${at} has the key ${show(k)}, which is not allowed`);
    if (KEYS.some((x) => !Object.hasOwn(r, x))) return problems.push(`${at} needs id, text, records and read`);
    const before = problems.length;
    if (typeof r.id !== 'string' || !TASK_ID_RE.test(r.id)) problems.push(`${at}: id ${show(r.id)} does not match ^[a-z][a-z0-9-]{0,39}$`);
    else if (r.id === 'all') problems.push(`${at}: id "all" is reserved for --answered all`);
    else if (seen.has(r.id)) problems.push(`${at}: id ${r.id} is repeated`);
    seen.add(r.id);
    for (const f of ['text', 'read']) if (!text(r[f])) problems.push(`${at}: ${f} must be 1 to 300 characters with no control, line-separator or bidi character`);
    if (problems.length === before) usable.push(r);
    if (!Array.isArray(r.records) || !r.records.every((x) => typeof x === 'string')) problems.push(`${at}: records must be a list of learning-record ids`);
    else for (const id of r.records) {
      if (!RECORD_ID_RE.test(id) || !existsSync(join(ws, 'learning-records', `${id}.md`))) problems.push(`${at}: record ${RECORD_ID_RE.test(id) ? id : show(id)} is not in learning-records/`);
    }
  });
  return problems.length ? fail(problems, usable) : { timeout: doc.timeout ?? 60, requirements: doc.requirements, problems };
}

// The checker's standard output, its ok and FAIL lines (LF or CRLF), read against the requirements:
// { passed, failed: { id, hint }[], unreached }, each in file order, or { problem } for an exit code other than 0 and 1, an id the file does not hold or printed twice, a hint
// with a LAB_TEXT_BAD_RE character, exit 0 without ok for every id, or exit 1 with no FAIL line. Other lines are ignored.
export function parseChecker(requirements, { code, stdout }) {
  if (code !== 0 && code !== 1) return { problem: `check.sh exited ${code}` };
  const ids = requirements.map((r) => r.id);
  const seen = new Map(); // id -> null for ok, the hint for FAIL
  for (const line of stdout.split(/\r?\n/)) {
    const m = /^ok (\S+)$/.exec(line) ?? /^FAIL (\S+?): (.+)$/s.exec(line);
    if (!m) {
      // A line that starts with ok or FAIL, in any case, and a requirement's id, in neither form: a checker bug.
      const [first, second] = line.trim().split(/[\s:]+/);
      if (/^(ok|fail)$/i.test(first) && ids.includes(second)) return { problem: `check.sh printed ${show(line.trim())}, which is not of the form ok <id> or FAIL <id>: <hint>` };
      continue;
    }
    const [, id, hint = null] = m;
    if (!ids.includes(id)) return { problem: `check.sh printed ${show(id)}, which requirements.json does not hold` };
    if (seen.has(id)) return { problem: `check.sh printed ${id} twice` };
    if (hint !== null && LAB_TEXT_BAD_RE.test(hint)) return { problem: `check.sh printed a hint for ${id} with a control, line-separator or bidi character` };
    seen.set(id, hint);
  }
  const passed = ids.filter((id) => seen.get(id) === null);
  const failed = ids.filter((id) => typeof seen.get(id) === 'string').map((id) => ({ id, hint: seen.get(id) }));
  if (code === 0 && passed.length !== ids.length) return { problem: 'check.sh exited 0 without ok for every requirement' };
  if (code === 1 && !failed.length) return { problem: 'check.sh exited 1 with no FAIL line' };
  return { passed, failed, unreached: ids.filter((id) => !seen.has(id)) };
}

// D4: evidence/NNNN/check.sh by its absolute path, no shell, from the workspace root, leading its own process group,
// with `env`. At most OUTPUT_MAX bytes of output are kept. Its group gets the Stop sequence at the timeout, at the
// output cap, when the leader exits, and on SIGINT, SIGTERM or SIGHUP. Resolves after close with { code, stdout,
// stderr } (code is the signal name when a signal ended it), or { problem }.
export const runChecker = (ws, nnnn, { timeoutMs, env = process.env, limits = {} }) => runGroup(ws, nnnn, 'check.sh', { timeoutMs, env, limits });

// D8: evidence/NNNN/setup.sh the same way, with no timeout and its output straight to the terminal. Only SIGINT,
// SIGTERM and SIGHUP stop its group: what it leaves running in the background when it exits (a port-forward) stays, as
// when the learner runs it by hand. Resolves with { code } or { problem }.
export const runSetup = (ws, nnnn, { env = process.env, limits = {} } = {}) => runGroup(ws, nnnn, 'setup.sh', { timeoutMs: null, env, limits, inherit: true });

function runGroup(ws, nnnn, name, { timeoutMs, env, limits, inherit = false }) {
  const L = { STOP_GRACE, KILL_WAIT, OUTPUT_MAX: LAB_OUTPUT_MAX, ...limits };
  const cannot = (e) => ({ problem: `${name} could not start (${e.code ?? e.message})` });
  let child;
  try {
    child = spawn(join(ws, 'evidence', nnnn, name), [], { cwd: ws, env, shell: false, detached: true, stdio: ['ignore', inherit ? 'inherit' : 'pipe', inherit ? 'inherit' : 'pipe'] });
  } catch (e) { return Promise.resolve(cannot(e)); }
  // A file that cannot be executed (EACCES, ENOENT) gives no pid and an error event.
  if (child.pid === undefined) return new Promise((done) => child.once('error', (e) => done(cannot(e))));
  return new Promise((done) => {
    const pgid = child.pid;
    const out = { stdout: [], stderr: [] };
    let size = 0, why = null, code = null, stopping = null;
    const stop = (reason) => { why ??= reason; return (stopping ??= stopGroup(pgid, L)); };
    const timer = timeoutMs === null ? null : setTimeout(() => stop(`ran past ${timeoutMs / 1000} seconds`), timeoutMs);
    const onSignal = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((sig) => [sig, () => stop(`stopped by ${sig}`)]);
    for (const [sig, f] of onSignal) process.on(sig, f);
    if (!inherit) {
      for (const s of ['stdout', 'stderr']) {
        child[s].on('data', (b) => {
          if (why) return;
          if ((size += b.length) > L.OUTPUT_MAX) stop('output past 1 MiB');
          else out[s].push(b);
        });
      }
    }
    child.on('exit', (c, sig) => {
      clearTimeout(timer);
      code = c ?? sig;
      if (inherit) return; // a setup's background processes stay (runSetup)
      // The rest of the group goes too; a process that left the group can hold a pipe open, so stop waiting for close.
      stop(null).then(() => setTimeout(() => [child.stdout, child.stderr].forEach((s) => s?.destroy()), 200).unref());
    });
    child.on('close', async () => {
      clearTimeout(timer);
      await stopping;
      for (const [sig, f] of onSignal) process.off(sig, f);
      done(why ? { problem: why } : { code, stdout: Buffer.concat(out.stdout).toString('utf8'), stderr: Buffer.concat(out.stderr).toString('utf8') });
    });
  });
}

// D5: the `task` object writeAttempt stores for a check. `tested` holds each record for which the run reached every
// requirement that names it, `records` those of them with such a requirement failed; `wrong` holds the positions not ok.
const recordsOf = (requirements) => [...new Set(requirements.flatMap((r) => r.records))];
export function checkAttempt(requirements, parsed, certification = null) {
  const failed = parsed.failed.map((f) => f.id);
  const naming = (rec) => requirements.filter((r) => r.records.includes(rec));
  const tested = recordsOf(requirements).filter((rec) => naming(rec).every((r) => !parsed.unreached.includes(r.id)));
  return {
    total: requirements.length,
    wrong: requirements.flatMap((r, i) => (parsed.passed.includes(r.id) ? [] : [i])),
    records: tested.filter((rec) => naming(rec).some((r) => failed.includes(r.id))),
    passed: parsed.passed, failed, unreached: parsed.unreached, tested,
    ...(certification ? { certification } : {}),
  };
}

// D5: the `task` object for an answer to `ids` (`['all']` for every id), in file order; every record an answered
// requirement names is tested and failed. Throws on an id the file does not hold.
export function answeredAttempt(requirements, ids) {
  const all = requirements.map((r) => r.id);
  const unknown = ids.filter((id) => id !== 'all' && !all.includes(id));
  if (unknown.length) throw new Error(`no requirement ${unknown.map(show).join(', ')} in requirements.json`);
  if (!ids.length) throw new Error('no requirement id given');
  const answered = requirements.filter((r) => ids.includes('all') || ids.includes(r.id));
  const recs = recordsOf(answered);
  return { total: answered.length, wrong: answered.map((_, i) => i), records: recs, tested: recs, answered: answered.map((r) => r.id) };
}

// D4's lines, one requirement after another in file order; with `hints` false and a failure, a last line on how to ask,
// unless `ask` is false (D8: hints held back in a certification run).
export function reportLines(requirements, parsed, { hints, n, ask = true }) {
  const failed = new Map(parsed.failed.map((f) => [f.id, f.hint]));
  const lines = requirements.flatMap((r) => (parsed.passed.includes(r.id) ? [`ok ${r.id}: ${r.text}`]
    : failed.has(r.id) ? [`FAIL ${r.id}: ${r.text}`, ...(hints ? [`  hint: ${failed.get(r.id)}`] : []), `  read: ${r.read}`]
      : [`not reached ${r.id}: ${r.text}`]));
  if (!hints && ask && failed.size) lines.push(`hints: ./check --hints ${n}`);
  return lines;
}

// The one lessons/NNNN-*.html of a task: { lesson } (its id) or { problem }.
export function taskLesson(ws, nnnn) {
  const dir = join(ws, 'lessons');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.html') && f.startsWith(`${nnnn}-`) && LESSON_ID_RE.test(f.slice(0, -5))) : [];
  return files.length === 1 ? { lesson: files[0].slice(0, -5) } : { problem: `${files.length ? 'more than one' : 'no'} lessons/${nnnn}-*.html` };
}

// One run of a task's checker read against its file: { requirements, parsed } or { problem }; a problem with the
// checker's output carries its last non-empty stderr line.
export async function checkTask(ws, nnnn, { err, env = process.env, runner = runChecker }) {
  const { timeout, requirements, problems } = readRequirements(ws, nnnn);
  if (problems.length) return { problem: problems[0] };
  try { err(`check: evidence/${nnnn}/check.sh`); } catch { /* The announcement is best effort. */ }
  const run = await runner(ws, nnnn, { timeoutMs: timeout * 1000, env });
  if (run.problem) return run;
  const parsed = parseChecker(requirements, run);
  if (!parsed.problem) return { requirements, parsed };
  const last = run.stderr.split('\n').map((l) => l.trim()).filter(Boolean).at(-1)?.replace(new RegExp(LAB_TEXT_BAD_RE, 'gu'), '?');
  return { problem: last ? `${parsed.problem}; stderr: ${last}` : parsed.problem };
}

// Issue 79 D8: an open certification run's state, at the workspace root; its end renames it to ENDING_FILE while it
// writes the attempts, and removes that file after them.
export const RUN_FILE = '.teach-certify.json';
export const ENDING_FILE = '.teach-certify.ending.json';
const RUN_KEYS = ['id', 'started', 'tasks', 'minutes', 'pass', 'hints'];
const RUN_ID_RE = /^c-\d{8}-\d{6}$/;
const RUN_BAD = `${RUN_FILE} is not a certification run; drop it with ./check --cancel`;
const OPEN_TAIL = 'end: ./check --certify; drop: ./check --cancel';
const inRange = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
function checkRunFile(ws, name) {
  const file = join(ws, name);
  try {
    const entry = lstatSync(file, { throwIfNoEntry: false });
    if ((!entry || entry.isFile()) && isInsideVault(ws, file)) return entry;
  } catch { /* refuse an unreadable workspace state name */ }
  throw Object.assign(new Error(`${name}: cannot use as a regular workspace state file. Remove it by hand.`), { code: VAULT_PATH_OUTSIDE });
}

const runIdIn = (file) => { try { const id = JSON.parse(readFileSync(file, 'utf8'))?.id; return RUN_ID_RE.test(id) ? id : null; } catch { return null; } };
const endingProblem = (id) => (id ? `an end of certification run ${id} did not finish; ./check --cancel removes it and the attempts it wrote`
  : 'an end of a certification run did not finish; attempts of the run may be recorded; ./check --cancel removes it');
// The attempts/*.md files whose certification is `id`.
const runAttempts = (ws, dir, id) => {
  return (existsSync(dir) ? readdirSync(dir) : []).filter((f) => f.endsWith('.md')).map((f) => join(dir, f)).filter((f) => {
    assertInsideWorkspaceFolder(ws, dir, f);
    try { return parseFrontmatter(readFileSync(f, 'utf8')).data.certification === id; } catch { return false; }
  });
};
const minutesOf = (s, now) => (s.started ? Math.max(0, Math.floor((now.getTime() - Date.parse(s.started)) / 60000)) : 0);

// {} with no run, { state } for an open run, or { problem } (naming --cancel) for an end that did not finish or a
// state file that is not a run.
export function readRun(ws) {
  const open = checkRunFile(ws, RUN_FILE);
  if (checkRunFile(ws, ENDING_FILE)) return { problem: endingProblem(runIdIn(join(ws, ENDING_FILE))) };
  if (!open) return {};
  let s;
  try { s = JSON.parse(readFileSync(join(ws, RUN_FILE), 'utf8')); } catch (e) { return e.code === 'ENOENT' ? {} : { problem: RUN_BAD }; }
  const ok = isObject(s) && Object.keys(s).length === RUN_KEYS.length && RUN_KEYS.every((k) => Object.hasOwn(s, k)) && RUN_ID_RE.test(s.id)
    && (s.started === null || (typeof s.started === 'string' && !Number.isNaN(Date.parse(s.started))))
    && Array.isArray(s.tasks) && s.tasks.length > 0 && s.tasks.every((t) => /^\d{4}$/.test(t)) && new Set(s.tasks).size === s.tasks.length
    && (s.minutes === null || inRange(s.minutes, 1, 1440)) && (s.pass === null || inRange(s.pass, 1, 100)) && typeof s.hints === 'boolean';
  return ok ? { state: s } : { problem: RUN_BAD };
}

// The last line of a check of a task in an open run, and teach next's line for the open run.
export const runLine = (s, now) => `certification run ${s.id}: ${minutesOf(s, now)} minutes${s.minutes ? ` of ${s.minutes}` : ''}; ${OPEN_TAIL}`;
export const openLine = (s, now) => `certification: open ${s.id}, tasks ${s.tasks.join(', ')}, ${minutesOf(s, now)} minutes${s.minutes ? ` of ${s.minutes}` : ''}${s.hints ? '' : ', hints held back'}`;

// A task can be in a run: its evidence folder, one lesson file, a valid requirements.json and the three scripts, with
// setup.sh and check.sh executable. Null, or the problem.
function taskProblem(ws, nnnn) {
  if (!statSync(join(ws, 'evidence', nnnn), { throwIfNoEntry: false })?.isDirectory()) return `no evidence/${nnnn}/ folder`;
  const l = taskLesson(ws, nnnn);
  if (l.problem) return l.problem;
  const { problems } = readRequirements(ws, nnnn);
  if (problems.length) return problems[0];
  for (const name of ['setup.sh', 'check.sh', 'solution.sh']) {
    const f = join(ws, 'evidence', nnnn, name);
    if (!statSync(f, { throwIfNoEntry: false })?.isFile()) return `evidence/${nnnn}/${name} is missing`;
    if (name !== 'solution.sh') try { accessSync(f, constants.X_OK); } catch { return `evidence/${nnnn}/${name} is not executable`; }
  }
  return null;
}

// D8's start. `nums` are the lesson numbers as given; `minutes` and `pass` are null when not given, else the value as
// given. Every check runs before the state is written; the state is created with the flag that fails when it exists,
// with started null; each setup.sh runs in order; then started is the clock after the last setup. A setup that does
// not exit 0 removes the state. `io` holds the clock and the two line printers.
export async function startRun(ws, nums, { minutes, pass, hints }, { now, out, err, env = process.env, setup = runSetup }) {
  const refuse = (why) => { err(`teach check: ${why}`); return 2; };
  const tasks = nums.map((n) => n.padStart(4, '0'));
  const twice = tasks.find((t, i) => tasks.indexOf(t) !== i);
  if (twice) return refuse(`${twice} is given twice`);
  const whole = (v, lo, hi) => (v === null ? null : /^\d+$/.test(String(v)) && inRange(Number(v), lo, hi) ? Number(v) : undefined);
  const M = whole(minutes, 1, 1440), P = whole(pass, 1, 100);
  if (M === undefined) return refuse('--minutes must be a whole number from 1 to 1440');
  if (P === undefined) return refuse('--pass must be a whole number from 1 to 100');
  for (const t of tasks) {
    const p = taskProblem(ws, t);
    if (p) return refuse(`${t}: ${p}`);
  }
  const file = join(ws, RUN_FILE);
  const open = readRun(ws);
  if (open.problem) return refuse(open.problem);
  const t0 = now().toISOString();
  // ponytail: the id changes once a second, so two runs started and ended within one second share an id and
  // certificationRuns merges them, and a --cancel of the second's stopped end removes the first's attempts too; the fix
  // is a suffix when attempts already hold the id.
  const state = { id: `c-${t0.slice(0, 10).replaceAll('-', '')}-${t0.slice(11, 19).replaceAll(':', '')}`, started: null, tasks, minutes: M, pass: P, hints };
  try {
    checkRunFile(ws, RUN_FILE);
    writeFileSync(file, JSON.stringify(state) + '\n', { flag: 'wx' });
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    const r = readRun(ws);
    return refuse(r.state ? `certification run ${r.state.id} is open; ${OPEN_TAIL}` : r.problem ?? 'a certification run is open');
  }
  const reset = [];
  for (const t of tasks) {
    out(`setup: evidence/${t}/setup.sh`);
    const r = await setup(ws, t, { env });
    if (r.problem || r.code !== 0) {
      checkRunFile(ws, RUN_FILE);
      rmSync(file, { force: true });
      return refuse(`${t}: ${r.problem ?? `setup.sh exited ${r.code}`}; no run started; scopes already reset: ${reset.join(', ') || 'none'}`);
    }
    reset.push(t);
  }
  // A --cancel during a setup removed the state: the start does not write it again.
  checkRunFile(ws, RUN_FILE);
  if (runIdIn(file) !== state.id) return refuse(`certification run ${state.id} was dropped during its setup; no run started; scopes already reset: ${reset.join(', ')}`);
  state.started = now().toISOString();
  checkRunFile(ws, RUN_FILE);
  writeFileSync(file, JSON.stringify(state) + '\n');
  out(`certification run ${state.id}: started`);
  out(`tasks: ${tasks.map((t) => taskLesson(ws, t).lesson).join(', ')}`);
  out(`requirements: ${tasks.reduce((n, t) => n + readRequirements(ws, t).requirements.length, 0)}`);
  if (M) out(`time limit: ${M} minutes`);
  if (P) out(`pass line: ${P}%`);
  out(`hints: ${hints ? 'not held back' : 'held back'}`);
  out('check a task: ./check <N>');
  out('end and grade: ./check --certify');
  out('drop, recording nothing: ./check --cancel');
  return 0;
}

// D8's end. Every task's checker runs first; a problem in any keeps the run open and writes nothing. Then the state is
// renamed to ENDING_FILE, one attempt is written for each task with the run id, the renamed file is removed, and the
// grade is printed. The grade counts each requirement once, an unreached one as not met.
export async function endRun(ws, schema, { now, out, err, env = process.env, checker = (workspace, task) => checkTask(workspace, task, { err, env }) }) {
  const refuse = (why) => { err(`teach check: ${why}`); return 2; };
  const none = 'no certification run is open; start one with ./check --start <N>';
  const r = readRun(ws);
  if (r.problem) return refuse(r.problem);
  if (!r.state) return refuse(none);
  const s = r.state;
  if (s.started === null) return refuse(`certification run ${s.id} has not started: its start did not finish; ./check --cancel removes it`);
  const graded = [];
  for (const t of s.tasks) {
    const l = taskLesson(ws, t);
    const c = l.problem ? l : await checker(ws, t, env);
    if (c.problem) return refuse(`${t}: ${c.problem}; certification run ${s.id} is still open; ${OPEN_TAIL}`);
    graded.push({ nnnn: t, lesson: l.lesson, ...c });
  }
  const end = now();
  // Check every attempt destination before changing the run state.
  for (const g of graded) nextAttemptId(ws, g.lesson, end);
  const file = join(ws, RUN_FILE), ending = join(ws, ENDING_FILE);
  try {
    checkRunFile(ws, RUN_FILE);
    checkRunFile(ws, ENDING_FILE);
    renameSync(file, ending);
  } catch (e) {
    if (e.code === 'ENOENT') return refuse(none);
    throw e;
  }
  for (const g of graded) writeAttempt(ws, { lesson: g.lesson, task: checkAttempt(g.requirements, g.parsed, s.id), now: end }, schema);
  checkRunFile(ws, ENDING_FILE);
  rmSync(ending, { force: true });
  const okOf = (g) => g.parsed.passed.length;
  const ok = graded.reduce((n, g) => n + okOf(g), 0), total = graded.reduce((n, g) => n + g.requirements.length, 0);
  for (const g of graded) out(`${g.lesson}: ${okOf(g)} of ${g.requirements.length}`);
  out(`grade: ${ok} of ${total} requirements`);
  if (s.pass) out(`pass line ${s.pass}%: ${ok * 100 >= s.pass * total ? 'met' : 'not met'}`);
  const m = minutesOf(s, end);
  out(`time: ${m} minutes${!s.minutes ? '' : m <= s.minutes ? ` (limit ${s.minutes})` : `, ${m - s.minutes} over the limit of ${s.minutes}`}`);
  const hints = missionPrefs(ws).hints === 'always';
  for (const g of graded) for (const line of [`${g.lesson}:`, ...reportLines(g.requirements, g.parsed, { hints, n: Number(g.nnnn) })]) out(line);
  return 0;
}

// D8's cancel: an end that did not finish is removed first, with the attempts it wrote, so a stopped end leaves no
// part of a grade (with no run id in the file, they cannot be found, and it says attempts may be recorded); else the
// state is removed, and nothing was recorded. Exit 2 with neither.
export function cancelRun(ws, { out, err }) {
  const ending = join(ws, ENDING_FILE), file = join(ws, RUN_FILE);
  const open = checkRunFile(ws, RUN_FILE);
  if (checkRunFile(ws, ENDING_FILE)) {
    const id = runIdIn(ending);
    const dir = join(ws, 'attempts');
    if (id) assertInsideWorkspaceFolder(ws, dir);
    const written = id ? runAttempts(ws, dir, id) : [];
    for (const f of written) {
      assertInsideWorkspaceFolder(ws, dir, f);
      rmSync(f, { force: true });
    }
    checkRunFile(ws, ENDING_FILE);
    rmSync(ending, { force: true });
    out(id ? `removed the end of certification run ${id} that did not finish and the ${written.length} attempt${written.length === 1 ? '' : 's'} it wrote; nothing of the run is recorded`
      : 'removed the end of a certification run that did not finish; attempts of the run may be recorded');
    return 0;
  }
  if (!open) { err('teach check: no certification run is open'); return 2; }
  const id = runIdIn(file);
  checkRunFile(ws, RUN_FILE);
  rmSync(file, { force: true });
  out(id ? `dropped certification run ${id}; nothing was recorded` : `dropped ${RUN_FILE}; nothing was recorded`);
  return 0;
}
