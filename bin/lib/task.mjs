// Issue 79 D3, D4: a checked task's requirements file, the run of its checker for `teach check`, the checker's output
// read against the file, and the lines `teach check` prints. The checker is started here, not by labs.mjs's launch,
// which needs a pin (R12).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { LAB_TEXT_BAD_RE, LAB_OUTPUT_MAX, STOP_GRACE, KILL_WAIT, stopGroup } from './labs.mjs';
import { show, RECORD_ID_RE } from './teach.mjs';

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
    if (!m) continue;
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
export function runChecker(ws, nnnn, { timeoutMs, env = process.env, limits = {} }) {
  const L = { STOP_GRACE, KILL_WAIT, OUTPUT_MAX: LAB_OUTPUT_MAX, ...limits };
  const cannot = (e) => ({ problem: `check.sh could not start (${e.code ?? e.message})` });
  let child;
  try {
    child = spawn(join(ws, 'evidence', nnnn, 'check.sh'), [], { cwd: ws, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) { return Promise.resolve(cannot(e)); }
  // A file that cannot be executed (EACCES, ENOENT) gives no pid and an error event.
  if (child.pid === undefined) return new Promise((done) => child.once('error', (e) => done(cannot(e))));
  return new Promise((done) => {
    const pgid = child.pid;
    const out = { stdout: [], stderr: [] };
    let size = 0, why = null, code = null, stopping = null;
    const stop = (reason) => { why ??= reason; return (stopping ??= stopGroup(pgid, L)); };
    const timer = setTimeout(() => stop(`ran past ${timeoutMs / 1000} seconds`), timeoutMs);
    const onSignal = ['SIGINT', 'SIGTERM', 'SIGHUP'].map((sig) => [sig, () => stop(`stopped by ${sig}`)]);
    for (const [sig, f] of onSignal) process.on(sig, f);
    for (const name of ['stdout', 'stderr']) {
      child[name].on('data', (b) => {
        if (why) return;
        if ((size += b.length) > L.OUTPUT_MAX) stop('output past 1 MiB');
        else out[name].push(b);
      });
    }
    child.on('exit', (c, sig) => {
      clearTimeout(timer);
      code = c ?? sig;
      // The rest of the group goes too; a process that left the group can hold a pipe open, so stop waiting for close.
      stop(null).then(() => setTimeout(() => [child.stdout, child.stderr].forEach((s) => s.destroy()), 200).unref());
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

// D4's lines, one requirement after another in file order; with `hints` false and a failure, a last line on how to ask.
export function reportLines(requirements, parsed, { hints, n }) {
  const failed = new Map(parsed.failed.map((f) => [f.id, f.hint]));
  const lines = requirements.flatMap((r) => (parsed.passed.includes(r.id) ? [`ok ${r.id}: ${r.text}`]
    : failed.has(r.id) ? [`FAIL ${r.id}: ${r.text}`, ...(hints ? [`  hint: ${failed.get(r.id)}`] : []), `  read: ${r.read}`]
      : [`not reached ${r.id}: ${r.text}`]));
  if (!hints && failed.size) lines.push(`hints: ./check --hints ${n}`);
  return lines;
}
