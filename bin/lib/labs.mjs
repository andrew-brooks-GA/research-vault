// Spec 49: the lab manifest `labs/labs.json`, its reader and the pins (D1, D2), and the runner (D4 to D7). This is
// the one file that imports node:child_process, and `launch` the one function that calls spawn.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { isInsideVault } from './containment.mjs';
import { parseBlocks } from './lesson.mjs';
import { show, LESSON_ID_RE } from './teach.mjs';

export const LAB_ID_RE = /^[a-z][a-z0-9-]{0,39}$/;
export const LAB_ROOTS = ['labs/', 'evidence/', 'lessons/files/'];
export const LAB_MANIFEST = 'labs/labs.json';
export const LAB_COST_MAX = 200;
export const LAB_TIMEOUT_MAX = 7200;
export const LAB_CHECKS_MAX = 10;
const PATH_RE = /^[A-Za-z0-9._/-]+$/;
const ENV_RE = /^[A-Z_][A-Z0-9_]*$/;
const HEX_RE = /^[0-9a-f]{64}$/;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const keysOk = (o, required, optional = []) => Object.keys(o).every((k) => required.includes(k) || optional.includes(k)) && required.every((k) => Object.hasOwn(o, k));
// A cost or check message: 1 to max characters, none of them a control, line-separator or bidi character.
export const LAB_TEXT_BAD_RE = /[\p{Cc}\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const text = (v, max) => typeof v === 'string' && v.length >= 1 && v.length <= max && !LAB_TEXT_BAD_RE.test(v);

export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

// A script path's problem, or null: the pattern, no empty or dot segment, one of the three roots, the root inside
// the workspace (a symlinked root leading out is refused), the script inside its root and a regular file (lstat).
function scriptProblem(ws, path) {
  if (typeof path !== 'string' || !PATH_RE.test(path)) return 'does not match ^[A-Za-z0-9._/-]+$';
  if (path.split('/').some((s) => s === '' || s.startsWith('.'))) return 'has an empty segment or one starting with .';
  const root = LAB_ROOTS.find((r) => path.startsWith(r));
  if (!root) return `is not under ${LAB_ROOTS.join(', ')}`;
  if (!isInsideVault(ws, join(ws, root))) return `has a root, ${root}, that resolves outside the workspace`;
  if (!isInsideVault(join(ws, root), join(ws, path))) return `resolves outside ${root}`;
  const st = lstatSync(join(ws, path), { throwIfNoEntry: false });
  if (!st?.isFile()) return st?.isSymbolicLink() ? 'is a symlink' : 'is not a regular file';
  return null;
}

// D1: the validated manifest, its keys in the order the spec lists them; a missing file is a manifest with no labs.
// Throws with one line per problem.
export function readLabs(ws) {
  const file = join(ws, LAB_MANIFEST);
  const st = lstatSync(file, { throwIfNoEntry: false });
  if (!st) return { version: 1, labs: {} };
  const problems = [];
  const fail = () => { const e = new Error(problems.join('\n')); e.problems = problems; throw e; };
  if (!st.isFile() || !isInsideVault(ws, file)) { problems.push(`${LAB_MANIFEST} is not a regular file inside the workspace`); fail(); }
  let raw, doc;
  try { raw = readFileSync(file, 'utf8'); } catch { problems.push(`${LAB_MANIFEST} cannot be read`); fail(); }
  try { doc = JSON.parse(raw); } catch { problems.push(`${LAB_MANIFEST} is not JSON`); fail(); }
  if (!isObject(doc) || !keysOk(doc, ['version', 'labs'])) problems.push('the top level must have exactly version and labs');
  if (doc?.version !== 1) problems.push('version must be 1');
  if (!isObject(doc?.labs)) { problems.push('labs must be an object'); fail(); }
  const labs = {};
  for (const [id, e] of Object.entries(doc.labs)) {
    const at = LAB_ID_RE.test(id) ? `lab ${id}` : `lab ${show(id)}`;
    const add = (p) => problems.push(`${at}: ${p}`);
    if (!LAB_ID_RE.test(id)) { add('the id does not match ^[a-z][a-z0-9-]{0,39}$'); continue; }
    if (!isObject(e)) { add('must be an object'); continue; }
    if (!keysOk(e, ['cost', 'timeout', 'up', 'down'], ['env', 'checks', 'verify'])) add('must have cost, timeout, up and down, and may have env, checks and verify, and nothing else');
    if (!text(e.cost, LAB_COST_MAX)) add(`cost must be 1 to ${LAB_COST_MAX} characters, with no control, line-separator or bidi character`);
    if (!(Number.isInteger(e.timeout) && e.timeout >= 1 && e.timeout <= LAB_TIMEOUT_MAX)) add(`timeout must be whole seconds, 1 to ${LAB_TIMEOUT_MAX}`);
    if (e.env !== undefined && !(Array.isArray(e.env) && e.env.every((n) => typeof n === 'string' && ENV_RE.test(n)) && new Set(e.env).size === e.env.length)) {
      add('env must be distinct names matching ^[A-Z_][A-Z0-9_]*$');
    }
    const command = (c, name, extra = []) => {
      if (!isObject(c) || !keysOk(c, ['script', 'sha256', ...extra])) return add(`${name} must have exactly script, sha256${extra.map((k) => `, ${k}`).join('')}`);
      const p = scriptProblem(ws, c.script);
      if (p) add(`${name} ${typeof c.script === 'string' && PATH_RE.test(c.script) ? c.script : 'script'} ${p}`);
      if (typeof c.sha256 !== 'string' || !HEX_RE.test(c.sha256)) add(`${name} sha256 must be 64 lowercase hex characters`);
    };
    if (e.checks !== undefined) {
      if (!Array.isArray(e.checks) || e.checks.length > LAB_CHECKS_MAX) add(`checks must be a list of at most ${LAB_CHECKS_MAX}`);
      else e.checks.forEach((c, i) => {
        command(c, `check ${i + 1}`, ['message']);
        if (isObject(c) && !text(c.message, LAB_COST_MAX)) add(`check ${i + 1} message must be 1 to ${LAB_COST_MAX} characters, with no control, line-separator or bidi character`);
      });
    }
    for (const k of ['up', 'down', 'verify']) if (k !== 'verify' || e.verify !== undefined) command(e[k], k);
    const pick = (c, ks) => Object.fromEntries(ks.map((k) => [k, c[k]]));
    labs[id] = {
      cost: e.cost, timeout: e.timeout,
      ...(e.env !== undefined ? { env: e.env } : {}),
      ...(Array.isArray(e.checks) ? { checks: e.checks.map((c) => pick(c ?? {}, ['script', 'sha256', 'message'])) } : {}),
      up: pick(e.up ?? {}, ['script', 'sha256']), down: pick(e.down ?? {}, ['script', 'sha256']),
      ...(e.verify !== undefined ? { verify: pick(e.verify ?? {}, ['script', 'sha256']) } : {}),
    };
  }
  if (problems.length) fail();
  return { version: 1, labs };
}

// D2: the lab's pin, SHA-256 hex of JSON.stringify([id, lab]) with the entry as readLabs returns it.
export const labPin = (id, lab) => sha256(JSON.stringify([id, lab]));

// The scripts an action hashes before it runs (D2): run, each check then up; reset, down; verify, verify; stop, none.
export const actionScripts = (lab, action) =>
  (action === 'run' ? [...(lab.checks ?? []), lab.up] : action === 'reset' ? [lab.down] : action === 'verify' ? [lab.verify] : []);

// D2: the lab block parseBlocks returns, the one the gate hashes: data-lab from its opening tag, and the value of
// the first <data> element of class lab-pin in its inner HTML; nothing else on the page counts. null with no lab block.
// An attribute's value, the attributes read in order with each quoted value skipped whole, so a name inside another
// attribute's value is not read; '' for a bare attribute, null when absent.
const attrOf = (attrs, name) => {
  for (const m of attrs.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) if (m[1].toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? '';
  return null;
};
export function lessonLab(html) {
  const b = parseBlocks(html).get('lab');
  if (!b) return null;
  const id = attrOf(b.attrs, 'data-lab');
  const tag = [...b.html.matchAll(/<data\b([^>]*)>/gi)].map((m) => m[1]).find((a) => attrOf(a, 'class') === 'lab-pin');
  const pin = tag === undefined ? null : attrOf(tag, 'value') ?? '';
  return { id, pin, start: b.start, html: b.html };
}

// D4: the lab routes, the request body cap and the cookie that carries the session value.
export const LAB_ACTIONS = ['run', 'stop', 'reset', 'verify'];
export const LAB_BODY_MAX = 256;
export const labCookie = (port) => `rv-labs-${port}`;

// Check 9: a regular file lessons/<lesson id>.html whose lab block names `id` and stores `pin`.
function lessonStoresPin(ws, id, pin) {
  const dir = join(ws, 'lessons');
  let names = [];
  try { names = readdirSync(dir).filter((f) => f.endsWith('.html') && LESSON_ID_RE.test(f.slice(0, -5))); } catch { return false; }
  return names.some((f) => {
    try {
      if (!lstatSync(join(dir, f)).isFile()) return false;
      const l = lessonLab(readFileSync(join(dir, f), 'utf8'));
      return l?.id === id && l.pin === pin;
    } catch { return false; }
  });
}

// D4 checks 6 to 13, in order, for a lab id that passed check 5; every file is read synchronously, so the checks
// happen in one turn, and the caller takes the slot in that same turn. `jobs` are the actions running now (check 12
// and 13). [status, body] of the first that fails, else [200, lab].
// Check 13's set: the lab's running run (any phase) and verify; Reset's down cannot be stopped from the page.
const stoppable = (j, id) => j.id === id && j.action !== 'reset';
const stoppedLine = (gone) => `lab: stopped${gone ? '' : ' (processes remain)'}`;
export function labRefusal(ws, action, id, env, jobs = []) {
  let labs;
  try { ({ labs } = readLabs(ws)); } catch { return [500, 'labs/labs.json is invalid; run teach lint']; }
  if (!Object.hasOwn(labs, id)) return [404, 'no lab'];
  const lab = labs[id];
  if (action === 'verify' && !lab.verify) return [404, 'no verify'];
  if (action === 'stop') return jobs.some((j) => stoppable(j, id)) ? [200, lab] : [409, 'not running'];
  if (!lessonStoresPin(ws, id, labPin(id, lab))) return [409, "no lesson stores this lab's current pin"];
  for (const c of actionScripts(lab, action)) {
    let actual = null;
    try { actual = sha256(readFileSync(join(ws, c.script))); } catch { /* unreadable: a mismatch */ }
    if (actual !== c.sha256) return [409, `pin mismatch: ${c.script}`];
  }
  for (const name of lab.env ?? []) {
    const v = env[name];
    if (typeof v !== 'string' || v.length < 8 || /[\r\n]/.test(v)) return [409, `env ${name} is unset, shorter than 8 characters or multi-line`];
  }
  // Check 12: verify may run beside this lab's up, and nothing else beside anything.
  const busy = jobs.find((j) => !(action === 'verify' && j.id === id && j.action === 'run' && j.phase === 'up'));
  if (busy) return [409, `busy: ${busy.id} ${busy.action}`];
  return [200, lab];
}

// D5 limits, in milliseconds and bytes; createServer's `limits` option replaces any of them (tests pass smaller ones).
export const STOP_GRACE = 5000;
export const KILL_WAIT = 2000;
export const CHECK_TIMEOUT = 10000;
export const LAB_OUTPUT_MAX = 1024 * 1024;
export const LAB_LINE_MAX = 65536;
const POLL = 20;
// D5: the names a script gets from the server's environment, when set, besides the lab's own `env` names.
export const LAB_ENV_ALLOW = ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'TMPDIR', 'LANG', 'LC_ALL'];
export const labEnv = (env, lab) =>
  Object.fromEntries([...new Set([...LAB_ENV_ALLOW, ...(lab.env ?? [])])].filter((k) => typeof env[k] === 'string').map((k) => [k, env[k]]));

// D6: one output stream's lines. write() decodes with a streaming UTF-8 decoder and passes on each complete line;
// end() the final partial one. In a line every character inside any match of any value is marked, and each run of
// marked characters becomes one [redacted], so overlapping or nested values leave nothing of either. The line is
// then cut at \r, and a piece that starts with lab: once its escape sequences and invisible characters are set aside
// gets "> " in front, so a script never writes a line that reads "lab: ". A line over `lineMax` characters is
// dropped, with the rest of it up to the next \n, and one line of the server's own (emit's second argument true)
// said in its place.
export const LONG_LINE = `lab: a line over ${LAB_LINE_MAX} characters is not shown`;
// What the "lab:" test sets aside (the output keeps it): ESC sequences (CSI, OSC to BEL or ST, and two-character
// ones), C0 controls but tab, DEL, C1, zero-width, bidi, word-joiner and BOM characters.
const INVISIBLE_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[\s\S]?|[\x00-\x08\x0a-\x1f\x7f-\x9f\u200b-\u200f\u2028-\u202e\u2060-\u2064\u2066-\u2069\ufeff]/g;
export function redactLine(l, values) {
  const marked = new Uint8Array(l.length);
  for (const v of values) for (let i = l.indexOf(v); i !== -1; i = l.indexOf(v, i + 1)) marked.fill(1, i, i + v.length);
  let out = '';
  for (let i = 0; i < l.length;) {
    let j = i;
    while (j < l.length && marked[j] === marked[i]) j++;
    out += marked[i] ? '[redacted]' : l.slice(i, j);
    i = j;
  }
  return out;
}
export function lineRedactor(values, emit, lineMax = LAB_LINE_MAX) {
  const dec = new StringDecoder('utf8');
  let buf = '', skip = false;
  const line = (l) => {
    redactLine(l, values).split('\r').forEach((p, i) => {
      if (i === 0 || p !== '') emit(p.replace(INVISIBLE_RE, '').startsWith('lab:') ? `> ${p}` : p, false);
    });
  };
  const take = (text) => {
    if (skip) {
      const i = text.indexOf('\n');
      if (i === -1) return;
      skip = false;
      text = text.slice(i + 1);
    }
    const parts = (buf + text).split('\n');
    buf = parts.pop();
    for (const p of parts) (p.length > lineMax ? emit(LONG_LINE, true) : line(p));
    if (buf.length > lineMax) { emit(LONG_LINE, true); skip = true; buf = ''; }
  };
  return {
    write: (chunk) => take(dec.write(chunk)),
    end: () => {
      take(dec.end());
      if (buf !== '') line(buf);
      buf = '';
    },
  };
}

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// A process group still has a member: signal 0 to it succeeds (EPERM: it exists, so it counts).
const groupAlive = (pgid) => { try { process.kill(-pgid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
const signalGroup = (pgid, sig) => { try { process.kill(-pgid, sig); } catch { /* the group is gone */ } };
// D5's Stop sequence on one group: SIGTERM; SIGKILL once STOP_GRACE has passed with the group still there; then at
// most KILL_WAIT for it to go, polled every 20 ms. True when the group is gone. Every signal goes to the group.
async function stopGroup(pgid, L) {
  signalGroup(pgid, 'SIGTERM');
  for (const end = Date.now() + L.STOP_GRACE; groupAlive(pgid) && Date.now() < end;) await sleep(POLL);
  if (!groupAlive(pgid)) return true;
  signalGroup(pgid, 'SIGKILL');
  for (const end = Date.now() + L.KILL_WAIT; groupAlive(pgid) && Date.now() < end;) await sleep(POLL);
  return !groupAlive(pgid);
}

// D5 start: the one spawn. The script's path is checked against readLabs' rules and its bytes hashed against the pin
// here, immediately before it starts; it runs by its absolute path, no shell, no argument, from the workspace root,
// stdin ignored, leading a process group of its own, with only `env`. { child }, or { error } with the line's text.
// A script whose first two bytes are not #! is refused here, before spawn, as lint's LAB_SCRIPT_NOT_RUNNABLE does.
function launch(ws, cmd, env) {
  let bytes = null;
  try { if (!scriptProblem(ws, cmd.script)) bytes = readFileSync(join(ws, cmd.script)); } catch { /* a mismatch */ }
  if (bytes === null || sha256(bytes) !== cmd.sha256) return { error: `not started, pin mismatch: ${cmd.script}` };
  if (bytes.subarray(0, 2).toString('latin1') !== '#!') return { error: 'could not start: ENOEXEC' };
  try {
    return { child: spawn(join(ws, cmd.script), [], { cwd: ws, env, shell: false, detached: true, stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    return { error: `could not start: ${e.code ?? 'error'}` };
  }
}

// Runs one script of a job to its end. Its output goes line by line through the redactor to `put` (or is read and
// dropped when `put` is null). At `ms`, or when the job is stopped, its group gets the Stop sequence; when the leader
// exits first, the rest of its group gets it. Resolves after close, once both streams' final lines are out:
// { error } or { code, timedOut, stopped (the Stop sequence began before the leader exited), gone }.
function runScript(job, ws, cmd, env, ms, put, values, L) {
  const { child, error } = launch(ws, cmd, env);
  if (error) return Promise.resolve({ error });
  // A file that cannot be executed (EACCES, ENOENT) gives no pid and an error event.
  if (child.pid === undefined) return new Promise((done) => child.once('error', (e) => done({ error: `could not start: ${e.code ?? 'error'}` })));
  return new Promise((done) => {
    const pgid = child.pid;
    job.pgid = pgid;
    let timedOut = false, exited = false, stopped = false, code = null, finished = false;
    job.halt = () => { if (!exited) stopped = true; return (job.stopping ??= stopGroup(pgid, L)); };
    const streams = [child.stdout, child.stderr];
    const lines = streams.map((s) => {
      if (!put) { s.resume(); return null; }
      const r = lineRedactor(values, put);
      s.on('data', r.write);
      return r;
    });
    const timer = setTimeout(() => { timedOut = true; job.halt(); }, ms);
    const finish = async (result) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      for (const r of lines) r?.end();
      const gone = job.stopping ? await job.stopping : true;
      job.pgid = null;
      job.halt = null;
      job.stopping = null;
      done({ ...result, gone });
    };
    child.on('exit', (c, sig) => {
      clearTimeout(timer);
      exited = true; // from here halt() runs the sequence on the rest of the group, and does not count as a stop
      code = c ?? sig;
      // A process that left the group can hold a pipe open; once the group is gone, stop waiting for close.
      job.halt().then(() => setTimeout(() => streams.forEach((s) => s.destroy()), 200).unref());
    });
    child.on('close', () => finish({ code, timedOut, stopped }));
  });
}

// The runner of one `teach serve --labs` server: `post` answers a lab POST that passed checks 1 to 5, `stopAll`
// runs the Stop sequence on every running group (SIGINT, SIGTERM, SIGHUP), and `killAll` sends SIGKILL to each (exit).
export function labRunner(ws, { env, log, limits = {} }) {
  const L = { STOP_GRACE, KILL_WAIT, CHECK_TIMEOUT, LAB_OUTPUT_MAX, ...limits };
  const jobs = [];
  let closing = false;
  const reply = (res) => res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
  const out = (res, s) => { if (!res.destroyed && !res.writableEnded) res.write(`${s}\n`); };
  // At most LAB_OUTPUT_MAX bytes of script output per reply, then one line; the rest is read and dropped.
  const capped = (res) => {
    let sent = 0, over = false;
    return (s, own) => {
      if (over) return;
      if (!own && (sent += Buffer.byteLength(s) + 1) > L.LAB_OUTPUT_MAX) { over = true; s = 'lab: output over 1 MiB not shown'; }
      out(res, s);
    };
  };
  const stopJob = (job, reason) => {
    job.reason ??= reason;
    return job.halt ? job.halt() : Promise.resolve(true);
  };

  async function steps(job, lab, res, put, values, runEnv) {
    const ms = lab.timeout * 1000;
    const ending = (r, verify) => {
      if (r.error) return `lab: ${r.error}`;
      if (verify) return r.timedOut ? 'lab: verify fail (timed out)' : r.stopped ? 'lab: verify fail (stopped)' : r.code === 0 ? 'lab: verify pass' : `lab: verify fail (exit ${r.code})`;
      return r.timedOut ? `lab: timed out after ${lab.timeout} s` : r.stopped ? stoppedLine(r.gone) : `lab: exit ${r.code}`;
    };
    if (job.action === 'reset') return ending(await runScript(job, ws, lab.down, runEnv, ms, put, values, L));
    if (job.action === 'verify') return ending(await runScript(job, ws, lab.verify, runEnv, ms, put, values, L), true);
    let failed = 0;
    for (const [i, c] of (lab.checks ?? []).entries()) {
      if (job.reason) return 'lab: stopped';
      const r = await runScript(job, ws, c, runEnv, L.CHECK_TIMEOUT, null, values, L);
      if (r.error?.startsWith('not started')) return `lab: ${r.error}`;
      if (r.stopped && !r.timedOut) return stoppedLine(r.gone);
      const ok = !r.error && !r.timedOut && r.code === 0;
      if (!ok) failed++;
      out(res, ok ? `lab: check ${i + 1} ok` : `lab: check ${i + 1} failed: ${c.message}`);
    }
    if (failed) return `lab: not started, ${failed} check(s) failed`;
    if (job.reason) return 'lab: stopped';
    job.phase = 'up';
    return ending(await runScript(job, ws, lab.up, runEnv, ms, put, values, L));
  }

  // Checks 6 to 13 and taking the slot, in one turn (nothing here awaits before the slot is taken and the first script
  // spawned). [status, body] of a refusal, or undefined when this function has taken the reply.
  function post(action, id, res) {
    if (closing) return [503, 'the server is stopping'];
    const [status, lab] = labRefusal(ws, action, id, env, jobs);
    if (status !== 200) return [status, lab];
    reply(res);
    if (action === 'stop') {
      Promise.all(jobs.filter((j) => stoppable(j, id)).map((j) => stopJob(j, 'stopped'))).then((gone) => {
        const line = stoppedLine(gone.every(Boolean));
        log(`lab ${id} stop: 200 ${line}`);
        res.end(`${line}\n`);
      });
      return undefined;
    }
    const job = { id, action, phase: action === 'run' ? 'checks' : action, reason: null, pgid: null, halt: null, stopping: null };
    jobs.push(job);
    // The page closing stops its action, except down, which runs to its end.
    if (action !== 'reset') res.on('close', () => { if (!res.writableFinished) stopJob(job, 'closed'); });
    const values = (lab.env ?? []).map((n) => env[n]);
    steps(job, lab, res, capped(res), values, labEnv(env, lab)).then((line) => {
      jobs.splice(jobs.indexOf(job), 1);
      log(`lab ${id} ${action}: 200 ${line}`);
      if (!res.destroyed && !res.writableEnded) res.end(`${line}\n`);
    });
    return undefined;
  }

  return {
    post,
    stopAll: () => { closing = true; return Promise.all(jobs.map((j) => stopJob(j, 'server'))); },
    killAll: () => { for (const j of jobs) if (j.pgid) signalGroup(j.pgid, 'SIGKILL'); },
  };
}

// D6, D8: [path, name] for each declared env name of `labs` whose value is set in `env` and occurs in a file of
// `files` ([path, text or bytes]): the start warning of teach serve --labs and the export's secret refusal.
// A value under 8 characters is skipped: check 11 refuses it for a run, and it would match too much.
export function secretHits(files, labs, env) {
  const names = [...new Set(Object.values(labs).flatMap((l) => l.env ?? []))].filter((n) => typeof env[n] === 'string' && env[n].length >= 8);
  return files.flatMap(([p, body]) => {
    const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
    return names.filter((n) => bytes.includes(env[n])).map((n) => [p, n]);
  });
}
