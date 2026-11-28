// research-teach formats: id patterns, fixed lesson text, README headings and HTML block parsing and extraction.
// Reads PATH.md after checking that it resolves inside the workspace.
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isInsideVault } from './containment.ts';
import { isRecord, parseJson } from './unknowns.ts';

export const LESSON_ID_RE: RegExp = /^\d{4}-[a-z][a-z0-9-]*$/;
// A record id has the form of a lesson id by design.
export const RECORD_ID_RE: RegExp = LESSON_ID_RE;

export const uniq = <T>(xs: Iterable<T>): T[] => [...new Set(xs)];

// HTML extraction (regex; lessons are static HTML written by the skill).
// An attribute's value from a tag's attribute text, read in order with each quoted value skipped whole,
// so a name inside another attribute's value is not read; '' for a bare attribute, null when absent.
export const attrOf = (attrs: string, name: string): string | null => {
  for (const m of attrs.matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g)) {
    const attr = m[1];
    if (attr === undefined) throw new Error('attrOf: expected an attribute name');
    if (attr.toLowerCase() === name) return m[2] ?? m[3] ?? m[4] ?? '';
  }
  return null;
};

export function extractQuizJson(html: string): string | null {
  for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const [, attrs, json] = m;
    if (attrs === undefined || json === undefined) throw new Error('extractQuizJson: expected script attributes and contents');
    if (/\bdata-quiz\b/i.test(attrs) && /\btype\s*=\s*["']application\/json["']/i.test(attrs)) return json;
  }
  return null;
}

export function extractCites(html: string): string[] {
  return uniq([...html.matchAll(/\bdata-cite\s*=\s*(["'])(.*?)\1/g)].map((m: RegExpMatchArray) => {
    const cite = m[2];
    if (cite === undefined) throw new Error('extractCites: expected a citation value');
    return cite;
  }));
}

export const FOLLOWUP: string = 'You can ask follow-up questions in the terminal.';

// Spec 48 D7: the connect block's opening sentence; `teach export` replaces it, and WARN_CONNECT_LEAD flags another.
export const CONNECT_LEAD: string = 'Type your answer to Claude Code in the terminal, in a few sentences:';

export function lessonClass(filePath: string): 'reference' | 'review' | 'lesson' | null {
  const parent = basename(dirname(filePath));
  const name = basename(filePath);
  if (!name.endsWith('.html')) return null;
  if (parent === 'reference') return 'reference';
  const id = name.slice(0, -5);
  if (parent !== 'lessons' || !LESSON_ID_RE.test(id)) return null;
  return /^\d{4}-review-/.test(id) ? 'review' : 'lesson';
}

type Block = { attrs: string; html: string; start: number };
type BlockSpan = Block & { name: string; end: number };

// Each `data-block` element: its opening tag's attributes and its inner HTML, matched to the
// closing tag of the same name by depth. First occurrence of a block name wins.
export function parseBlocks(html: string): Map<string, Block> {
  const blocks = new Map<string, Block>();
  for (const { name, attrs, html: inner, start } of blockSpans(html)) {
    if (!blocks.has(name)) blocks.set(name, { attrs, html: inner, start });
  }
  return blocks;
}

// All occurrences in document order, including the exact inner-HTML offsets for the gate.
export function blockSpans(html: string): BlockSpan[] {
  const blocks: BlockSpan[] = [];
  for (const m of html.matchAll(/<([a-z][a-z0-9]*)\b([^>]*\bdata-block\s*=\s*(["'])([^"']+)\3[^>]*)>/gi)) {
    const [open, tag, attrs, , name] = m;
    if (attrs === undefined || name === undefined) throw new Error('blockSpans: expected block attributes and name');
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

type QuizResult = { items: unknown[]; error?: never } | { error: string; items?: never };

export function parseQuiz(html: string): QuizResult {
  const json = extractQuizJson(html);
  if (json === null) return { error: 'no quiz data block' };
  let quiz: unknown;
  try { quiz = parseJson(json); } catch (e) {
    if (!(e instanceof Error)) throw e;
    return { error: `quiz JSON does not parse: ${e.message}` };
  }
  if (!isRecord(quiz) || !Array.isArray(quiz.items)) return { error: 'quiz JSON has no items array' };
  const items: unknown[] = quiz.items;
  const bad = items.findIndex((it: unknown) => !isRecord(it) || !Array.isArray(it.options));
  if (bad !== -1) return { error: `quiz item ${bad} has no options array` };
  return { items };
}

// The items of the lesson's one attempt (spec 22 D1, D6.5): the predict block's item first, as item 0,
// then the quiz block's items (the whole page's first data-quiz when there is neither block). quiz.js
// renders the same order. `{ error }` when either part does not parse.
export function lessonItems(html: string): QuizResult {
  const blocks = parseBlocks(html);
  const parts = [blocks.get('predict')?.html, blocks.get('quiz')?.html ?? (blocks.has('predict') ? undefined : html)]
    .filter((h: string | undefined) => h !== undefined).map(parseQuiz);
  const items: unknown[][] = [];
  for (const part of parts) {
    if (part.error !== undefined) return part;
    items.push(part.items);
  }
  return parts.length ? { items: items.flat() } : { error: 'no quiz data block' };
}

type PathLine = { n: number; title: string; terms: string[]; tool: string | null; after: string[]; lesson: string | null };

// PATH.md lines: `N. <title> | terms: a, b | tool: x | after: 1, 2 | lesson: <id>`.
export function readPath(workspaceDir: string): PathLine[] | null {
  const p = join(workspaceDir, 'PATH.md');
  if (!isInsideVault(workspaceDir, p) || !existsSync(p)) return null;
  const lines: PathLine[] = [];
  for (const raw of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*(\d+)\.\s+([^|]+?)\s*((?:\|[^|]*)*)$/.exec(raw);
    if (!m) continue;
    const [, , title, fields] = m;
    if (title === undefined || fields === undefined) throw new Error('readPath: expected a title and fields');
    const line: PathLine = { n: Number(m[1]), title: title.trim(), terms: [], tool: null, after: [], lesson: null };
    for (const part of fields.split('|').map((x: string) => x.trim()).filter(Boolean)) {
      const f = /^([a-z]+):\s*(.*)$/i.exec(part);
      if (!f) continue;
      const [, field, value] = f;
      if (field === undefined || value === undefined) throw new Error('readPath: expected a field name and value');
      const key = field.toLowerCase();
      const vals = value.split(',').map((x: string) => x.trim()).filter(Boolean);
      if (key === 'terms') line.terms = vals.map((x: string) => x.toLowerCase());
      else if (key === 'tool') line.tool = (vals[0] ?? '').toLowerCase() || null;
      else if (key === 'after') line.after = vals.map((x: string) => x.toLowerCase());
      else if (key === 'lesson') line.lesson = vals[0] ?? null;
    }
    lines.push(line);
  }
  return lines;
}

// An attribute's value in an <img> tag's attribute text, or undefined.
export const imgAttr = (attrs: string, name: string): string | undefined => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(attrs)?.[2];

export const isProject = (l: { title: string }): boolean => /^project:/i.test(l.title);

// README-FORMAT.md's five section headings, in order.
export const README_SECTIONS: readonly [string, string, string, string, string] = ['What this is for', 'Before you start', 'How to take it', 'Lesson map', 'Labs'];
