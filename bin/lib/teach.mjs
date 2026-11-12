// research-teach workspace store: learning records, attempts and the derived index.
// Pure logic over a workspace directory; the verbs live in bin/commands/teach.mjs.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync, lstatSync, rmSync } from 'node:fs';
import { join, resolve, basename, dirname, extname } from 'node:path';
import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { writeEntry } from './fsutil.mjs';
import { loadTeachSchema } from './schema.mjs';
import { allowedValues } from './validate.mjs';
import { slugify } from './ids.mjs';
import { isInsideVault } from './containment.mjs';
import { expandFiles } from './files.mjs';
import { grade, neighbours, pathPosition } from '../../skills/research-teach/assets/quiz.js';
import { lessonItems, readPath, isProject, lessonClass, README_SECTIONS, FOLLOWUP, CONNECT_LEAD, imageTarget } from './lesson.mjs';
import { HEADING_RE, TABLE_SEP_RE, WORKSPACE_GATES, hasVerdict } from './gate.mjs';
import { readLabs, lessonLab, labRunner, secretHits, labCookie, LAB_ACTIONS, LAB_BODY_MAX, LAB_ID_RE } from './labs.mjs';
import { readBrand, withBrand, brandUrl } from './brand.mjs';

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
export const show = (v) => (v !== null && typeof v === 'object' ? (Array.isArray(v) ? 'an array' : 'an object')
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
// (plus previous, next and the path position) on a lesson page. Spec 48 D3: given lessonIndex's index and a
// lesson id, it adds those three as renderNav does, for an exported lesson that fetches nothing. Spec 51 D4: previous
// and next follow index.pages, the reading order with the divider pages, when withDividers set it.
export function navHtml(index = null, id = null) {
  const links = '<nav class="lesson-nav"><a class="lesson-nav-index" href="/">All lessons</a><a class="lesson-nav-progress" href="/progress">Progress</a><a class="lesson-nav-reading" href="/assets/reading.html">How to read</a>';
  if (!index) return links + '</nav>';
  const { prev, next } = neighbours(index.pages ?? index.lessons ?? [], id);
  const pos = pathPosition(index, id);
  const a = (e, text, cls) => `<a class="${cls}" href="${escapeHtml(e.path)}">${text}</a>`;
  return links + (prev ? a(prev, `&#8592; ${escapeHtml(prev.title)}`, 'lesson-nav-prev') : '') +
    (pos ? `<span class="lesson-nav-line">${pos}</span>` : '') + (next ? a(next, `${escapeHtml(next.title)} &#8594;`, 'lesson-nav-next') : '') + '</nav>';
}

// The server-inserted bar: after <body> on an HTML page that does not load quiz.js.
export const withNav = (html) => (/<script[^>]*quiz\.js/i.test(html) ? html : html.replace(/<body\b[^>]*>/i, (m) => m + navHtml()));

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
const STATIC_DIRS = ['lessons', 'reference', 'assets', 'brand'];
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
// `sourceHref(id)` is the href given a sources-block anchor that has none (`teach export` points it at sources.html).
export function footnoteCitations(html, titles = {}, sourceHref = (id) => `#src-${id}`) {
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
    const hrefOnly = /\bhref\s*=/.test(pre + post) ? '' : ` href="${esc(sourceHref(id))}"`;
    return `<a${pre}data-cite="${id}"${post}${hrefOnly} id="src-${esc(id)}">[${n}] ${esc(titles[id] ?? id)}</a>`;
  });
  return body + m[1] + srcBody + m[4] + after;
}

// Spec 49 D3: what the server shows of a lab: its cost line and the paths of the steps the author ran, escaped.
export const labStepsHtml = (lab) => `<p class="lab-cost">${escapeHtml(lab.cost)}</p><p>The author ran:</p>` +
  [lab.up, lab.verify, lab.down].filter(Boolean).map((c) => `<pre>${escapeHtml(c.script)}</pre>`).join('');
export const LAB_OPEN_LINE = '<p class="lab-open">To run this lab from the page, open the lab address teach serve printed when it started.</p>';
// After the opening tag of the lab block parseBlocks returns, when labs/labs.json is valid and names its data-lab:
// the steps, then under --labs on a request without the lab cookie (`lab: 'open'`) the lab-open line. With the
// cookie (`lab: 'live'`) the opening tag gains data-lab-live, and data-lab-verify when the lab has one, which the
// widget's buttons need. Else nothing.
function withLabSteps(ws, html, mode) {
  const l = lessonLab(html);
  if (!l?.id) return html;
  let labs;
  try { ({ labs } = readLabs(ws)); } catch { return html; }
  if (!Object.hasOwn(labs, l.id)) return html;
  const live = mode === 'live' ? ` data-lab-live${labs[l.id].verify ? ' data-lab-verify' : ''}` : '';
  return html.slice(0, l.start - 1) + live + '>' + labStepsHtml(labs[l.id]) + (mode === 'open' ? LAB_OPEN_LINE : '') + html.slice(l.start);
}

// The resolved file to serve for a URL path, or a status: 400 undecodable, 404 anything not allowlisted.
// `lab` is 'open' or 'live' under teach serve --labs (withLabSteps), else undefined.
export function serveFile(workspaceDir, urlPath, { titles, sourceHref, bytes = true, lab } = {}) {
  let decoded;
  try { decoded = decodeURIComponent(urlPath); } catch { return { status: 400 }; }
  if (decoded.includes('\0') || decoded.split('/').some((seg) => seg.startsWith('.'))) return { status: 404 };
  const target = join(workspaceDir, decoded);
  const glossary = target === join(workspaceDir, 'GLOSSARY.md');
  const allowed = glossary || STATIC_DIRS.some((d) => isInsideVault(join(workspaceDir, d), target));
  if (!allowed) return { status: 404 };
  try {
    if (glossary && lstatSync(target).isSymbolicLink()) return { status: 404 }; // allowed by name only: not followed
    if (!statSync(target).isFile()) return { status: 404 };
    if (!bytes) return { status: 200 };
    const body = readFileSync(target);
    const isPage = /\.html$/i.test(target) && (decoded.startsWith('/lessons/') || decoded.startsWith('/reference/'));
    const text = isPage && decoded.startsWith('/lessons/') ? withLabSteps(workspaceDir, body.toString('utf8'), lab) : isPage ? body.toString('utf8') : null;
    let out = isPage ? footnoteCitations(text, titles ?? {}, sourceHref) : body;
    if (/\.html$/i.test(target)) {
      out = withNav(out.toString('utf8'));
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
// review lesson marked (review); one lab row per directory under lessons/files/, named for the built lesson whose number begins it,
// then (spec 49 D9) one per lab of a valid labs/labs.json, named for the built lessons whose lab section names it.
export function readmeDraft(ws) {
  const { lessons } = lessonIndex(ws);
  const groups = new Map();
  for (const l of lessons) (groups.get(l.project) ?? groups.set(l.project, []).get(l.project)).push(l);
  const map = [...groups].map(([p, ls]) => `| ${p ?? '(no Project: line)'} | ${ls.map((l) => l.id + (lessonClass(`lessons/${l.id}.html`) === 'review' ? ' (review)' : '')).join(', ')} |  |`);
  const files = join(ws, 'lessons', 'files');
  const dirs = existsSync(files) ? readdirSync(files, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
  let manifest = {};
  try { ({ labs: manifest } = readLabs(ws)); } catch { /* teach lint reports it */ }
  const naming = (id) => lessons.filter((l) => lessonLab(readFileSync(join(ws, 'lessons', `${l.id}.html`), 'utf8'))?.id === id).map((l) => l.id).join(', ');
  const labs = [...dirs.map((d) => `| ${lessons.find((l) => l.id.slice(0, 4) === d.slice(0, 4))?.id ?? ''} | lessons/files/${d}/ |  |  |`),
    ...Object.entries(manifest).map(([id, lab]) => `| ${naming(id)} | labs/labs.json: ${id} | ${lab.cost.replaceAll('|', '\\|')}; env: ${lab.env?.length ? lab.env.join(', ') : 'none'} |  |`)];
  return [`## ${README_SECTIONS[3]}`, '', '| Group | Lessons | What it builds |', '|---|---|---|', ...map, '', `## ${README_SECTIONS[4]}`, '',
    ...(labs.length ? ["| Lesson | Files | Needs on the learner's machine | Fallback |", '|---|---|---|---|', ...labs] : ['No lesson ships files under `lessons/files/`.'])].join('\n') + '\n';
}

export const escapeHtml = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
// Spec 48 D2: `index` (default lessonIndex) and `readme` (the README's text, null for none; default read
// from the workspace) let `teach export` pass its filtered index and its README text.
function readmeText(ws) {
  const readme = join(ws, 'README.md');
  try {
    if (lstatSync(readme).isFile()) return readFileSync(readme, 'utf8');
  } catch { /* absent or unreadable: the page has no README */ }
  return null;
}
// Spec 51 D1: the index's groups, each run of consecutive lessons with the same project.
export function lessonRuns(lessons) {
  const runs = [];
  for (const l of lessons) {
    if (runs.at(-1)?.project !== l.project) runs.push({ project: l.project, lessons: [] });
    runs.at(-1).lessons.push(l);
  }
  return runs;
}
// D4: with the brand's dividers, the index plus `pages`, the reading order: each run with a project after its divider
// entry, k counted from 1 over those runs. index.lessons is untouched. Without dividers, the index itself.
export function withDividers(index, brand) {
  if (!brand?.dividers) return index;
  let k = 0;
  const pages = lessonRuns(index.lessons).flatMap((r) => (r.project === null ? r.lessons
    : [{ id: `divider-${++k}`, title: r.project, path: `/dividers/${k}.html` }, ...r.lessons]));
  return { ...index, pages };
}
const indexItem = (e) => `<li><a href="${escapeHtml(e.path)}">${escapeHtml(e.title)}</a>${e.shape ? ` <span class="lesson-shape">${escapeHtml(e.shape)}</span>` : ''} <small>${escapeHtml(e.id)}</small></li>`;
// D2: divider k's page over withDividers' index, or null when there is none: the bar, the image, the group's title, its lessons.
export function dividerHtml(index, k, brand) {
  const r = index.pages && lessonRuns(index.lessons).filter((x) => x.project !== null)[k - 1];
  if (!r) return null;
  const title = escapeHtml(r.project);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${title}</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body>${navHtml(index, `divider-${k}`)}<figure class="brand-divider"><img src="${escapeHtml(brandUrl(brand.dividers.image))}" alt="${escapeHtml(brand.dividers.alt ?? '')}"></figure><h1>${title}</h1>
<section data-block="index"><ol class="lesson-index">${r.lessons.map(indexItem).join('')}</ol></section>
</body></html>
`;
}
// Spec 51 D5: with index.pages, each heading links to its divider page.
export function indexHtml(ws, { index = lessonIndex(ws), readme = readmeText(ws) } = {}) {
  const { lessons, reference } = index;
  const readmeHtml = readme === null ? '' : `<section data-block="readme">${markdownHtml(readme)}</section>\n`;
  let k = 0;
  const heading = (p) => (index.pages ? `<h2><a href="/dividers/${++k}.html">${escapeHtml(p)}</a></h2>` : `<h2>${escapeHtml(p)}</h2>`);
  const lessonHtml = lessonRuns(lessons).map((r) => `${r.project ? heading(r.project) : ''}<ol class="lesson-index">${r.lessons.map(indexItem).join('')}</ol>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Lessons</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body>${navHtml()}${readmeHtml}<h1>Lessons</h1>
<p class="reading-link"><a href="/assets/reading.html">How to read a lesson</a></p>
<section data-block="index">${lessonHtml || '<ol class="lesson-index"></ol>'}</section>
${reference.length ? `<section data-block="reference-index"><ul class="lesson-index">${reference.map(indexItem).join('')}</ul></section>` : ''}
</body></html>
`;
}

// Spec 48: `teach export`, a static copy of the workspace that works from file://. An exported page is the
// served page (serveFile, indexHtml) passed through exportPage; everything is built in memory and checked before
// the command writes a byte.
const PLUGIN_ASSETS = fileURLToPath(new URL('../../skills/research-teach/assets/', import.meta.url));
// D7: what an exported page says in place of FOLLOWUP and CONNECT_LEAD, and the README's How to take it body.
export const EXPORT_TEXT = {
  followup: 'You can ask your instructor follow-up questions.',
  connect: 'Write your answer down, or send it to your instructor, in a few sentences:',
  howToTake: 'Open the lessons below in order. Your quiz answers are kept in this browser; use Export my results on the Progress page and send the file to your instructor.',
};
export const MENTION_RE = /\bin (?:the|your) terminal\b|\bteach serve\b|\bClaude Code\b/i;

// D2: the quiz.js tag made a deferred classic script, on a lesson the bar built here (D3), data-export and
// data-lesson on <body>, D7's two sentences replaced (not on sources.html), then every root-absolute href and src
// (one /, not //host) made relative to `path`, the page's path under --out: / is index.html, /progress progress.html.
// Spec 50 D4: first of all, the workspace's brand (readBrand's, null for none) with the year `year`.
export function exportPage(html, path, { key, index, brand = null, year }) {
  const name = /^lessons\/([^/]+)\.html$/.exec(path)?.[1];
  const id = name && LESSON_ID_RE.test(name) ? name : null;
  let out = withBrand(html, brand, { position: brand && lessonPosition(index, `/${path}`), year }).replace(/<script\b[^>]*quiz\.js[^>]*>/gi, (tag) => {
    const t = tag.replace(/\s+type\s*=\s*(["'])module\1/i, '');
    return /\sdefer\b/i.test(t) ? t : t.replace(/^<script\b/i, '<script defer');
  });
  if (/<script[^>]*quiz\.js/i.test(out)) out = out.replace(/<body\b[^>]*>/i, (m) => m + navHtml(index, id));
  out = out.replace(/<body\b([^>]*)>/i, (_, attrs) =>
    `<body data-export="${escapeHtml(key)}"${id && !/\sdata-lesson\s*=/i.test(attrs) ? ` data-lesson="${id}"` : ''}${attrs}>`);
  if (path !== 'sources.html') out = out.replace(loose(FOLLOWUP), EXPORT_TEXT.followup).replace(loose(CONNECT_LEAD), EXPORT_TEXT.connect);
  const up = '../'.repeat(path.split('/').length - 1);
  return out.replace(/(\s(?:href|src)\s*=\s*)(?:"\/(?!\/)([^"]*)"|'\/(?!\/)([^']*)')/gi, (m, attr, dq, sq) => {
    const q = dq === undefined ? "'" : '"';
    const [, p, tail] = /^([^?#]*)(.*)$/s.exec(dq ?? sq);
    return `${attr}${q}${up}${p === '' ? 'index.html' : p === 'progress' ? 'progress.html' : p}${tail}${q}`;
  });
}

// Spec 50 D3: [n, m] for the lesson served at `path`, its place among the index's lessons and their count, else null.
export const lessonPosition = (index, path) => {
  const i = index.lessons.findIndex((e) => e.path === path);
  return i === -1 ? null : [i + 1, index.lessons.length];
};

// D1: progress.html of an exported copy. quiz.js fills the progress section from this browser's storage, and
// exportPage adds the bar, as on any page that loads quiz.js.
export function localProgressHtml() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Progress</title><link rel="stylesheet" href="/assets/lesson.css"><script defer src="/assets/quiz.js"></script></head>
<body><h1>Progress</h1>
<section data-block="progress"></section>
</body></html>
`;
}

// D5: one <li id> per cited entry, in id order: its title (linked only to an http: or https: source_url), the
// date its id begins with and its summary, all escaped.
function sourcesHtml(ids, byId) {
  const li = (id) => {
    const e = byId.get(id);
    const url = typeof e.source_url === 'string' ? e.source_url : '';
    const title = escapeHtml(String(e.title ?? id));
    const date = /^\d{4}-\d{2}-\d{2}/.exec(id)?.[0];
    return `<li id="${escapeHtml(id)}">${/^https?:/i.test(url) && linkable(url) ? `<a href="${escapeHtml(url)}">${title}</a>` : title}` +
      `${date ? ` <small>${date}</small>` : ''}${e.summary ? `: ${escapeHtml(String(e.summary))}` : ''}</li>`;
  };
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sources</title><link rel="stylesheet" href="/assets/lesson.css"></head>
<body>${navHtml()}<h1>Sources</h1>
<ul class="sources">${ids.map(li).join('')}</ul>
</body></html>
`;
}

// D7: the body of the README's "## How to take it" section (to the next # or ## heading outside a fence) replaced.
function exportReadme(text) {
  const lines = text.split(/\r?\n/);
  let start = -1, end = lines.length, fence = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) fence = !fence;
    if (fence || !/^#{1,2}\s/.test(lines[i])) continue;
    if (start !== -1) { end = i; break; }
    if (/^##\s+(.+?)\s*#*\s*$/.exec(lines[i])?.[1].toLowerCase() === README_SECTIONS[2].toLowerCase()) start = i;
  }
  return start === -1 ? text : [...lines.slice(0, start + 1), '', EXPORT_TEXT.howToTake, '', ...lines.slice(end)].join('\n');
}

// Workspace-relative files under a directory; a symlinked directory is listed as a file, not followed, so
// serveFile (which stats it as no regular file) leaves it out.
function walk(ws, rel) {
  let ents;
  try { ents = readdirSync(join(ws, rel), { withFileTypes: true }); } catch { return []; }
  return ents.sort((a, b) => (a.name < b.name ? -1 : 1)).flatMap((d) => (d.isDirectory() ? walk(ws, `${rel}/${d.name}`) : [`${rel}/${d.name}`]));
}
const urlOf = (p) => '/' + p.split('/').map(encodeURIComponent).join('/');
// A fixed sentence matched with any run of whitespace between its words, so a sentence wrapped in the source matches.
const loose = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'), 'g');
// D7: a page's rendered text: the sources block (vault titles, as on sources.html), <pre> and <code> removed, a
// non-breaking space a space, every whitespace run one space (a source line break is a space), then a block-level
// tag a line break and any other tag nothing (script text such as quiz JSON stays); then its sentences, cut at a
// line break or after . ! ?, that name the terminal, teach serve or Claude Code. GLOSSARY.md is Markdown: a blank
// line ends a paragraph, a single line break is a space.
const BLOCK_TAG = /<\/?(?:p|div|section|article|aside|header|footer|main|nav|ul|ol|li|dl|dt|dd|h[1-6]|table|thead|tbody|tr|td|th|figure|figcaption|blockquote|script|style|title|head|body|br|hr)\b[^>]*>/gi;
const NBSP = /&nbsp;|&#160;|&#x0*a0;/gi;
// Only the last element whose data-block is sources, and only when it closes (matched by depth, as parseBlocks does);
// an earlier one, or an unclosed one, is checked like any other text.
function withoutSources(html) {
  const m = [...html.matchAll(/<([a-z][a-z0-9]*)\b[^>]*\bdata-block\s*=\s*(["'])sources\2[^>]*>/gi)].at(-1);
  if (!m) return html;
  const start = m.index + m[0].length;
  const re = new RegExp(`<(/?)${m[1]}\\b[^>]*>`, 'gi');
  re.lastIndex = start;
  for (let depth = 1, t; (t = re.exec(html));) if ((depth += t[1] ? -1 : 1) === 0) return html.slice(0, start) + ' ' + html.slice(t.index);
  return html;
}
const pageText = (html) => withoutSources(html).replace(/<pre\b[\s\S]*?<\/pre>/gi, '<br>').replace(/<code\b[\s\S]*?<\/code>/gi, ' ')
  .replace(NBSP, ' ').replace(/\s+/g, ' ').replace(BLOCK_TAG, '\n').replace(/<[^>]*>/g, '');
const markdownText = (md) => md.replace(NBSP, ' ').split(/\n[ \t]*\n/).map((p) => p.replace(/\s+/g, ' ')).join('\n');
const mentions = (text) => text.split(/\n|(?<=[.!?])\s/).map((s) => s.trim()).filter((s) => MENTION_RE.test(s));

// Issue 65: a file:// page cannot fetch a cast (Chrome refuses it on CORS), so each element carrying data-cast whose cast
// teach serve returns gets the cast's text in data-cast-text, which quiz.js hands the player.
const withCastText = (ws, p, html) => html.replace(/<[a-z][a-z0-9]*\b[^>]*?\sdata-cast\s*=\s*(["'])(.*?)\1/gi, (m, q, src) => {
  const t = imageTarget(ws, dirname(join(ws, p)), src);
  return t.ok ? `${m} data-cast-text="${escapeHtml(t.body.toString('utf8'))}"` : m;
});

// The files of the export (path under --out to content) and the lines to print, or code 1 and the refusals.
// `entries` is the vault manifest's; nothing is written here.
export function exportWorkspace(ws, { vaultPath, entries, skipUngated = false, env = process.env }) {
  const key = workspaceKey(ws);
  const gated = new Set(expandFiles(WORKSPACE_GATES, ws));
  const found = STATIC_DIRS.flatMap((d) => walk(ws, d)).filter((p) => serveFile(ws, urlOf(p), { bytes: false }).status === 200);
  const notGated = [], pages = [], raw = [], ungated = [];
  for (const p of found) {
    // The plugin's copies go out, under any case of the name (a case-insensitive disk serves Quiz.js as quiz.js).
    if (['assets/quiz.js', 'assets/reading.html'].includes(p.toLowerCase())) continue;
    if (!/\.html?$/i.test(p)) raw.push(p);
    else if (!gated.has(join(ws, p))) notGated.push(p);
    else (hasVerdict(join(ws, p), vaultPath) ? pages : ungated).push(p);
  }
  let readme = readmeText(ws);
  if (readme !== null && !hasVerdict(join(ws, 'README.md'), vaultPath)) ungated.push('README.md');
  if (skipUngated && ungated.includes('README.md')) readme = null;
  if (!skipUngated) pages.push(...ungated.filter((p) => p !== 'README.md')); // checked too, so one run lists every refusal
  const kept = new Set(pages);
  const full = lessonIndex(ws);
  const index = { ...full, lessons: full.lessons.filter((e) => kept.has(e.path.slice(1))), reference: full.reference.filter((e) => kept.has(e.path.slice(1))) };
  const { brand, problems: brandProblems } = readBrand(ws);
  const ctx = { key, index: withDividers(index, brand), brand, year: new Date().getFullYear() };
  const titles = Object.fromEntries(entries.map((e) => [e.id, e.title ?? e.id]));
  const sourceHref = (id) => `/sources.html#${encodeURIComponent(id)}`;
  const files = new Map();
  for (const p of pages) files.set(p, exportPage(withCastText(ws, p, serveFile(ws, urlOf(p), { titles, sourceHref }).body.toString('utf8')), p, ctx));
  files.set('index.html', exportPage(indexHtml(ws, { index: ctx.index, readme: readme === null ? null : exportReadme(readme) }), 'index.html', ctx));
  // Spec 51 D3, D6: the divider pages, generated, so no verdict is asked; the phrase check below reads them.
  for (let k = 1, d; (d = dividerHtml(ctx.index, k, brand)); k++) files.set(`dividers/${k}.html`, exportPage(d, `dividers/${k}.html`, ctx));
  files.set('progress.html', exportPage(localProgressHtml(), 'progress.html', ctx));
  files.set('assets/reading.html', exportPage(withNav(readFileSync(join(PLUGIN_ASSETS, 'reading.html'), 'utf8')), 'assets/reading.html', ctx));
  files.set('assets/quiz.js', readFileSync(join(PLUGIN_ASSETS, 'quiz.js'), 'utf8').replace(/^export /gm, ''));
  for (const p of raw) files.set(p, serveFile(ws, urlOf(p)).body);
  if (![...files.keys()].some((p) => p.toLowerCase() === 'assets/lesson.css')) files.set('assets/lesson.css', readFileSync(join(PLUGIN_ASSETS, 'lesson.css')));
  if (serveFile(ws, '/GLOSSARY.md', { bytes: false }).status === 200) files.set('GLOSSARY.md', serveFile(ws, '/GLOSSARY.md').body);

  const byId = new Map(entries.map((e) => [e.id, e]));
  const html = [...files].filter(([p]) => /\.html?$/i.test(p));
  const unknown = html.flatMap(([p, h]) => extractCites(h).filter((id) => !byId.has(id)).map((id) => `unknown-source ${p}: ${id}`));
  const ids = uniq(html.flatMap(([, h]) => extractCites(h))).filter((id) => byId.has(id)).sort();
  files.set('sources.html', exportPage(sourcesHtml(ids, byId), 'sources.html', ctx));
  const glossary = files.has('GLOSSARY.md') ? [['GLOSSARY.md', markdownText(files.get('GLOSSARY.md').toString('utf8'))]] : [];
  const mention = [...html.map(([p, h]) => [p, pageText(h)]), ...glossary].flatMap(([p, t]) => mentions(t).map((s) => `mention ${p}: ${s}`));
  // Two paths that differ only by case would be one file on a case-insensitive disk.
  const byCase = new Map();
  const collide = [...files.keys()].flatMap((p) => { const k = p.toLowerCase(); if (byCase.has(k)) return [`case-collision ${byCase.get(k)}: ${p}`]; byCase.set(k, p); return []; });
  // Spec 49 D8: a lab page needs a valid manifest, and no file of the copy may hold a declared env value.
  let manifest = null;
  try { ({ labs: manifest } = readLabs(ws)); } catch { /* refused below when a page has a lab section */ }
  const lab = manifest === null
    ? (html.some(([p, h]) => p.startsWith('lessons/') && lessonLab(h)) ? ['lab-manifest labs/labs.json: invalid; run teach lint'] : [])
    : secretHits([...files], manifest, env).map(([p, name]) => `secret ${p}: ${name}`);
  const brandLine = brandProblems.length ? ['brand brand/brand.json: invalid; run teach lint'] : [];
  const lines = [...notGated.map((p) => `not gated ${p}`), ...ungated.map((p) => `${skipUngated ? 'skipped' : 'ungated'} ${p}`), ...mention, ...unknown, ...collide, ...lab, ...brandLine];
  const error = !skipUngated && ungated.length
    ? `teach export: ${ungated.length} page(s) have no PASS or MERIT for their current content; nothing written (--skip-ungated leaves them out)` : null;
  if (error || mention.length || unknown.length || collide.length || lab.length || brandLine.length) return { code: 1, lines, error };
  const urlFor = (id) => byId.get(id).source_url;
  for (const id of ids) lines.push(`source ${id} ${typeof urlFor(id) === 'string' && urlFor(id) ? urlFor(id) : '-'}`);
  return { code: 0, lines, files };
}

// Writes the export under `dir`, which the caller has checked is absent or an empty directory; never overwrites.
// When a write fails, what this run created is removed (`dir` itself when it was absent) and the error rethrown.
export function writeExport(dir, files) {
  const existed = lstatSync(dir, { throwIfNoEntry: false }) !== undefined; // a dangling link exists: never removed
  const made = [];
  try {
    mkdirSync(dir, { recursive: true });
    for (const [p, body] of files) {
      const dest = join(dir, p);
      if (!isInsideVault(dir, dest)) throw new Error(`${p} would be written outside ${dir}`);
      const sub = mkdirSync(dirname(dest), { recursive: true });
      if (sub) made.push(sub);
      writeFileSync(dest, body, { flag: 'wx' });
      made.push(dest);
    }
  } catch (e) {
    for (const p of existed ? made.reverse() : [dir]) rmSync(p, { recursive: true, force: true });
    throw e;
  }
}

// The body as text once it has all arrived; past `max` bytes, counted as they arrive, 403 and the connection dropped.
function readBody(req, res, max, done) {
  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > max) {
      req.removeAllListeners('data').removeAllListeners('end').pause();
      return send(req, res, 403, 'forbidden\n', undefined, true);
    }
    chunks.push(c);
  });
  req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
}

function postAttempt(req, res, workspaceDir, origin, schema, now) {
  const type = req.headers['content-type'];
  const length = req.headers['content-length'];
  if (req.headers.origin !== origin || !/^application\/json(;\s*charset=utf-8)?$/i.test(type ?? '') ||
      (length !== undefined && !(Number(length) <= ATTEMPT_BODY_MAX))) {
    return send(req, res, 403, 'forbidden\n', undefined, true);
  }
  readBody(req, res, ATTEMPT_BODY_MAX, (text) => {
    let body;
    try { body = JSON.parse(text); } catch { return send(req, res, 400, 'malformed JSON\n'); }
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

// Spec 49 D4: equal strings, compared in constant time once their byte lengths match.
const same = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// Spec 49 D4, under teach serve --labs only (`labs`). `t` is the lab address value, 64 hex characters, which the
// caller prints; every GET /labs/open?t=<t> for the life of the server sets the lab cookie to one session value, made at
// the first. Under labs every response forbids framing. `env` is the
// environment check 11 reads, the scripts' environment comes from and redaction takes its values from; `log` gets one
// line per lab request that passes check 5; `limits` replaces labs.mjs's STOP_GRACE, KILL_WAIT, CHECK_TIMEOUT or
// LAB_OUTPUT_MAX. t and the session value are never written to a page, a response body or a log line. Under labs
// the server carries stopLabs (the Stop sequence on every running group) and killLabs (SIGKILL to each) for the
// caller's signal and exit handlers.
export function createServer(workspaceDir, { schema, now = () => new Date(), titles = {}, labs = false, t, env = process.env, log = () => {}, limits } = {}) {
  const ws = resolve(workspaceDir);
  const clock = typeof now === 'function' ? now : () => now;
  if (labs && !/^[0-9a-f]{64}$/.test(t ?? '')) throw new Error('teach serve --labs needs a lab address value of 64 hex characters');
  let session = null;
  const runner = labs ? labRunner(ws, { env, log, limits }) : null;
  const hasCookie = (req, port) => session !== null && String(req.headers.cookie ?? '').split(';').some((p) => {
    const i = p.indexOf('=');
    return i !== -1 && p.slice(0, i).trim() === labCookie(port) && same(p.slice(i + 1).trim(), session);
  });
  // A wrong or missing t is 403 and sets no cookie; next is used only when it is /lessons/<lesson id>.html.
  const openLabs = (req, res, port) => {
    if (req.method !== 'GET') return send(req, res, 405, 'method not allowed\n');
    const q = new URLSearchParams(req.url.includes('?') ? req.url.slice(req.url.indexOf('?') + 1) : '');
    const ts = q.getAll('t');
    if (ts.length !== 1 || !same(ts[0], t)) return send(req, res, 403, 'forbidden\n');
    session ??= randomBytes(32).toString('hex');
    const next = q.get('next') ?? '';
    const lesson = /^\/lessons\/([^/]+)\.html$/.exec(next)?.[1];
    res.writeHead(303, {
      Location: lesson && LESSON_ID_RE.test(lesson) ? next : '/',
      'Set-Cookie': `${labCookie(port)}=${session}; HttpOnly; SameSite=Strict; Path=/`,
      'Cache-Control': 'no-store', 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff',
    });
    res.end();
  };
  // Checks 3 to 5 of a lab POST (1 and 2 are the caller's), in order, 3 and 4 before a byte of the body is read; then the
  // runner's checks 6 to 13 and the action.
  const postLab = (req, res, action, port) => {
    const type = req.headers['content-type'];
    const length = req.headers['content-length'];
    if (req.headers.origin !== `http://127.0.0.1:${port}` || !/^application\/json(;\s*charset=utf-8)?$/i.test(type ?? '') ||
        (length !== undefined && !(Number(length) <= LAB_BODY_MAX))) {
      return send(req, res, 403, 'forbidden\n', undefined, true);
    }
    if (!hasCookie(req, port)) return send(req, res, 403, 'no lab cookie; open the lab address teach serve printed\n', undefined, true);
    readBody(req, res, LAB_BODY_MAX, (text) => {
      let body = null;
      try { body = JSON.parse(text); } catch { /* the 400 below */ }
      if (!keysAre(body, ['lab']) || typeof body.lab !== 'string' || !LAB_ID_RE.test(body.lab)) return send(req, res, 400, 'body must be {"lab": "<id>"}\n');
      const refused = runner.post(action, body.lab, res);
      if (!refused) return;
      log(`lab ${body.lab} ${action}: ${refused[0]} ${refused[1]}`);
      send(req, res, refused[0], `${refused[1]}\n`);
    });
  };
  // requireHostHeader off: a missing Host gets our 403, not node:http's own 400.
  const server = http.createServer({ requireHostHeader: false }, (req, res) => {
    const base = `127.0.0.1:${server.address().port}`;
    if (labs) { // spec 49 D4: no page of a --labs server can be framed, so none can be clicked through a frame
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    }
    const isBodyless = req.method === 'GET' || req.method === 'HEAD';
    if (req.headers.host !== base) return send(req, res, 403, 'forbidden\n', undefined, !isBodyless);
    const path = req.url.split('?')[0];
    const port = server.address().port;
    if (req.method === 'POST') {
      if (path === '/attempt') return postAttempt(req, res, ws, `http://${base}`, schema, clock);
      const action = /^\/lab\/([a-z]+)$/.exec(path)?.[1];
      if (labs && LAB_ACTIONS.includes(action)) return postLab(req, res, action, port);
      return send(req, res, 404, 'not found\n', undefined, true);
    }
    if (!isBodyless) return send(req, res, 405, 'method not allowed\n', undefined, true);
    if (labs && path === '/labs/open') return openLabs(req, res, port);
    // Spec 50 D4: every HTML reply carries the brand, read on each request; with none, or an invalid one, the page as it is.
    const branded = (html) => {
      const { brand } = readBrand(ws);
      return withBrand(html, brand, { position: brand && lessonPosition(lessonIndex(ws), path), year: clock().getFullYear() });
    };
    // Spec 51 D4: with the brand's dividers, /lessons.json's lessons is the reading order, divider pages included.
    const divided = () => { const { brand } = readBrand(ws); return { brand, index: withDividers(lessonIndex(ws), brand) }; };
    if (path === '/') return send(req, res, 200, branded(indexHtml(ws, { index: divided().index })), 'text/html; charset=utf-8');
    if (path === '/lessons.json') {
      const { pages, ...index } = divided().index;
      return send(req, res, 200, JSON.stringify(pages ? { ...index, lessons: pages } : index), 'application/json');
    }
    if (path === '/progress') return send(req, res, 200, branded(progressHtml(progress(ws, { now: clock() }))), 'text/html; charset=utf-8');
    if (path === '/progress.json') return send(req, res, 200, JSON.stringify(progress(ws, { now: clock() })), 'application/json');
    const k = /^\/dividers\/([1-9]\d*)\.html$/.exec(path)?.[1];
    const d = k && divided();
    const divider = d && dividerHtml(d.index, Number(k), d.brand);
    if (divider) return send(req, res, 200, branded(divider), 'text/html; charset=utf-8');
    const f = serveFile(ws, path, { titles, lab: labs ? (hasCookie(req, port) ? 'live' : 'open') : undefined });
    if (f.status !== 200) return send(req, res, f.status, f.status === 400 ? 'bad request\n' : 'not found\n');
    send(req, res, 200, f.type.startsWith('text/html') ? branded(f.body) : f.body, f.type); // HEAD: node:http drops the body itself
  });
  if (runner) {
    server.stopLabs = runner.stopAll;
    server.killLabs = runner.killAll;
  }
  return server;
}
