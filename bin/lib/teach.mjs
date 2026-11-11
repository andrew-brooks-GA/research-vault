// research-teach workspace store: learning records, attempts and the derived index.
// Pure logic over a workspace directory; the verbs live in bin/commands/teach.mjs.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, lstatSync } from 'node:fs';
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
import { lessonItems, readPath, isProject, lessonClass, README_SECTIONS } from './lesson.mjs';
import { HEADING_RE, TABLE_SEP_RE } from './gate.mjs';

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

// The predict item (when the lesson has one) is item 0 of the one attempt, then the quiz items.
export function readQuiz(workspaceDir, lessonId) {
  const { items } = lessonItems(readFileSync(join(workspaceDir, 'lessons', `${lessonId}.html`), 'utf8'));
  if (!items) throw new Error(`quiz JSON invalid in ${lessonId}`);
  return { items };
}

export function attemptId(now, lessonNumber, exists) {
  const s = now.toISOString();
  const base = `a-${s.slice(0, 10).replaceAll('-', '')}-${s.slice(11, 19).replaceAll(':', '')}-${lessonNumber}`;
  let id = base;
  for (let n = 2; exists(id); n++) id = `${base}-${n}`;
  return id;
}

// One in-range integer per quiz item: what gradeAttempt accepts, and the import's test of a changed lesson.
const fits = (items, answers) => Array.isArray(answers) && answers.length === items.length &&
  answers.every((a, i) => Number.isInteger(a) && a >= 0 && a < items[i].options.length);

// Spec 22 D3: `result` (pass|fail) records a project run in place of answers, stored as one item, 1/1 or 0/1.
function gradeAttempt(workspaceDir, lesson, answers, result) {
  if (result !== undefined) {
    if (result !== 'pass' && result !== 'fail') throw new Error(`result must be pass or fail: ${result}`);
    return { result, total: 1, wrong: result === 'pass' ? [] : [0], records: [] };
  }
  const { items } = readQuiz(workspaceDir, lesson);
  if (!fits(items, answers)) {
    throw new Error(`answers must be one in-range integer per quiz item (${items.length} items)`);
  }
  const { total, wrong } = grade(items, answers);
  return { total, wrong, records: uniq(wrong.map((i) => items[i].record).filter(Boolean)) };
}

export function writeAttempt(workspaceDir, { lesson, answers, result, now }, schema) {
  if (!LESSON_ID_RE.test(String(lesson))) throw new Error(`invalid lesson id: ${lesson}`);
  if (!existsSync(join(workspaceDir, 'lessons', `${lesson}.html`))) throw new Error(`no lesson: ${lesson}`);
  const data = { type: 'attempt', date: isoDate(now), lesson, ...gradeAttempt(workspaceDir, lesson, answers, result) };
  const { total, wrong } = data;
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
    return { id, path, score: total - wrong.length, total, wrong, result: data.result };
  }
}

// Spec 48 D4: `teach attempt import` of the results file quiz.js's resultsFile builds in an exported copy.
export const RESULTS_MAX = 1024 * 1024;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const keysAre = (o, keys) => o !== null && typeof o === 'object' && !Array.isArray(o) &&
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k));
// A file value in a printed line: an array or object is named, never walked, so a deeply nested value cannot
// overflow the stack; JSON.stringify escapes a quote, a backslash and U+0000 to U+001F, ESC_RE what it leaves raw.
const ESC_RE = /[\u007f-\u009f\u200e\u200f\u202a-\u202e\u2028\u2029\u2066-\u2069]/g;
const show = (v) => (v !== null && typeof v === 'object' ? (Array.isArray(v) ? 'an array' : 'an object')
  : String(JSON.stringify(v)).replace(ESC_RE, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`));
const sameList = (xs, ys) => Array.isArray(ys) && ys.length === xs.length && xs.every((x, i) => x === ys[i]);
// The storage key and `workspace` field of an exported copy: the workspace directory's name through slugify.
export const workspaceKey = (workspaceDir) => slugify(basename(resolve(workspaceDir)));

function attemptProblems(workspaceDir, a, now) {
  if (!keysAre(a, ['lesson', 'answers', 'at', 'total', 'wrong'])) return ['keys must be exactly lesson, answers, at, total, wrong'];
  const out = [];
  if (typeof a.lesson !== 'string' || !LESSON_ID_RE.test(a.lesson)) out.push(`lesson ${show(a.lesson)} is not a lesson id`);
  else if (!existsSync(join(workspaceDir, 'lessons', `${a.lesson}.html`))) out.push(`no lesson ${show(a.lesson)}`);
  if (!Array.isArray(a.answers) || !a.answers.every((x) => Number.isInteger(x) && x >= 0)) out.push('answers is not an array of non-negative integers');
  if (typeof a.at !== 'string' || !ISO_RE.test(a.at) || Number.isNaN(Date.parse(a.at)) || new Date(a.at).toISOString() !== a.at) out.push(`at ${show(a.at)} is not a toISOString time`);
  else if (new Date(a.at) > now) out.push(`at ${show(a.at)} is later than this machine's clock`);
  return out;
}

// Structural problems refuse the whole file (code 1, nothing written). Otherwise each attempt is skipped when
// its id without a collision suffix is in attempts/ or earlier in the file, reported `changed` when its lesson has
// no quiz that parses, its answers no longer fit the lesson or its regrade differs from the file's total and wrong
// (code 1), else written by writeAttempt with `at` as now. Every attempt is decided before the first is written.
// Every file value a problem line or a changed line prints goes through show; a changed line names the lesson,
// which has passed its checks.
export function importAttempts(workspaceDir, text, { schema, now }) {
  let file;
  try { file = JSON.parse(text); } catch { return { code: 1, lines: ['file: not JSON'] }; }
  const key = workspaceKey(workspaceDir);
  const problems = [];
  if (!keysAre(file, ['format', 'version', 'workspace', 'attempts'])) problems.push('file: keys must be exactly format, version, workspace, attempts');
  if (file?.format !== 'research-vault-attempts') problems.push(`file: format ${show(file?.format)} is not "research-vault-attempts"`);
  if (file?.version !== 1) problems.push(`file: version ${show(file?.version)} is not 1`);
  if (file?.workspace !== key) problems.push(`file: workspace ${show(file?.workspace)} is not this workspace's ${show(key)}`);
  const list = file?.attempts;
  if (!Array.isArray(list) || !list.length) problems.push('file: attempts is not a non-empty array');
  else list.forEach((a, i) => { for (const p of attemptProblems(workspaceDir, a, now)) problems.push(`attempt ${i + 1}: ${p}`); });
  if (problems.length) return { code: 1, lines: problems };
  const planned = new Set();
  const plan = list.map((a) => {
    const base = attemptId(new Date(a.at), a.lesson.slice(0, 4), () => false);
    if (planned.has(base) || existsSync(join(workspaceDir, 'attempts', `${base}.md`))) return { line: `skipped ${base}: already recorded` };
    let items = [];
    try { ({ items } = readQuiz(workspaceDir, a.lesson)); } catch { items = []; } // no quiz that parses: now -/0
    const g = items.length && fits(items, a.answers) ? grade(items, a.answers) : null;
    if (!g || g.total !== a.total || !sameList(g.wrong, a.wrong)) {
      const was = Number.isInteger(a.total) && Array.isArray(a.wrong) ? a.total - a.wrong.length : null;
      return { changed: true, line: `changed ${a.lesson}: browser ${show(was)}/${show(a.total)}, now ${g ? g.total - g.wrong.length : '-'}/${items.length}` };
    }
    planned.add(base);
    return { a };
  });
  const lines = plan.map(({ a, line }) => {
    if (!a) return line;
    const r = writeAttempt(workspaceDir, { lesson: a.lesson, answers: a.answers, now: new Date(a.at) }, schema);
    return `recorded ${r.id}: ${r.score}/${r.total}`;
  });
  return { code: plan.some((p) => p.changed) ? 1 : 0, lines };
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
    byLesson.get(a.lesson).attempts.push({ id: a.id, date: String(a.date), score: total - wrong.length, total, wrong, ...(a.result ? { result: String(a.result) } : {}) });
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

const scoreOf = (a) => a.result ?? `${a.score}/${a.total}`; // a project run shows pass or fail
const fmtScore = (a) => (a ? `${scoreOf(a)} on ${a.date}` : 'none');

export function progressText(p) {
  const lines = ['| lesson | attempts | first | latest | best |', '|---|---|---|---|---|'];
  for (const l of p.lessons) lines.push(`| ${l.id} | ${l.attempts.length} | ${fmtScore(l.first)} | ${fmtScore(l.latest)} | ${fmtScore(l.best)} |`);
  lines.push('', `attempts: ${p.attempts}`, `records: ${p.records.active} active (${Object.entries(p.records.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'})`,
    `review-due: ${p.reviewDue.join(', ') || 'none'}`, `review-failed: ${p.reviewFailed.join(', ') || 'none'}`);
  return lines.join('\n') + '\n';
}

// The navigation bar of a page that does not load quiz.js; renderNav in quiz.js builds the same links
// (plus previous, next and the path position) on a lesson page.
export function navHtml() {
  return '<nav class="lesson-nav"><a class="lesson-nav-index" href="/">All lessons</a><a class="lesson-nav-progress" href="/progress">Progress</a><a class="lesson-nav-reading" href="/assets/reading.html">How to read</a></nav>';
}

export function progressHtml(p) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const cell = (a) => (a ? `<td><b>${esc(scoreOf(a))}</b> <small>${esc(a.date)}</small></td>` : '<td>none</td>');
  const rows = p.lessons.map((l) => `<tr><td><a href="/lessons/${esc(l.id)}.html">${esc(l.title)}</a></td><td>${l.attempts.length}</td>${cell(l.first)}${cell(l.latest)}${cell(l.best)}</tr>`).join('');
  const timeline = p.lessons.flatMap((l) => l.attempts.map((a) => ({ ...a, lesson: l.title, lid: l.id })))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((a) => `<li><small>${esc(a.date)}</small> <a href="/lessons/${esc(a.lid)}.html">${esc(a.lesson)}</a>: <b>${esc(scoreOf(a))}</b>${a.wrong.length && !a.result ? ` <small>(missed item${a.wrong.length > 1 ? 's' : ''} ${a.wrong.map((i) => i + 1).join(', ')})</small>` : ''}</li>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Progress</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body>${navHtml()}<h1>Progress</h1>
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

// Citations as the learner sees them: every `<a data-cite="ID">` outside the sources block becomes a
// numbered footnote `[n]` (its position in the sources list, as an unserved page's authored [n] is; an id
// the list lacks numbers after it) carrying the entry's title, and the sources block's
// anchors get `id="src-ID"`, their title as text, and their number. The file on disk is untouched, so
// the claims-gate hash is unaffected. `titles` maps vault id to title; an unknown id keeps the id as its title.
export function footnoteCitations(html, titles = {}) {
  const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const srcRe = /(<[a-z][a-z0-9]*\b[^>]*\bdata-block\s*=\s*(["'])sources\2[^>]*>)([\s\S]*?)(<\/section>|<\/div>)/i;
  const m = srcRe.exec(html);
  const order = m ? extractCites(m[3]) : [];
  const num = (id) => { let i = order.indexOf(id); if (i === -1) { order.push(id); i = order.length - 1; } return i + 1; };
  const before = m ? html.slice(0, m.index) : html;
  const sources = m ? m[3] : '';
  const after = m ? html.slice(m.index + m[0].length) : '';
  const anchor = /<a\b([^>]*)\bdata-cite\s*=\s*(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  const body = before.replace(anchor, (_, pre, q, id, post) => {
    const n = num(id);
    return `<a${pre}data-cite="${id}"${post} class="cite" href="#src-${esc(id)}" title="${esc(titles[id] ?? id)}">[${n}]</a>`;
  });
  if (!m) return body;
  const srcBody = sources.replace(anchor, (_, pre, q, id, post) => {
    const n = num(id);
    const hrefOnly = /\bhref\s*=/.test(pre + post) ? '' : ` href="#src-${esc(id)}"`;
    return `<a${pre}data-cite="${id}"${post}${hrefOnly} id="src-${esc(id)}">[${n}] ${esc(titles[id] ?? id)}</a>`;
  });
  return body + m[1] + srcBody + m[4] + after;
}

// The resolved file to serve for a URL path, or a status: 400 undecodable, 404 anything not allowlisted.
export function serveFile(workspaceDir, urlPath, { titles, bytes = true } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return { status: 400 }; }
  if (decoded.includes('\0') || decoded.split('/').some((seg) => seg.startsWith('.'))) return { status: 404 };
  const target = join(workspaceDir, decoded);
  const allowed = target === join(workspaceDir, 'GLOSSARY.md') ||
    STATIC_DIRS.some((d) => isInsideVault(join(workspaceDir, d), target));
  if (!allowed) return { status: 404 };
  try {
    if (!statSync(target).isFile()) return { status: 404 };
    if (!bytes) return { status: 200 };
    const body = readFileSync(target);
    const isPage = /\.html$/i.test(target) && (decoded.startsWith('/lessons/') || decoded.startsWith('/reference/'));
    let out = isPage ? footnoteCitations(body.toString('utf8'), titles ?? {}) : body;
    if (/\.html$/i.test(target)) {
      const html = out.toString('utf8');
      if (!/<script[^>]*quiz\.js/i.test(html)) out = html.replace(/<body\b[^>]*>/i, (m) => m + navHtml());
    }
    return { status: 200, body: out, type: CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream' };
  } catch {
    return { status: 404 };
  }
}

// The workspace's lessons and reference docs for navigation: id, title and served path, lessons in id
// order. GET / renders it as an HTML index; GET /lessons.json returns it so a lesson page can link to
// its neighbours. Spec 22 D6.6: `lines` is the PATH.md line count (null without PATH.md) and each lesson
// carries its PATH.md `line` number, its `shape` (data-shape) and the `project` that closes its group:
// the title of the first line at or after its own whose title starts `Project:` (each null when absent).
export function lessonIndex(ws) {
  const path = readPath(ws);
  const lessonLine = (id) => path?.findIndex((l) => l.lesson === id) ?? -1;
  const read = (dir, isLesson) => {
    const d = join(ws, dir);
    return (existsSync(d) ? readdirSync(d).sort() : [])
      .filter((f) => f.endsWith('.html') && (!isLesson || LESSON_ID_RE.test(f.slice(0, -5))))
      .map((f) => {
        const id = f.slice(0, -5);
        const html = readFileSync(join(d, f), 'utf8');
        const entry = { id, title: lessonTitle(html, id), path: `/${dir}/${f}` };
        if (!isLesson) return entry;
        const i = lessonLine(id);
        const shape = /<body\b[^>]*\bdata-shape\s*=\s*(["'])([^"']*)\1/i.exec(html)?.[2].trim().toLowerCase() || null;
        const project = i === -1 ? null : path.slice(i).find(isProject)?.title ?? null;
        return { ...entry, line: i === -1 ? null : path[i].n, shape, project };
      });
  };
  return { lines: path ? path.length : null, lessons: read('lessons', true), reference: read('reference', false) };
}

// Issue 66: `teach readme`, the README's lesson map and lab list as Markdown for the author to write the prose around.
// One map row per lessonIndex project of the built lessons (none: after the last Project: line or off the path), each
// review lesson marked (review); one lab row per directory under lessons/files/, named for the built lesson whose number begins it.
export function readmeDraft(ws) {
  const { lessons } = lessonIndex(ws);
  const groups = new Map();
  for (const l of lessons) (groups.get(l.project) ?? groups.set(l.project, []).get(l.project)).push(l);
  const map = [...groups].map(([p, ls]) => `| ${p ?? '(no Project: line)'} | ${ls.map((l) => l.id + (lessonClass(`lessons/${l.id}.html`) === 'review' ? ' (review)' : '')).join(', ')} |  |`);
  const files = join(ws, 'lessons', 'files');
  const dirs = existsSync(files) ? readdirSync(files, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  const labs = dirs.map((d) => `| ${lessons.find((l) => l.id.slice(0, 4) === d.slice(0, 4))?.id ?? ''} | lessons/files/${d}/ |  |  |`);
  return [`## ${README_SECTIONS[3]}`, '', '| Group | Lessons | What it builds |', '|---|---|---|', ...map, '', `## ${README_SECTIONS[4]}`, '',
    ...(labs.length ? ["| Lesson | Files | Needs on the learner's machine | Fallback |", '|---|---|---|---|', ...labs] : ['No lesson ships files under `lessons/files/`.'])].join('\n') + '\n';
}

const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Issue 66: the workspace README.md as HTML for GET /: headings, paragraphs, - lists, pipe tables, fenced code,
// inline code and inline links. All source text goes through escapeHtml, so raw HTML shows as text. A link
// becomes an <a> only when its target is http:, https: or has no scheme (relative or #) and holds no control
// character (a browser drops a leading one, so \x01javascript: would run); any other stays text.
const INLINE_RE = /`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const linkable = (href) => !/[\x00-\x1f\x7f]/.test(href) && (/^https?:/i.test(href) || !/^[a-z][a-z0-9+.-]*:/i.test(href));
function mdInline(s) {
  let out = '', i = 0;
  for (const m of s.matchAll(INLINE_RE)) {
    out += escapeHtml(s.slice(i, m.index));
    if (m[1] !== undefined) out += `<code>${escapeHtml(m[1])}</code>`;
    else out += linkable(m[3]) ? `<a href="${escapeHtml(m[3])}">${mdInline(m[2])}</a>` : escapeHtml(m[0]);
    i = m.index + m[0].length;
  }
  return out + escapeHtml(s.slice(i));
}
const FENCE_RE = /^\s*```/;
const ITEM_RE = /^\s*-\s/;
const cells = (row, tag) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => `<${tag}>${mdInline(c.trim())}</${tag}>`).join('');
export function markdownHtml(md) {
  const lines = md.split(/\r?\n/);
  const out = [];
  let para = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = HEADING_RE.exec(line);
    const table = /^\s*\|/.test(line) && TABLE_SEP_RE.test(lines[i + 1] ?? '');
    if (line.trim() && !FENCE_RE.test(line) && !h && !ITEM_RE.test(line) && !table) { para.push(line.trim()); continue; }
    if (para.length) out.push(`<p>${mdInline(para.join(' '))}</p>`);
    para = [];
    const run = (re) => { const r = []; while (i < lines.length && re.test(lines[i])) r.push(lines[i++]); i--; return r; };
    if (FENCE_RE.test(line)) {
      const body = [];
      while (++i < lines.length && !FENCE_RE.test(lines[i])) body.push(lines[i]);
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
    } else if (h) {
      const n = /^#+/.exec(line)[0].length;
      out.push(`<h${n}>${mdInline(h[1])}</h${n}>`);
    } else if (ITEM_RE.test(line)) {
      out.push(`<ul>${run(ITEM_RE).map((l) => `<li>${mdInline(l.replace(ITEM_RE, '').trim())}</li>`).join('')}</ul>`);
    } else if (table) {
      const [head, , ...rows] = run(/^\s*\|/);
      out.push(`<table><thead><tr>${cells(head, 'th')}</tr></thead><tbody>${rows.map((r) => `<tr>${cells(r, 'td')}</tr>`).join('')}</tbody></table>`);
    }
  }
  if (para.length) out.push(`<p>${mdInline(para.join(' '))}</p>`);
  return out.join('\n');
}

// Lessons in id order, each consecutive run under the project that closes its group as an h2; a README.md
// that is a regular file (lstat: a symlink is not followed) and reads goes above them, rendered by markdownHtml.
export function indexHtml(ws) {
  const { lessons, reference } = lessonIndex(ws);
  const readme = join(ws, 'README.md');
  let readmeHtml = '';
  try {
    if (lstatSync(readme).isFile()) readmeHtml = `<section data-block="readme">${markdownHtml(readFileSync(readme, 'utf8'))}</section>\n`;
  } catch { /* absent or unreadable: the page has no README */ }
  const li = (e) => `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.title)}</a>${e.shape ? ` <span class="lesson-shape">${escapeHtml(e.shape)}</span>` : ''} <small>${escapeHtml(e.id)}</small></li>`;
  const runs = [];
  for (const l of lessons) {
    if (runs.at(-1)?.project !== l.project) runs.push({ project: l.project, lessons: [] });
    runs.at(-1).lessons.push(l);
  }
  const lessonHtml = runs.map((r) => `${r.project ? `<h2>${escapeHtml(r.project)}</h2>` : ''}<ol class="lesson-index">${r.lessons.map(li).join('')}</ol>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lessons</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body>${navHtml()}${readmeHtml}<h1>Lessons</h1>
<p class="reading-link"><a href="/assets/reading.html">How to read a lesson</a></p>
<section data-block="index">${lessonHtml || '<ol class="lesson-index"></ol>'}</section>
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

export function createServer(workspaceDir, { schema, now = () => new Date(), titles = {} } = {}) {
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
    const f = serveFile(ws, path, { titles });
    if (f.status !== 200) return send(req, res, f.status, f.status === 400 ? 'bad request\n' : 'not found\n');
    send(req, res, 200, f.body, f.type); // HEAD: node:http drops the body itself
  });
  return server;
}
