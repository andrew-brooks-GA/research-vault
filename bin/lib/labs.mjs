// Spec 49 D1, D2: the lab manifest `labs/labs.json`, its reader and the pins. Nothing here starts a process.
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
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

// D4 checks 6 to 11 and 13, in order, for a lab id that passed check 5; every file is read synchronously, so the
// checks happen in one turn. [status, body] of the first that fails. No action runs in this version: one that
// passes them all is 501, and a stop is 409 not running.
export function labRefusal(ws, action, id, env) {
  let labs;
  try { ({ labs } = readLabs(ws)); } catch { return [500, 'labs/labs.json is invalid; run teach lint']; }
  if (!Object.hasOwn(labs, id)) return [404, 'no lab'];
  const lab = labs[id];
  if (action === 'verify' && !lab.verify) return [404, 'no verify'];
  if (action === 'stop') return [409, 'not running'];
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
  return [501, 'lab runs are not built yet'];
}
