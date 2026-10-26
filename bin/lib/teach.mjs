// research-teach workspace store: learning records, attempts and the derived index.
// Pure logic over a workspace directory; the verbs live in bin/commands/teach.mjs.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, basename, extname } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { writeEntry } from './fsutil.mjs';
import { loadTeachSchema } from './schema.mjs';
import { allowedValues } from './validate.mjs';
import { slugify } from './ids.mjs';
import { isInsideVault } from './containment.mjs';
import { grade } from '../../skills/research-teach/assets/quiz.js';

export const SPACING_DAYS = 21;
export const ATTEMPT_BODY_MAX = 4096;
export const LESSON_ID_RE = /^\d{4}-[a-z][a-z0-9-]*$/;
export const RECORD_ID_RE = /^\d{4}-[a-z][a-z0-9-]*$/;
export const ATTEMPT_ID_RE = /^a-\d{8}-\d{6}-\d{4}(?:-\d+)?$/;
const TEACH_SCHEMA = loadTeachSchema(fileURLToPath(new URL('../..', import.meta.url)));
export const STORED_DERIVED = TEACH_SCHEMA.derived_forbidden;

// One map for validateEntry and the teach lint, as CONTROLLED_FIELDS is for the vault.
export const TEACH_CONTROLLED_FIELDS = { status: 'status', kind: 'kind', type: 'type' };
export const ENUM_CODES = { status: 'ENUM_STATUS', kind: 'ENUM_KIND', type: 'ENUM_TYPE' };

const DAY_MS = 86400000;
const isoDate = (d) => d.toISOString().slice(0, 10);
const empty = (v) => v === undefined || v === null || v === '';
const order = (schema, type) => [...schema.common, ...(schema.by_type[type] || [])];
const mdFiles = (dir) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.md')).sort() : []);
const uniq = (xs) => [...new Set(xs)];

export function validateEntry(data, schema) {
  const msgs = [];
  for (const f of (schema.required_by_type[data.type] || ['type'])) {
    if (empty(data[f])) msgs.push(`missing required field: ${f}`);
  }
  for (const [field, key] of Object.entries(TEACH_CONTROLLED_FIELDS)) {
    if (!empty(data[field]) && !allowedValues(schema, key).includes(data[field])) msgs.push(`unknown ${field}: ${data[field]}`);
  }
  for (const f of schema.derived_forbidden) if (f in data) msgs.push(`stored derived field: ${f}`);
  return msgs;
}

function assertValid(data, schema) {
  const msgs = validateEntry(data, schema);
  if (msgs.length) throw new Error(msgs.join('; '));
}

// HTML extraction (regex; lessons are static HTML written by the skill).
export function extractQuizJson(html) {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bdata-quiz\b/i.test(m[1]) && /\btype\s*=\s*["']application\/json["']/i.test(m[1])) return m[2];
  }
  return null;
}

export function extractCites(html) {
  return uniq([...html.matchAll(/\bdata-cite\s*=\s*(["'])(.*?)\1/g)].map((m) => m[2]));
}

const textOf = (s) => s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

export function lessonTitle(html, id) {
  for (const re of [/<title[^>]*>([\s\S]*?)<\/title>/i, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i]) {
    const m = re.exec(html);
    if (m && textOf(m[1])) return textOf(m[1]);
  }
  return id;
}

export function nextRecordId(workspaceDir, slug) {
  const nums = mdFiles(join(workspaceDir, 'learning-records')).map((f) => /^(\d{4})-/.exec(f)).filter(Boolean).map((m) => Number(m[1]));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${String(next).padStart(4, '0')}-${slug}`;
}

export function writeRecord(workspaceDir, { title, kind, lesson, body, now }, schema) {
  const id = nextRecordId(workspaceDir, slugify(title ?? ''));
  if (!RECORD_ID_RE.test(id)) throw new Error(`title gives no valid record id: ${id} (the slug must start with a letter)`);
  const data = { title, type: 'learning-record', date: isoDate(now), status: 'active', ...(lesson ? { lesson } : {}), kind };
  assertValid(data, schema);
  const dir = join(workspaceDir, 'learning-records');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.md`);
  const text = `# ${title}\n` + (body ? `\n${body.trimEnd()}\n` : '');
  writeFileSync(path, serializeFrontmatter(data, text, order(schema, 'learning-record')), { flag: 'wx' });
  return { id, path };
}

export function supersedeRecord(workspaceDir, id, byId, reason, schema) {
  const dir = join(workspaceDir, 'learning-records');
  for (const x of [id, byId]) {
    if (!RECORD_ID_RE.test(String(x)) || !existsSync(join(dir, `${x}.md`))) throw new Error(`no learning record: ${x}`);
  }
  if (id === byId) throw new Error(`a record cannot supersede itself: ${id}`);
  const path = join(dir, `${id}.md`);
  const { data, body } = parseFrontmatter(readFileSync(path, 'utf8'));
  if (data.status === 'superseded') throw new Error(`already superseded: ${id} (by ${data.superseded_by})`);
  data.status = 'superseded';
  data.superseded_by = byId;
  assertValid(data, schema);
  const line = reason ? `Superseded by ${byId}: ${reason}` : `Superseded by ${byId}.`;
  writeEntry(path, data, `${body}${body.endsWith('\n') || body === '' ? '' : '\n'}\n${line}\n`, order(schema, 'learning-record'));
  return { path };
}

export function readQuiz(workspaceDir, lessonId) {
  const bad = () => new Error(`quiz JSON invalid in ${lessonId}`);
  const json = extractQuizJson(readFileSync(join(workspaceDir, 'lessons', `${lessonId}.html`), 'utf8'));
  if (json === null) throw bad();
  let quiz;
  try { quiz = JSON.parse(json); } catch { throw bad(); }
  if (!quiz || !Array.isArray(quiz.items) || !quiz.items.every((it) => it && Array.isArray(it.options))) throw bad();
  return { items: quiz.items };
}

export function attemptId(now, lessonNumber, exists) {
  const s = now.toISOString();
  const base = `a-${s.slice(0, 10).replaceAll('-', '')}-${s.slice(11, 19).replaceAll(':', '')}-${lessonNumber}`;
  let id = base;
  for (let n = 2; exists(id); n++) id = `${base}-${n}`;
  return id;
}

export function writeAttempt(workspaceDir, { lesson, answers, now }, schema) {
  if (!LESSON_ID_RE.test(String(lesson))) throw new Error(`invalid lesson id: ${lesson}`);
  if (!existsSync(join(workspaceDir, 'lessons', `${lesson}.html`))) throw new Error(`no lesson: ${lesson}`);
  const { items } = readQuiz(workspaceDir, lesson);
  if (!Array.isArray(answers) || answers.length !== items.length ||
      !answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < items[i].options.length)) {
    throw new Error(`answers must be one in-range integer per quiz item (${items.length} items)`);
  }
  const { total, wrong } = grade(items, answers);
  const records = uniq(wrong.map((i) => items[i].record).filter(Boolean));
  const data = { type: 'attempt', date: isoDate(now), lesson, total, wrong, records };
  assertValid(data, schema);
  const dir = join(workspaceDir, 'attempts');
  mkdirSync(dir, { recursive: true });
  const text = serializeFrontmatter(data, '', order(schema, 'attempt'));
  for (;;) {
    const id = attemptId(now, lesson.slice(0, 4), (x) => existsSync(join(dir, `${x}.md`)));
    const path = join(dir, `${id}.md`);
    try {
      writeFileSync(path, text, { flag: 'wx' });
    } catch (e) {
      if (e.code === 'EEXIST') continue; // lost a race to another writer; the next id is free
      throw e;
    }
    return { id, path, score: total - wrong.length, total, wrong };
  }
}

// `teach lint --fix` upgrade for a legacy record: no frontmatter, or frontmatter without `type`
// (the old `Status:` line). Malformed frontmatter is left alone (the lint reports PARSE) and a
// record that carries `type` is untouched. `now` is unused, the date is the mtime.
export function fixRecordFrontmatter(workspaceDir, file, now) {
  const dir = join(workspaceDir, 'learning-records');
  const path = resolve(dir, file);
  let text = readFileSync(path, 'utf8');
  let old = {};
  if (/^\uFEFF?---\r?\n/.test(text)) {
    try { ({ data: old, body: text } = parseFrontmatter(text)); } catch { return false; }
    if (!empty(old.type)) return false;
  }
  const slug = basename(path, '.md').replace(/^\d{4}-/, '');
  const data = {
    title: empty(old.title) ? (/^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? slug) : old.title,
    type: 'learning-record',
    date: isoDate(statSync(path).mtime),
    status: 'active',
    kind: 'understanding',
  };
  const lr = /superseded by LR-(\d{4})/i.exec(String(old.Status ?? old.status ?? '')) ?? /Status:\s*superseded by LR-(\d{4})/.exec(text);
  const target = lr && mdFiles(dir).find((f) => f.startsWith(`${lr[1]}-`));
  if (target) {
    data.status = 'superseded';
    data.superseded_by = target.slice(0, -3);
  }
  writeEntry(path, data, text, order(TEACH_SCHEMA, 'learning-record'));
  return true;
}

function missionCriteria(workspaceDir) {
  const p = join(workspaceDir, 'MISSION.md');
  if (!existsSync(p)) return [];
  const out = [];
  let inSection = false;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) { inSection = /^#{1,6}\s+success looks like\b/i.test(line); continue; }
    const m = inSection && /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line);
    if (m) out.push(m[1]);
  }
  return out;
}

function parsedRows(dir, nameRe) {
  const rows = [];
  for (const f of mdFiles(dir)) {
    const id = f.slice(0, -3);
    if (nameRe && !nameRe.test(id)) continue;
    try { rows.push({ id, ...parseFrontmatter(readFileSync(join(dir, f), 'utf8')).data }); } catch { /* the lint reports it */ }
  }
  return rows;
}

// Chronological attempt order: the base id, then the collision suffix as a number (none = 1).
export function attemptOrder(a, b) {
  const key = (id) => { const m = /^(.*-\d{4})(?:-(\d+))?$/.exec(id); return [m[1], Number(m[2] ?? 1)]; };
  const [ab, an] = key(a), [bb, bn] = key(b);
  return ab < bb ? -1 : ab > bb ? 1 : an - bn;
}

export function teachIndex(workspaceDir, { now }) {
  const lessonsDir = join(workspaceDir, 'lessons');
  const lessons = (existsSync(lessonsDir) ? readdirSync(lessonsDir).sort() : [])
    .filter((f) => f.endsWith('.html') && LESSON_ID_RE.test(f.slice(0, -5)))
    .map((f) => {
      const id = f.slice(0, -5);
      const html = readFileSync(join(lessonsDir, f), 'utf8');
      let records = [];
      try { records = uniq(readQuiz(workspaceDir, id).items.map((it) => it.record).filter(Boolean)); } catch { /* malformed quiz */ }
      return { id, number: id.slice(0, 4), class: id.slice(5).startsWith('review-') ? 'review' : 'lesson', title: lessonTitle(html, id), cites: extractCites(html), records };
    });
  const tests = Object.fromEntries(lessons.map((l) => [l.id, l.records]));
  const attempts = parsedRows(join(workspaceDir, 'attempts'), ATTEMPT_ID_RE).sort((a, b) => attemptOrder(a.id, b.id));
  const backlinks = {};
  for (const a of attempts) for (const r of (Array.isArray(a.records) ? a.records : [])) (backlinks[r] ??= []).push(a.id);

  const cutoff = isoDate(new Date(now.getTime() - SPACING_DAYS * DAY_MS));
  const records = parsedRows(join(workspaceDir, 'learning-records')).map((r) => {
    const wrongIn = (a) => Array.isArray(a.records) && a.records.includes(r.id);
    const last = attempts.filter((a) => wrongIn(a) || (tests[a.lesson] || []).includes(r.id)).at(-1);
    const lastAttempt = last
      ? { id: last.id, date: last.date, score: last.total - (last.wrong?.length ?? 0), total: last.total, wrongHere: wrongIn(last) }
      : null;
    const active = r.status === 'active';
    return {
      ...r,
      evidence: backlinks[r.id] ?? [],
      lastAttempt,
      // Due when written before the spacing cutoff and not attempted since that cutoff.
      reviewDue: active && String(r.date) < cutoff && !(lastAttempt && String(lastAttempt.date) >= cutoff),
      reviewFailed: active && lastAttempt?.wrongHere === true,
    };
  });
  const refDir = join(workspaceDir, 'reference');
  const reference = (existsSync(refDir) ? readdirSync(refDir).sort() : []).filter((f) => f.endsWith('.html'))
    .map((f) => ({ slug: f.slice(0, -5), file: `reference/${f}`, cites: extractCites(readFileSync(join(refDir, f), 'utf8')) }));
  return { criteria: missionCriteria(workspaceDir), lessons, reference, records, attempts, backlinks };
}

// Learner performance over time, from the attempts on disk: every attempt per lesson in
// chronological order with first, latest and best, plus record counts and what is due for review.
export function progress(workspaceDir, { now }) {
  const idx = teachIndex(workspaceDir, { now });
  const byLesson = new Map(idx.lessons.map((l) => [l.id, { id: l.id, title: l.title, class: l.class, attempts: [] }]));
  for (const a of idx.attempts) {
    const total = Number(a.total) || 0;
    const wrong = Array.isArray(a.wrong) ? a.wrong : [];
    if (!byLesson.has(a.lesson)) byLesson.set(a.lesson, { id: a.lesson, title: a.lesson, class: 'lesson', attempts: [] });
    byLesson.get(a.lesson).attempts.push({ id: a.id, date: String(a.date), score: total - wrong.length, total, wrong });
  }
  const ratio = (x) => (x.total ? x.score / x.total : 0);
  const lessons = [...byLesson.values()].map((l) => ({
    ...l,
    first: l.attempts[0] ?? null,
    latest: l.attempts.at(-1) ?? null,
    best: l.attempts.reduce((b, a) => (b === null || ratio(a) > ratio(b) ? a : b), null),
  }));
  const byKind = {};
  for (const r of idx.records) if (r.status === 'active') byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
  return {
    lessons,
    attempts: idx.attempts.length,
    records: { active: idx.records.filter((r) => r.status === 'active').length, byKind },
    reviewDue: idx.records.filter((r) => r.reviewDue).map((r) => r.id),
    reviewFailed: idx.records.filter((r) => r.reviewFailed).map((r) => r.id),
  };
}

const fmtScore = (a) => (a ? `${a.score}/${a.total} on ${a.date}` : 'none');

export function progressText(p) {
  const lines = ['| lesson | attempts | first | latest | best |', '|---|---|---|---|---|'];
  for (const l of p.lessons) lines.push(`| ${l.id} | ${l.attempts.length} | ${fmtScore(l.first)} | ${fmtScore(l.latest)} | ${fmtScore(l.best)} |`);
  lines.push('', `attempts: ${p.attempts}`, `records: ${p.records.active} active (${Object.entries(p.records.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`,
    `review-due: ${p.reviewDue.join(', ') || 'none'}`, `review-failed: ${p.reviewFailed.join(', ') || 'none'}`);
  return lines.join('\n') + '\n';
}

export function progressHtml(p) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cell = (a) => (a ? `<td><b>${a.score}/${a.total}</b> <small>${esc(a.date)}</small></td>` : '<td>none</td>');
  const rows = p.lessons.map((l) => `<tr><td><a href="/lessons/${esc(l.id)}.html">${esc(l.title)}</a></td><td>${l.attempts.length}</td>${cell(l.first)}${cell(l.latest)}${cell(l.best)}</tr>`).join('');
  const timeline = p.lessons.flatMap((l) => l.attempts.map((a) => ({ ...a, lesson: l.title, lid: l.id })))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => `<li><small>${esc(a.date)}</small> <a href="/lessons/${esc(a.lid)}.html">${esc(a.lesson)}</a>: <b>${a.score}/${a.total}</b>${a.wrong.length ? ` <small>(missed item${a.wrong.length > 1 ? 's' : ''} ${a.wrong.map((i) => i + 1).join(', ')})</small>` : ''}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Progress</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body><h1>Progress</h1>
<section data-block="progress"><table class="progress"><thead><tr><th>lesson</th><th>attempts</th><th>first</th><th>latest</th><th>best</th></tr></thead><tbody>${rows}</tbody></table>
<p>${p.attempts} attempt${p.attempts === 1 ? '' : 's'}; ${p.records.active} active learning record${p.records.active === 1 ? '' : 's'}${Object.keys(p.records.byKind).length ? ` (${esc(Object.entries(p.records.byKind).map(([k, n]) => `${k} ${n}`).join(', '))})` : ''}. Review due: ${esc(p.reviewDue.join(', ') || 'none')}. Review failed: ${esc(p.reviewFailed.join(', ') || 'none')}.</p></section>
<section data-block="timeline"><ol class="timeline">${timeline || '<li>No attempts yet.</li>'}</ol></section>
</body></html>
`;
}

// `teach serve` (spec 12 "Serving and recording"). Order matters: Host before anything;
// for POST, Origin, Content-Type and Content-Length before a byte of the body is read.
const STATIC_DIRS = ['lessons', 'reference', 'assets'];
const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};
const CLIENT_ERROR = /^(invalid lesson id|no lesson|answers must be)/;

function send(req, res, status, body = '', type = 'text/plain; charset=utf-8', close = false) {
  const headers = { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' };
  if (close) {
    headers.Connection = 'close';
    res.on('finish', () => req.destroy()); // the body is never read, so drop the connection
  }
  res.writeHead(status, headers);
  res.end(body);
}

// The resolved file to serve for a URL path, or a status: 400 undecodable, 404 anything not allowlisted.
export function serveFile(workspaceDir, urlPath) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return { status: 400 }; }
  if (decoded.includes('\0') || decoded.split('/').some((seg) => seg.startsWith('.'))) return { status: 404 };
  const target = join(workspaceDir, decoded);
  const allowed = target === join(workspaceDir, 'GLOSSARY.md') ||
    STATIC_DIRS.some((d) => isInsideVault(join(workspaceDir, d), target));
  if (!allowed) return { status: 404 };
  try {
    if (!statSync(target).isFile()) return { status: 404 };
    return { status: 200, body: readFileSync(target), type: CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' };
  } catch {
    return { status: 404 };
  }
}

// The workspace's lessons and reference docs for navigation: id, title and served path, lessons in id
// order. GET / renders it as an HTML index; GET /lessons.json returns it so a lesson page can link to
// its neighbours.
export function lessonIndex(ws) {
  const read = (dir, isLesson) => {
    const d = join(ws, dir);
    return (existsSync(d) ? readdirSync(d).sort() : [])
      .filter((f) => f.endsWith('.html') && (!isLesson || LESSON_ID_RE.test(f.slice(0, -5))))
      .map((f) => { const id = f.slice(0, -5); return { id, title: lessonTitle(readFileSync(join(d, f), 'utf8'), id), path: `/${dir}/${f}` }; });
  };
  return { lessons: read('lessons', true), reference: read('reference', false) };
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function indexHtml(ws) {
  const { lessons, reference } = lessonIndex(ws);
  const li = (e) => `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.title)}</a> <small>${escapeHtml(e.id)}</small></li>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lessons</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body><h1>Lessons</h1>
<section data-block="index"><ol class="lesson-index">${lessons.map(li).join('')}</ol></section>
${reference.length ? `<section data-block="reference-index"><ul class="lesson-index">${reference.map(li).join('')}</ul></section>` : ''}
</body></html>
`;
}

function postAttempt(req, res, workspaceDir, origin, schema, now) {
  const type = req.headers['content-type'];
  const length = req.headers['content-length'];
  if (req.headers.origin !== origin || !/^application\/json(;\s*charset=utf-8)?$/i.test(type ?? '') ||
      (length !== undefined && !(Number(length) <= ATTEMPT_BODY_MAX))) {
    return send(req, res, 403, 'forbidden\n', undefined, true);
  }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > ATTEMPT_BODY_MAX) {
      req.removeAllListeners('data').removeAllListeners('end').pause();
      return send(req, res, 403, 'forbidden\n', undefined, true);
    }
    chunks.push(c);
  });
  req.on('end', () => {
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(req, res, 400, 'malformed JSON\n'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.lesson !== 'string' || !Array.isArray(body.answers)) {
      return send(req, res, 400, 'body must be {"lesson": "<id>", "answers": [integers]}\n');
    }
    try {
      const { id, score, total, wrong } = writeAttempt(workspaceDir, { lesson: body.lesson, answers: body.answers, now: now() }, schema);
      send(req, res, 200, JSON.stringify({ id, score, total, wrong }), 'application/json');
    } catch (e) {
      // A malformed quiz or a failed write is the server's problem; nothing was written on a 400.
      send(req, res, CLIENT_ERROR.test(e.message) ? 400 : 500, `${e.message}\n`);
    }
  });
}

export function createServer(workspaceDir, { schema, now = () => new Date() } = {}) {
  const ws = resolve(workspaceDir);
  const clock = typeof now === 'function' ? now : () => now;
  // requireHostHeader off: a missing Host gets our 403, not node:http's own 400.
  const server = http.createServer({ requireHostHeader: false }, (req, res) => {
    const base = `127.0.0.1:${server.address().port}`;
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (req.headers.host !== base) return send(req, res, 403, 'forbidden\n', undefined, !isBodyless);
    const path = req.url.split('?')[0];
    if (req.method === 'POST') {
      if (path !== '/attempt') return send(req, res, 404, 'not found\n', undefined, true);
      return postAttempt(req, res, ws, `http://${base}`, schema, clock);
    }
    if (!isBodyless) return send(req, res, 405, 'method not allowed\n', undefined, true);
    if (path === '/') return send(req, res, 200, indexHtml(ws), 'text/html; charset=utf-8');
    if (path === '/lessons.json') return send(req, res, 200, JSON.stringify(lessonIndex(ws)), 'application/json');
    if (path === '/progress') return send(req, res, 200, progressHtml(progress(ws, { now: clock() })), 'text/html; charset=utf-8');
    if (path === '/progress.json') return send(req, res, 200, JSON.stringify(progress(ws, { now: clock() })), 'application/json');
    const f = serveFile(ws, path);
    if (f.status !== 200) return send(req, res, f.status, f.status === 400 ? 'bad request\n' : 'not found\n');
    send(req, res, 200, f.body, f.type); // HEAD: node:http drops the body itself
  });
  return server;
}
