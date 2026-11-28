// research-teach formats: id patterns, fixed lesson text, README headings and HTML block parsing and extraction.
// Reads PATH.md after checking that it resolves inside the workspace.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isInsideVault } from './containment.ts';

export const LESSON_ID_RE = /^\d{4}-[a-z][a-z0-9-]*$/;
// A record id has the form of a lesson id by design.
export const RECORD_ID_RE = LESSON_ID_RE;

export const uniq = (xs) => [...new Set(xs)];

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

export const FOLLOWUP = 'You can ask follow-up questions in the terminal.';

// Spec 48 D7: the connect block's opening sentence; `teach export` replaces it, and WARN_CONNECT_LEAD flags another.
export const CONNECT_LEAD = 'Type your answer to Claude Code in the terminal, in a few sentences:';

export function lessonClass(filePath) {
  const parent = basename(dirname(filePath));
  const name = basename(filePath);
  if (!name.endsWith('.html')) return null;
  if (parent === 'reference') return 'reference';
  const id = name.slice(0, -5);
  if (parent !== 'lessons' || !LESSON_ID_RE.test(id)) return null;
  return /^\d{4}-review-/.test(id) ? 'review' : 'lesson';
}

// Each `data-block` element: its opening tag's attributes and its inner HTML, matched to the
// closing tag of the same name by depth. First occurrence of a block name wins.
export function parseBlocks(html) {
  const blocks = new Map();
  for (const { name, attrs, html: inner, start } of blockSpans(html)) {
    if (!blocks.has(name)) blocks.set(name, { attrs, html: inner, start });
  }
  return blocks;
}

// All occurrences in document order, including the exact inner-HTML offsets for the gate.
export function blockSpans(html) {
  const blocks = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bdata-block\s*=\s*(["'])([^"']+)\3[^>]*)>/gi)) {
    const [open, tag, attrs, , name] = m;
    const start = m.index + open.length;
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = start;
    let depth = 1;
    let end = html.length;
    for (let t; (t = re.exec(html));) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { end = t.index; break; }
    }
    blocks.push({ name, attrs, html: html.slice(start, end), start, end });
  }
  return blocks;
}

export function parseQuiz(html) {
  const json = extractQuizJson(html);
  if (json === null) return { error: 'no quiz data block' };
  let quiz;
  try { quiz = JSON.parse(json); } catch (e) { return { error: `quiz JSON does not parse: ${e.message}` }; }
  if (!quiz || !Array.isArray(quiz.items)) return { error: 'quiz JSON has no items array' };
  const bad = quiz.items.findIndex((it) => !it || !Array.isArray(it.options));
  if (bad !== -1) return { error: `quiz item ${bad} has no options array` };
  return { items: quiz.items };
}

// The items of the lesson's one attempt (spec 22 D1, D6.5): the predict block's item first, as item 0,
// then the quiz block's items (the whole page's first data-quiz when there is neither block). quiz.js
// renders the same order. `{ error }` when either part does not parse.
export function lessonItems(html) {
  const blocks = parseBlocks(html);
  const parts = [blocks.get('predict')?.html, blocks.get('quiz')?.html ?? (blocks.has('predict') ? undefined : html)]
    .filter((h) => h !== undefined).map(parseQuiz);
  const bad = parts.find((p) => p.error);
  return bad ?? (parts.length ? { items: parts.flatMap((p) => p.items) } : { error: 'no quiz data block' });
}

// PATH.md lines: `N. <title> | terms: a, b | tool: x | after: 1, 2 | lesson: <id>`.
export function readPath(workspaceDir) {
  const p = join(workspaceDir, 'PATH.md');
  if (!isInsideVault(workspaceDir, p) || !existsSync(p)) return null;
  const lines = [];
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(\d+)\.\s+([^|]+?)\s*((?:\|[^|]*)*)$/.exec(raw);
    if (!m) continue;
    const line = { n: Number(m[1]), title: m[2].trim(), terms: [], tool: null, after: [], lesson: null };
    for (const part of m[3].split('|').map((x) => x.trim()).filter(Boolean)) {
      const f = /^([a-z]+):\s*(.*)$/i.exec(part);
      if (!f) continue;
      const key = f[1].toLowerCase();
      const vals = f[2].split(',').map((x) => x.trim()).filter(Boolean);
      if (key === 'terms') line.terms = vals.map((x) => x.toLowerCase());
      else if (key === 'tool') line.tool = (vals[0] ?? '').toLowerCase() || null;
      else if (key === 'after') line.after = vals.map((x) => x.toLowerCase());
      else if (key === 'lesson') line.lesson = vals[0] ?? null;
    }
    lines.push(line);
  }
  return lines;
}

// An attribute's value in an <img> tag's attribute text, or undefined.
export const imgAttr = (attrs, name) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs)?.[2];

export const isProject = (l) => /^project:/i.test(l.title);

// README-FORMAT.md's five section headings, in order.
export const README_SECTIONS = ['What this is for', 'Before you start', 'How to take it', 'Lesson map', 'Labs'];
