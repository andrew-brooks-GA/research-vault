// research-teach workspace store: learning records, attempts and the derived index.
// Pure logic over a workspace directory; the verbs live in bin/commands/teach.mjs.
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFrontmatter, serializeFrontmatter } from './frontmatter.mjs';
import { writeEntry } from './fsutil.mjs';
import { loadTeachSchema } from './schema.mjs';
import { allowedValues } from './validate.mjs';
import { slugify } from './ids.mjs';
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

// `teach lint --fix` upgrade for a record with no frontmatter at all. A file with malformed
// frontmatter is left alone (the lint reports PARSE); `now` is unused, the date is the mtime.
export function fixRecordFrontmatter(workspaceDir, file, now) {
  const dir = join(workspaceDir, 'learning-records');
  const path = resolve(dir, file);
  const text = readFileSync(path, 'utf8');
  if (/^﻿?---\r?\n/.test(text)) return false;
  const slug = basename(path, '.md').replace(/^\d{4}-/, '');
  const data = {
    title: /^#\s+(.+?)\s*$/m.exec(text)?.[1] ?? slug,
    type: 'learning-record',
    date: isoDate(statSync(path).mtime),
    status: 'active',
    kind: 'understanding',
  };
  const lr = /Status:\s*superseded by LR-(\d{4})/.exec(text);
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
  const attempts = parsedRows(join(workspaceDir, 'attempts'), ATTEMPT_ID_RE);
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
  return { criteria: missionCriteria(workspaceDir), lessons, records, attempts, backlinks };
}
