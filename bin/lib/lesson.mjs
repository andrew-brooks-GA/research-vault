// research-teach lesson parser and the `teach lint` checks for lessons, reference docs and the
// workspace store (spec 12 "Lesson lint"). Pure over files; the verb lives in bin/commands/teach.mjs.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { checkCitations } from '../commands/check.mjs';
import { matchRows } from '../commands/search.mjs';
import { traverse } from './graph.mjs';
import {
  extractQuizJson, extractCites, validateEntry, ENUM_CODES, LESSON_ID_RE, RECORD_ID_RE,
} from './teach.mjs';
import { answerLengthSpread } from '../../skills/research-teach/assets/quiz.js';

export const QUIZ_MIN_ITEMS = 3;
export const QUIZ_SPREAD_MAX = 1.6;
// Figure constants (spec 22 D4): lesson.css sets min-width 27.5rem (440px) so 440 units draw at scale 1.
export const FIGURE_VIEWBOX_MAX = 440;
export const FIGURE_LABEL_MIN = 14;
export const FIGURE_LABEL_MAX = 40;
const FOLLOWUP = 'You can ask follow-up questions in the terminal.';
// Spec 22 D1: a lesson is the frame (prereq optional) around its shape's middle, in this one table.
// D3: a project's scaffold is optional (the mission's first project carries one), so it is not listed.
const FRAME = ['mission', 'sources', 'followup'];
export const SHAPES = {
  concept: ['model', 'fact', 'quiz', 'connect'],
  tool: ['model', 'example', 'complete', 'step'],
  diagnose: ['predict', 'model', 'fact', 'quiz'],
  project: ['step'],
};
// A lesson with no data-shape is a concept lesson with the list it had before shapes (D0.3); review
// lessons and reference docs keep their own lists.
const UNSHAPED = {
  lesson: [...FRAME, 'model', 'fact', 'example', 'quiz', 'step'],
  review: [...FRAME, 'quiz'],
  reference: ['note', 'sources'],
};
const WITHHELD = /<mark\b[^>]*\baria-label\s*=\s*(["'])withheld\1[^>]*>[\s\S]*?<\/mark>/i;

const textOf = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
// Spec 37: the time-relative phrases teach lint warns on (LESSON-FORMAT.md, Prose).
export const TIME_WORDS = ['currently', 'recently', 'nowadays', 'at the moment', 'as of now', 'as of today'];
const listDir = (dir, ext) => (existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(ext)).sort() : []);

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
    if (!blocks.has(name)) blocks.set(name, { attrs, html: html.slice(start, end) });
  }
  return blocks;
}

function parseQuiz(html) {
  const json = extractQuizJson(html);
  if (json === null) return { error: 'no quiz data block' };
  let quiz;
  try { quiz = JSON.parse(json); } catch (e) { return { error: `quiz JSON does not parse: ${e.message}` }; }
  if (!quiz || !Array.isArray(quiz.items)) return { error: 'quiz JSON has no items array' };
  const bad = quiz.items.findIndex((it) => !it || !Array.isArray(it.options));
  if (bad !== -1) return { error: `quiz item ${bad} has no options array` };
  return { items: quiz.items };
}

export function parseLesson(html) {
  const blocks = parseBlocks(html);
  return {
    blocks,
    quiz: parseQuiz(blocks.get('quiz')?.html ?? html),
    cites: extractCites(html),
    links: [...html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]),
  };
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

// GitHub-style heading slug: lowercase, punctuation other than hyphens dropped, spaces to hyphens.
const slug = (s) => s.trim().toLowerCase().replace(/[^\p{L}\p{N}_\- ]/gu, '').replace(/ /g, '-');

function linkResolves(ws, fromDir, href) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href === '') return true;
  const [pathPart, frag] = href.split('?')[0].split('#');
  const target = resolve(fromDir, pathPart);
  if (target === join(ws, 'GLOSSARY.md')) {
    if (!existsSync(target)) return false;
    if (!frag) return true;
    const text = readFileSync(target, 'utf8');
    return [...text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].some((m) => slug(m[1]) === frag) ||
      new RegExp(`\\bid\\s*=\\s*["']${frag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["']`).test(text);
  }
  const parent = dirname(target);
  if (parent !== join(ws, 'lessons') && parent !== join(ws, 'reference')) return true; // not checked
  return existsSync(target);
}

function quizFindings(quiz, cls, ws, add) {
  if (quiz.error) { add('QUIZ_JSON_INVALID', quiz.error); return; }
  const { items } = quiz;
  if (items.length < QUIZ_MIN_ITEMS) add('QUIZ_TOO_FEW', `quiz has ${items.length} item(s), need at least ${QUIZ_MIN_ITEMS}`);
  items.forEach((it, i) => {
    const n = it.options.length;
    const optionsOk = (n === 3 || n === 4) && it.options.every((o) => typeof o === 'string' && o.trim());
    if (!optionsOk) add('QUIZ_OPTION_COUNT', `item ${i} has ${n} option(s), need 3 or 4 non-empty strings`);
    if (!(Number.isInteger(it.correct) && it.correct >= 0 && it.correct < n)) add('QUIZ_CORRECT_RANGE', `item ${i} correct ${JSON.stringify(it.correct)} is not an option index`);
    if (optionsOk) {
      const spread = answerLengthSpread(it);
      if (spread > QUIZ_SPREAD_MAX) add('QUIZ_ANSWER_SPREAD', `item ${i} answer length spread ${spread.toFixed(2)} (max ${QUIZ_SPREAD_MAX})`);
    }
    if (!(Array.isArray(it.why) && it.why.length === n && it.why.every((w) => typeof w === 'string' && w.trim()))) {
      add('QUIZ_WHY_MISSING', `item ${i} needs one non-empty why per option`);
    }
    if (cls === 'review') {
      if (it.record === undefined || it.record === null || it.record === '') add('QUIZ_RECORD_UNRESOLVED', `item ${i} has no record`);
      else if (!RECORD_ID_RE.test(String(it.record)) || !existsSync(join(ws, 'learning-records', `${it.record}.md`))) {
        add('QUIZ_RECORD_UNRESOLVED', `item ${i} record ${it.record} has no learning record`);
      }
    }
  });
}

// --- Floor and path (spec 12, "one new tool or term set per lesson") ---
export const KNOWN_TOOLS_HEADING = /^#{1,6}\s+known tools\b/i;
export const MAX_INTRODUCES = 3;

// Bullets under a heading (any level) whose text matches `headingRe`, lower-cased.
// null when the heading is absent.
function missionList(workspaceDir, headingRe) {
  const p = join(workspaceDir, 'MISSION.md');
  if (!existsSync(p)) return null;
  let found = false;
  let inSection = false;
  const out = new Set();
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) { inSection = headingRe.test(line); if (inSection) found = true; continue; }
    const m = inSection && /^\s*(?:[-*]|\d+\.)\s+(.+?)\s*$/.exec(line);
    if (m) out.add(m[1].replace(/`/g, '').toLowerCase());
  }
  return found ? out : null;
}

// The mission's Floor: terms they can define, terms they named as new (tools: missionKnownTools).
export function missionFloor(workspaceDir) {
  return {
    knownTerms: missionList(workspaceDir, /^#{1,6}\s+known terms\b/i),
    newTerms: missionList(workspaceDir, /^#{1,6}\s+new to me\b/i),
  };
}

// PATH.md lines: `N. <title> | terms: a, b | tool: x | after: 1, 2 | lesson: <id>`.
export function readPath(workspaceDir) {
  const p = join(workspaceDir, 'PATH.md');
  if (!existsSync(p)) return null;
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

const bodyAttrList = (html, attr) => {
  const m = new RegExp(`<body\\b[^>]*\\b${attr}\\s*=\\s*(["'])([^"']*)\\1`, 'i').exec(html);
  return m ? m[2].split(',').map((t) => t.trim().toLowerCase()).filter(Boolean) : [];
};

// Terms declared by `data-introduces` on every lesson numbered at or below `lessonId`.
export function introducedTerms(workspaceDir, lessonId) {
  const out = new Set();
  for (const f of listDir(join(workspaceDir, 'lessons'), '.html')) {
    const id = f.slice(0, -5);
    if (!LESSON_ID_RE.test(id) || id.slice(0, 4) > lessonId.slice(0, 4)) continue;
    for (const t of bodyAttrList(readFileSync(join(workspaceDir, 'lessons', f), 'utf8'), 'data-introduces')) out.add(t);
  }
  return out;
}

// Every term the workspace tracks: the Floor's "New to me" plus every lesson's data-introduces.
export function trackedTerms(workspaceDir) {
  const out = new Set(missionFloor(workspaceDir).newTerms ?? []);
  for (const f of listDir(join(workspaceDir, 'lessons'), '.html')) {
    if (!LESSON_ID_RE.test(f.slice(0, -5))) continue;
    for (const t of bodyAttrList(readFileSync(join(workspaceDir, 'lessons', f), 'utf8'), 'data-introduces')) out.add(t);
  }
  return out;
}

// The prose a term rule reads: every block except sources and followup, with <pre> blocks removed
// (output and YAML name things before the lesson defines them) and the predict and quiz items included.
function proseOf(blocks, quiz) {
  let text = '';
  for (const [name, b] of blocks) {
    if (name === 'sources' || name === 'followup') continue;
    text += ' ' + textOf(b.html.replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ').replace(/<script\b[\s\S]*?<\/script>/gi, ' '));
  }
  const predict = blocks.has('predict') ? parseQuiz(blocks.get('predict').html).items ?? [] : [];
  for (const it of [...predict, ...(quiz.items ?? [])]) text += ' ' + [it.q, ...(it.options ?? []), ...(it.why ?? [])].join(' ');
  return text;
}

const termRe = (t) => new RegExp(`(^|[^\\p{L}\\p{N}_-])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\p{L}\\p{N}_-])`, 'iu');

const unescapeHtml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// Tools listed under MISSION.md's "Known tools" heading: the first word of each bullet, lowercased.
// null when the section is absent, so the caller can tell "no tools" from "no section".
export function missionKnownTools(workspaceDir) {
  const p = join(workspaceDir, 'MISSION.md');
  if (!existsSync(p)) return null;
  let found = false;
  let inSection = false;
  const out = new Set();
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) { inSection = KNOWN_TOOLS_HEADING.test(line); if (inSection) found = true; continue; }
    const m = inSection && /^\s*(?:[-*]|\d+\.)\s+`?([^\s`]+)/.exec(line);
    if (m) out.add(m[1].toLowerCase());
  }
  return found ? out : null;
}

// Tools declared by `data-teaches="a,b"` on the <body> of every lesson numbered at or below `lessonId`.
// A lesson may use the tool it teaches; later lessons inherit it.
export function taughtTools(workspaceDir, lessonId) {
  const out = new Set();
  for (const f of listDir(join(workspaceDir, 'lessons'), '.html')) {
    const id = f.slice(0, -5);
    if (!LESSON_ID_RE.test(id) || id.slice(0, 4) > lessonId.slice(0, 4)) continue;
    const m = /<body\b[^>]*\bdata-teaches\s*=\s*(["'])([^"']*)\1/i.exec(readFileSync(join(workspaceDir, 'lessons', f), 'utf8'));
    if (m) for (const t of m[2].split(',')) { const tool = t.trim().toLowerCase(); if (tool) out.add(tool); }
  }
  return out;
}

const preLines = (html) => [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)]
  .flatMap((pre) => unescapeHtml(pre[1].replace(/<[^>]*>/g, '')).split('\n').map((l) => l.trim()));
// The commands an example block runs: its `$ ` lines, without the prompt.
const exampleCommands = (blocks) => preLines(blocks.get('example')?.html ?? '').filter((l) => l.startsWith('$ ')).map((l) => l.slice(2).trim());

// The tools a lesson's commands invoke, as a Map of tool -> block name. In `example`, a command is a <pre>
// line starting with `$ `; in `step`, every non-empty, non-comment <pre> line is a command. One tool per
// pipe, `&&` or `;` segment, skipping VAR=value prefixes. Tokens with a path separator are not tools.
export function commandTools(blocks) {
  const tools = new Map();
  for (const name of ['example', 'step']) {
    const b = blocks.get(name);
    if (!b) continue;
    const lines = name === 'example' ? exampleCommands(blocks) : preLines(b.html).filter((l) => l && !l.startsWith('#'));
    for (const line of lines) {
      for (const seg of line.split(/\s\|\s|\s&&\s|\s;\s/)) {
        const words = seg.trim().split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
        const tool = words[0]?.replace(/^\.\//, '').toLowerCase();
        if (tool && /^[a-z0-9._-]+$/.test(tool) && !tools.has(tool)) tools.set(tool, name);
      }
    }
  }
  return tools;
}

// Spec 22 D1: the complete block's command, its withheld part as a wildcard, must be one the example ran.
function completeFindings(blocks, add) {
  const pre = [...blocks.get('complete').html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi)].find((m) => WITHHELD.test(m[1]));
  if (!pre) { add('LESSON_COMPLETE_NOT_WORKED', 'complete block has no <pre> command with <mark aria-label="withheld">'); return; }
  const line = unescapeHtml(pre[1].replace(WITHHELD, '\0').replace(/<[^>]*>/g, '')).split('\n').map((l) => l.trim()).find((l) => l.includes('\0'));
  const cmd = line.replace(/^\$ /, '');
  const re = new RegExp(`^${cmd.split('\0').map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.+')}$`);
  if (!exampleCommands(blocks).some((c) => re.test(c))) add('LESSON_COMPLETE_NOT_WORKED', `complete command "${cmd.replace('\0', '____')}" with the withheld part filled is no command the example block ran`);
}

// Spec 22 D4: advisory checks on each inline <svg> in a <figure>, one finding per code per figure.
// A label's size is the nearest font-size attribute on the <text> or an ancestor; none is unknown and warns.
// Issue #56: a float wraps only the content after it, so a pair puts its figure first; a paragraph-first pair is advisory.
function pairFindings(html, add) {
  const late = [...html.matchAll(/<div\b[^>]*\bclass\s*=\s*(["'])pair\1[^>]*>([\s\S]*?)<\/div>/gi)].filter((m) => { const p = m[2].search(/<p\b/i); const f = m[2].search(/<figure\b/i); return p !== -1 && f !== -1 && p < f; }).length;
  if (late) add('WARN_PAIR_FIGURE_LAST', `${late} pair(s) put the paragraph before the figure; put the figure first so the text wraps around it on a wide screen`);
}

function figureFindings(html, add) {
  [...html.matchAll(/<figure\b[\s\S]*?<\/figure>/gi)].flatMap((f) => [...f[0].matchAll(/<svg\b([^>]*)>([\s\S]*?)<\/svg>/gi)]).forEach((svg, i) => {
    const [, attrs, inner] = svg;
    const at = (a, name) => new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(a)?.[2];
    const n = `figure ${i + 1}`;
    if (at(attrs, 'width') !== undefined || at(attrs, 'height') !== undefined) add('WARN_FIGURE_FIXED_SIZE', `${n}: <svg> has a width or height attribute; size it from viewBox alone`);
    const vbw = Number(at(attrs, 'viewBox')?.trim().split(/[\s,]+/)[2]);
    if (vbw > FIGURE_VIEWBOX_MAX) add('WARN_FIGURE_VIEWBOX_WIDE', `${n}: viewBox width ${vbw} (max ${FIGURE_VIEWBOX_MAX})`);
    if (!/\srole\s*=\s*(["'])img\1/i.test(attrs) || !at(attrs, 'aria-label')?.trim()) add('WARN_FIGURE_NO_ALT', `${n}: <svg> needs role="img" and an aria-label`);
    const colors = new Set();
    const small = [];
    const long = [];
    const overflow = [];
    // ponytail: text width is estimated as characters x font size x 0.5 (an average sans-serif advance; 0.55 flagged a label that fits), no font metrics; a real measure needs a renderer.
    const rects = [...inner.matchAll(/<rect\b([^>]*)>/gi)].map((r) => ({ x: parseFloat(at(r[1], 'x')) || 0, y: parseFloat(at(r[1], 'y')) || 0, w: parseFloat(at(r[1], 'width')), h: parseFloat(at(r[1], 'height')) })).filter((r) => r.w > 0 && r.h > 0);
    const stack = [attrs];
    for (const t of inner.matchAll(/<(\/?)([a-z][\w:-]*)\b([^>]*?)(\/?)>/gi)) {
      const [, close, tag, a, self] = t;
      if (close) { stack.pop(); continue; }
      for (const c of a.matchAll(/\s(?:fill|stroke)\s*=\s*(["'])(.*?)\1/gi)) colors.add(c[2]);
      if (tag.toLowerCase() === 'text') {
        const size = [a, ...stack.slice().reverse()].map((x) => at(x, 'font-size')).find((x) => x !== undefined);
        if (size === undefined || !(parseFloat(size) >= FIGURE_LABEL_MIN)) small.push(size ?? 'unknown');
        const end = inner.indexOf('</text>', t.index);
        const label = unescapeHtml(textOf(inner.slice(t.index, end === -1 ? undefined : end)));
        if (label.length > FIGURE_LABEL_MAX) long.push(label.length);
        else {
          const tx = parseFloat(at(a, 'x')); const ty = parseFloat(at(a, 'y')); const fs = parseFloat(size);
          if (Number.isFinite(tx) && Number.isFinite(ty) && Number.isFinite(fs)) {
            const w = label.length * fs * 0.5;
            const anchor = [a, ...stack.slice().reverse()].map((x) => at(x, 'text-anchor')).find((x) => x !== undefined);
            const left = anchor === 'middle' ? tx - w / 2 : anchor === 'end' ? tx - w : tx;
            const box = rects.find((r) => tx >= r.x && tx <= r.x + r.w && ty >= r.y && ty <= r.y + r.h);
            const [lo, hi] = box ? [box.x + 4, box.x + box.w - 4] : [0, vbw];
            if (left < lo || left + w > hi) overflow.push(label);
          }
        }
      }
      if (!self) stack.push(a);
    }
    for (const c of [at(attrs, 'fill'), at(attrs, 'stroke')]) if (c !== undefined) colors.add(c);
    const bad = [...colors].filter((c) => !/^\s*(currentColor|none|var\(--muted\))\s*$/i.test(c));
    if (bad.length) add('WARN_FIGURE_COLOR', `${n}: fill or stroke ${bad.join(', ')}; use currentColor, none or var(--muted)`);
    if (small.length) add('WARN_FIGURE_LABEL_SMALL', `${n}: ${small.length} label(s) under ${FIGURE_LABEL_MIN} units or of unknown size (${[...new Set(small)].join(', ')})`);
    if (overflow.length) add('WARN_FIGURE_TEXT_OVERFLOW', `${n}: ${overflow.length} label(s) estimated wider than the shape holding them (${overflow.map((l) => `"${l}"`).join(', ')}); widen the box, shorten the label or break the line`);
    if (long.length) add('WARN_FIGURE_LABEL_LONG', `${n}: ${long.length} label(s) over ${FIGURE_LABEL_MAX} characters (longest ${Math.max(...long)}); a label names, the paragraph explains`);
  });
}

// Issue 4 (spec 46 D3 rule 2): the Checked task section's read-only verbs per tool (a two-word entry is the
// verb and the next word), its deny list of first words, and the flags whose value precedes the verb.
const TASK_READ_ONLY = {
  kubectl: ['get', 'describe', 'wait', 'logs', 'top', 'events', 'explain', 'diff', 'version', 'api-resources', 'api-versions', 'cluster-info',
    'auth can-i', 'config view', 'config current-context', 'config get-contexts', 'rollout status', 'rollout history', 'kustomize'],
  docker: ['ps', 'inspect', 'logs', 'images', 'version', 'info', 'port', 'top', 'diff', 'stats', 'network ls', 'network inspect', 'volume ls', 'volume inspect'],
  kind: ['get', 'version'],
};
const TASK_DENY = ['rm', 'mv', 'cp', 'tee', 'sed', 'mkdir', 'touch', 'chmod', 'chown'];
const TASK_VALUE_FLAGS = ['-n', '--namespace', '--context', '--kubeconfig', '--host', '-o', '--output'];

// The offending word of a checker line, or undefined: a disallowed tool verb names the tool, a denied first
// word names itself, a redirect to a file names `>`. Quoted strings read as `""`, so a `|`, `;` or `>` inside one
// splits or redirects nothing. Blind to $(...), [[ a > b ]], heredocs and called scripts.
const blankQuotes = (line) => line.replace(/"[^"]*"|'[^']*'/g, '""');
function checkMutates(line) {
  for (const seg of blankQuotes(line).split(/\|\|?|&&|;/)) {
    const words = seg.trim().split(/\s+/).filter((w) => w && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(w));
    while (['sudo', 'timeout', 'time', 'if', '!', 'then', 'do', 'else'].includes(words[0])) {
      if (words.shift() !== 'timeout') continue;
      while (words[0]?.startsWith('-')) if (['-s', '-k', '--signal', '--kill-after'].includes(words.shift())) words.shift();
      words.shift(); // the duration
    }
    const [word, ...rest] = words;
    if (Object.hasOwn(TASK_READ_ONLY, word)) {
      const i = rest.findIndex((w, j) => !w.startsWith('-') && !TASK_VALUE_FLAGS.includes(rest[j - 1]));
      if (i < 0 || !TASK_READ_ONLY[word].some((v) => v === rest.slice(i, i + v.split(' ').length).join(' '))) return word;
    }
    if (TASK_DENY.includes(word)) return word;
    if (/>>?(?!&|>|\s*\/dev\/null\b)/.test(seg)) return '>';
  }
}

// Issue 60: with the binding's `lab` block, each `.sh` under evidence/ and lessons/ is on the lab when a
// non-comment, non-echo line holds a `uses` string (raw line, since a library is sourced through a quoted path);
// else the first non-comment line holding a `bypass` string (quoted strings read as empty) is one advisory finding,
// unless evidence/NNNN/PLAN.md (NNNN from evidence/NNNN/ or lessons/files/NNNN-) has an `own environment: <reason>` line.
// Reads each line as written: a quoted `bypass` string is blanked, an unquoted $(...) and a heredoc body are
// read as lines, and a called script counts only when it is itself a .sh under the two trees.
function lintLab(ws, lab) {
  const findings = [];
  for (const d of ['evidence', 'lessons']) {
    if (!existsSync(join(ws, d))) continue;
    for (const rel of readdirSync(join(ws, d), { recursive: true }).filter((f) => f.endsWith('.sh') && statSync(join(ws, d, f), { throwIfNoEntry: false })?.isFile()).sort()) {
      const file = `${d}/${rel.split(/[\\/]/).join('/')}`;
      const lines = readFileSync(join(ws, file), 'utf8').split(/\r?\n/).map((l, i) => [i + 1, l]).filter(([, l]) => l.trim() && !l.trim().startsWith('#'));
      if (lines.some(([, l]) => !/^\s*echo\b/.test(l) && lab.uses.some((u) => l.includes(u)))) continue;
      const hit = lines.flatMap(([n, l]) => lab.bypass.filter((b) => blankQuotes(l).includes(b)).map((b) => [n, b]))[0];
      if (!hit) continue;
      const nnnn = file.match(/^(?:evidence\/|lessons\/files\/)(\d{4})[\/-]/)?.[1];
      const plan = nnnn && join(ws, 'evidence', nnnn, 'PLAN.md');
      if (plan && existsSync(plan) && /^own environment:[ \t]*\S/m.test(readFileSync(plan, 'utf8'))) continue;
      findings.push({ code: 'WARN_LAB_BYPASSED', file, message: `line ${hit[0]}: ${hit[1]}; the binding's lab is ${lab.docs[0]}`, warning: true });
    }
  }
  return findings;
}

export function lintLesson(filePath, ctx) {
  const cls = lessonClass(filePath);
  if (!cls) return [];
  const ws = ctx.workspaceDir;
  const file = relative(ws, filePath).replace(/\\/g, '/');
  const findings = [];
  const add = (code, message) => findings.push({ code, file, message, warning: code.startsWith('WARN_') });
  const raw = readFileSync(filePath, 'utf8');
  const { blocks, quiz, cites, links } = parseLesson(raw);

  const shape = cls === 'lesson' ? (/<body\b[^>]*\bdata-shape\s*=\s*(["'])([^"']*)\1/i.exec(raw)?.[2].trim().toLowerCase() ?? '') : '';
  const shaped = Object.hasOwn(SHAPES, shape);
  if (shape && !shaped) add('LESSON_SHAPE_UNKNOWN', `data-shape ${shape} is not one of ${Object.keys(SHAPES).join(', ')}`);
  const required = shaped ? [...FRAME, ...SHAPES[shape]] : shape ? FRAME : UNSHAPED[cls];
  for (const b of required) if (!blocks.has(b)) add('LESSON_SHAPE_BLOCK_MISSING', `missing block: ${b}${shape ? ` (shape ${shape})` : ''}`);
  const teaches = bodyAttrList(raw, 'data-teaches');
  if (shaped && (shape === 'tool') !== (teaches.length > 0)) add('LESSON_SHAPE_MISMATCH', shape === 'tool' ? 'shape tool needs data-teaches naming the tool it teaches' : `shape ${shape} carries data-teaches; only a tool lesson does`);
  if (blocks.has('complete')) completeFindings(blocks, add);
  if (blocks.has('predict')) {
    const pq = parseQuiz(blocks.get('predict').html);
    if (!/<pre\b/i.test(blocks.get('predict').html) || pq.error || pq.items.length !== 1) add('LESSON_PREDICT_INVALID', `predict block needs one <pre> output and a data-quiz with one item${pq.error ? ` (${pq.error})` : ''}`);
  }
  const followup = blocks.get('followup');
  if (followup && !textOf(followup.html).includes(FOLLOWUP)) add('LESSON_FOLLOWUP_MISSING', `followup block lacks: ${FOLLOWUP}`);

  const fact = blocks.get('fact');
  if (fact) {
    [...fact.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].forEach((m, i) => {
      if (!/<a\b[^>]*\bdata-cite\s*=/i.test(m[1])) add('LESSON_CLAIM_UNCITED', `fact paragraph ${i} has no data-cite: ${textOf(m[1]).slice(0, 60)}`);
    });
  }
  const note = blocks.get('note');
  if (cls === 'reference' && note && !/\bdata-cite\s*=/i.test(note.attrs)) add('LESSON_CLAIM_UNCITED', 'note block has no data-cite');
  // Spec 37: a time-relative word asserts currency the vault already carries as last_verified. Advisory;
  // a quoted source sentence may hold one. <pre> and <code> are excluded; one warning per paragraph.
  for (const [name, b] of blocks) {
    if (name === 'sources') continue;
    [...b.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].forEach((m, i) => {
      const text = textOf(m[1].replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ').replace(/<code\b[\s\S]*?<\/code>/gi, ' '));
      const hit = TIME_WORDS.find((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${w}(?![\\p{L}\\p{N}])`, 'iu').test(text));
      if (hit) add('WARN_LESSON_TIME_WORD', `${name} paragraph ${i} says "${hit}": ${text.slice(0, 60)}; take a version or date from the cited entry instead`);
    });
  }

  // Stale and superseded entries resolve; freshness is the claims gate's job.
  for (const r of checkCitations(cites.map((value) => ({ type: 'id', value })), ctx.entries, ctx.schema, ctx.now)) {
    if (r.status === 'uncovered') add('LESSON_CITE_UNRESOLVED', `data-cite ${r.value} has no vault entry`);
  }
  // Spec 22 D6.3: an authored [n] is the cited id's position in the sources list, as teach serve numbers it.
  const order = extractCites(blocks.get('sources')?.html ?? '');
  for (const [name, b] of blocks) {
    if (name === 'sources') continue;
    for (const m of b.html.matchAll(/<a\b[^>]*\bdata-cite\s*=\s*(["'])([^"']+)\1[^>]*>\s*\[(\d+)\]\s*<\/a>/gi)) {
      const pos = order.indexOf(m[2]) + 1;
      if (Number(m[3]) !== pos) add('LESSON_CITE_NUMBER', `data-cite ${m[2]} is numbered [${m[3]}] but is ${pos ? `source ${pos}` : 'not'} in the sources list`);
    }
  }
  figureFindings(raw, add);
  pairFindings(raw, add);
  for (const href of new Set(links)) {
    if (!linkResolves(ws, dirname(filePath), href)) add('LESSON_LINK_DANGLING', `href ${href} does not resolve`);
  }

  if (cls !== 'reference' && blocks.has('quiz')) quizFindings(quiz, cls, ws, add);

  if (cls === 'lesson') {
    const html = raw;
    const id = basename(filePath).slice(0, -5);
    const model = blocks.get('model');
    if (model) {
      if (!/\bdata-cite\s*=/i.test(model.html)) add('LESSON_CLAIM_UNCITED', 'model block has no data-cite');
      if (!/<figure\b/i.test(model.html) && !/\bdata-no-figure\b/i.test(model.attrs)) add('LESSON_MODEL_NO_FIGURE', 'model block has no <figure> (add a diagram, or data-no-figure with a reason in PLAN.md)');
      const types = new Set(extractCites(model.html).map((c) => ctx.entries.find((e) => e.id === c)?.type).filter(Boolean));
      if (types.size && [...types].every((t) => t === 'experiment' || t === 'snippet')) add('WARN_MODEL_LAB_ONLY', 'model block cites only experiment or snippet entries; a model is a "the docs say" claim, cite a source or note');
    }
    const introduces = bodyAttrList(html, 'data-introduces');
    if (introduces.length > MAX_INTRODUCES) add('LESSON_INTRODUCES_TOO_MANY', `data-introduces names ${introduces.length} terms (max ${MAX_INTRODUCES})`);
    const dfns = [...html.matchAll(/<dfn\b[^>]*>([\s\S]*?)<\/dfn>/gi)].map((m) => textOf(m[1]).toLowerCase());
    for (const t of introduces) if (!dfns.includes(t)) add('LESSON_DFN_MISSING', `data-introduces names ${t} but no <dfn>${t}</dfn> defines it`);
    const floor = missionFloor(ws);
    if (floor.newTerms !== null || floor.knownTerms !== null) {
      const allowed = new Set([...(floor.knownTerms ?? []), ...introducedTerms(ws, id)]);
      const prose = proseOf(blocks, quiz);
      for (const t of trackedTerms(ws)) {
        if (!allowed.has(t) && termRe(t).test(prose)) add('LESSON_TERM_NOT_INTRODUCED', `uses the term "${t}" before this or an earlier lesson introduces it (data-introduces) and it is not in the Floor's known terms`);
      }
    }
    const path = readPath(ws);
    const line = path?.find((l) => l.lesson === id);
    if (line) {
      const same = (a, b) => a.length === b.length && a.every((x) => b.includes(x));
      if (!same(line.terms, introduces) || (line.tool ?? null) !== (teaches[0] ?? null)) add('LESSON_PATH_MISMATCH', `PATH.md line ${line.n} says terms: ${line.terms.join(', ') || 'none'}; tool: ${line.tool ?? 'none'}, the lesson declares data-introduces ${introduces.join(', ') || 'none'}; data-teaches ${teaches.join(', ') || 'none'}`);
    }
    const used = commandTools(blocks);
    if (used.size) {
      const known = missionKnownTools(ws);
      if (known === null) add('WARN_MISSION_KNOWN_TOOLS_MISSING', 'MISSION.md has no "Known tools" section, so LESSON_TOOL_NOT_INTRODUCED cannot run');
      else {
        const taught = taughtTools(ws, basename(filePath).slice(0, -5));
        for (const [tool, block] of used) {
          if (!known.has(tool) && !taught.has(tool)) add('LESSON_TOOL_NOT_INTRODUCED', `${block} runs ${tool}, which is neither in MISSION.md "Known tools" nor taught by this or an earlier lesson (data-teaches)`);
        }
      }
    }
  }

  // Spec 22 D2: a lesson that declares data-shape postdates the Elements part, so its plan must carry one.
  if (cls === 'lesson' && (fact || shape)) {
    const ev = join(ws, 'evidence', basename(filePath).slice(0, 4));
    const plan = join(ev, 'PLAN.md');
    if (!existsSync(ev)) add('WARN_EVIDENCE_FOLDER_MISSING', `no evidence/${basename(ev)}/ folder (lesson predates plan-before-probe)`);
    else if (!existsSync(plan)) add('EVIDENCE_PLAN_MISSING', `evidence/${basename(ev)}/ has no PLAN.md`);
    else if (shape && !/^#{1,6}\s+elements\b/im.test(readFileSync(plan, 'utf8'))) add('LESSON_PLAN_NO_ELEMENTS', `evidence/${basename(ev)}/PLAN.md has no Elements part`);
  }
  // Issue 3 (spec 46 D4): a checked task is three scripts, a step line ending evidence/NNNN/check.sh and an
  // experiment in sources; a script or a step line naming check.sh makes the lesson one, and each missing part is a finding.
  if (shape === 'project') {
    const nnnn = basename(filePath).slice(0, 4);
    const scripts = ['setup.sh', 'check.sh', 'solution.sh'].filter((s) => !existsSync(join(ws, 'evidence', nnnn, s)));
    const lines = preLines(blocks.get('step')?.html ?? '').filter((l) => l && !l.startsWith('#'));
    if (scripts.length < 3 || lines.some((l) => l.includes('check.sh'))) {
      for (const s of scripts) add('LESSON_TASK_INCOMPLETE', `evidence/${nnnn}/${s} is missing`);
      if (!lines.some((l) => l.split(/\s+/).at(-1) === `evidence/${nnnn}/check.sh`)) add('LESSON_TASK_INCOMPLETE', `step has no line ending evidence/${nnnn}/check.sh`);
      if (!order.some((c) => ctx.entries.find((e) => e.id === c)?.type === 'experiment')) add('LESSON_TASK_INCOMPLETE', 'sources cites no experiment');
    }
    const check = join(ws, 'evidence', nnnn, 'check.sh');
    if (existsSync(check)) readFileSync(check, 'utf8').split(/\r?\n/).forEach((l, i) => {
      const word = l.trim() && !l.trim().startsWith('#') && checkMutates(l);
      if (word) add('WARN_TASK_CHECK_MUTATES', `check.sh line ${i + 1}: ${word}`);
    });
  }
  return findings;
}

// The vault lint's store codes, over learning-records/ and attempts/.
export function lintStore(workspaceDir, ctx) {
  const ws = workspaceDir;
  const { teachSchema } = ctx;
  const findings = [];
  // A parked lesson (parked/<id>.html) still resolves: its attempts and records keep their history.
  const exists = { lessons: (id) => LESSON_ID_RE.test(id) && (existsSync(join(ws, 'lessons', `${id}.html`)) || existsSync(join(ws, 'parked', `${id}.html`))),
    records: (id) => RECORD_ID_RE.test(id) && existsSync(join(ws, 'learning-records', `${id}.md`)) };
  const target = { superseded_by: exists.records, records: exists.records, lesson: exists.lessons };
  for (const folder of ['learning-records', 'attempts']) {
    for (const name of listDir(join(ws, folder), '.md')) {
      const file = `${folder}/${name}`;
      const add = (code, message) => findings.push({ code, file, message, warning: code.startsWith('WARN_') });
      const raw = readFileSync(join(ws, folder, name), 'utf8');
      if (folder === 'learning-records' && !/^\uFEFF?---/.test(raw)) {
        add('WARN_RECORD_FRONTMATTER_MISSING', 'no frontmatter; run teach lint --fix');
        continue;
      }
      let data;
      try { ({ data } = parseFrontmatter(raw)); } catch (e) { add('PARSE', e.message); continue; }
      for (const msg of validateEntry(data, teachSchema)) {
        const enumField = /^unknown (\w+):/.exec(msg)?.[1];
        add(enumField ? ENUM_CODES[enumField] : msg.startsWith('stored derived') ? 'STORED_DERIVED' : 'MISSING_REQUIRED', msg);
      }
      const want = teachSchema.taxonomy.type_folder[data.type];
      if (data.type && want !== folder) add('TYPE_FOLDER', `type ${data.type} in folder ${folder}`);
      for (const f of Object.keys(target)) {
        const val = data[f];
        if (val === undefined || val === null || val === '') continue;
        for (const ref of Array.isArray(val) ? val : [val]) {
          if (!target[f](String(ref))) add('DANGLING_REF', `${f} -> missing id ${ref}`);
        }
      }
      if (data.type === 'learning-record') {
        if (data.status === 'superseded' && !data.superseded_by) add('SUPERSEDE', 'superseded without superseded_by');
        if (data.status === 'active' && data.superseded_by) add('SUPERSEDE', 'superseded_by on an active record');
      }
    }
  }
  return findings;
}

// Spec 17 D1, over readPath's output and nothing else. `fringe`: every untaken line whose after: values
// are all `floor` or a taken line's number, file order (the first is the default). `inner`: every taken
// line whose lesson is not a review and that no other such line names in after:, most recently built first.
// Spec 22 D3: a `Project:` line counts as a review here, so a built project keeps the lines it names inner.
const isReview = (l) => /^\d{4}-review-/.test(l.lesson ?? '');
export const isProject = (l) => /^project:/i.test(l.title);
export function pathFringe(lines) {
  const taken = new Set(lines.filter((l) => l.lesson).map((l) => String(l.n)));
  const fringe = lines.filter((l) => !l.lesson && l.after.every((a) => a === 'floor' || taken.has(a)));
  const items = lines.filter((l) => l.lesson && !isReview(l) && !isProject(l));
  const needed = new Set(items.flatMap((l) => l.after));
  const inner = items.filter((l) => !needed.has(String(l.n))).sort((a, b) => (a.lesson < b.lesson ? 1 : -1));
  return { fringe, inner };
}

// Spec 17 D2. PATH_AFTER_FORWARD per after: value naming a missing, later or own line (a prerequisite has a
// smaller number); PATH_AFTER_CYCLE once per loop, written from its smallest line. Both are violations.
// Spec 22 D3: PATH_PROJECT_AFTER when a `Project:` line's after: names fewer than two lines.
export function lintPath(lines) {
  const findings = [];
  const add = (code, message) => findings.push({ code, file: 'PATH.md', message, warning: false });
  const byN = new Map(lines.map((l) => [String(l.n), l]));
  for (const l of lines) {
    const named = l.after.filter((a) => a !== 'floor').length;
    if (isProject(l) && named < 2) add('PATH_PROJECT_AFTER', `line ${l.n} is a Project: line whose after: names ${named} line(s); a project integrates at least two`);
    for (const a of l.after) {
      if (a === 'floor') continue;
      if (!byN.has(a)) add('PATH_AFTER_FORWARD', `line ${l.n} after: ${a} names no line`);
      else if (Number(a) === l.n) add('PATH_AFTER_FORWARD', `line ${l.n} after: ${a} names itself`);
      else if (Number(a) > l.n) add('PATH_AFTER_FORWARD', `line ${l.n} after: ${a} names a later line`);
    }
  }
  const state = new Map(); // 'gray' on the stack, 'black' done; a gray hit is one simple cycle
  const walk = (n, stack) => {
    if (state.get(n) === 'black') return;
    if (state.get(n) === 'gray') {
      const loop = stack.slice(stack.indexOf(n));
      const k = loop.indexOf(Math.min(...loop));
      const rot = [...loop.slice(k), ...loop.slice(0, k)];
      return add('PATH_AFTER_CYCLE', `lines ${[...rot, rot[0]].join(' -> ')} form an after: cycle`);
    }
    state.set(n, 'gray');
    for (const a of byN.get(String(n)).after) if (byN.has(a)) walk(Number(a), [...stack, n]);
    state.set(n, 'black');
  };
  for (const l of lines) walk(l.n, []);
  return findings;
}

// Spec 19 D2: the introducer terms a lesson's prose uses, read as the term rule reads a lesson (proseOf, termRe).
export function lessonUses(html, terms) {
  const { blocks, quiz } = parseLesson(html);
  const prose = proseOf(blocks, quiz);
  return [...new Set(terms)].filter((t) => termRe(t).test(prose));
}

// Spec 19 D3. `uses` maps a line number to [{ term, via }] (via: uses | runs | names). One proposal per
// (line, introducer line, term) when the introducer is an earlier line the line's after: does not reach.
// Spec 22 D3: no proposals for a `Project:` line; it uses every term it integrates.
export function pathEdges({ lines, uses }) {
  const byN = new Map(lines.map((l) => [String(l.n), l]));
  const introducer = new Map();
  for (const l of lines) for (const t of [...l.terms, ...(l.tool ? [l.tool] : [])]) if (!introducer.has(t) || introducer.get(t).n > l.n) introducer.set(t, l);
  const reach = (l) => {
    const seen = new Set();
    const stack = [...l.after];
    while (stack.length) { const a = stack.pop(); if (seen.has(a) || !byN.has(a)) continue; seen.add(a); stack.push(...byN.get(a).after); }
    return seen;
  };
  const out = [];
  for (const l of lines) {
    if (isProject(l)) continue;
    const r = reach(l);
    const proposals = [];
    for (const { term, via } of uses.get(l.n) ?? []) {
      const y = introducer.get(term);
      if (!y || y.n >= l.n || r.has(String(y.n)) || proposals.some((p) => p.term === term)) continue;
      proposals.push({ after: y.n, term, via, by: y });
    }
    if (proposals.length) out.push({ line: l, proposals: proposals.sort((a, b) => a.after - b.after || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0)) });
  }
  return out;
}

// Spec 20 D5. One advisory per `New to me` term that no line's terms: names; the term becomes a
// violation only when a lesson uses it (LESSON_TERM_NOT_INTRODUCED). Known terms need no lesson.
export function lintPathTerms(lines, newTerms) {
  const planned = new Set(lines.flatMap((l) => l.terms));
  return [...newTerms].filter((t) => !planned.has(t)).map((t) => ({
    code: 'WARN_PATH_TERM_UNPLANNED', file: 'PATH.md', warning: true,
    message: `New to me term "${t}" is on no line's terms: (PATH-FORMAT: every New to me term appears on a line); teach path candidates lists the vault's entries for it`,
  }));
}

// Spec 20 D2-D3: `teach path candidates`, pure over readPath's lines, missionFloor's sets, the cited ids,
// the manifest, the topic list and the taxonomy's topic_aliases; `readBody(id)` returns an entry's body
// (pool entries only are read). Candidates come from the vault's own filters (matchRows) and traverse.
const uniq = (xs) => [...new Set(xs)];
export const topicSlug = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '');
export function pathCandidates({ lines, floor, cites, manifest, topics, aliases = {}, readBody = () => '' }) {
  const expand = (t) => aliases[t] || t;
  const rows = manifest.entries.filter((e) => e.status !== 'superseded');
  const vocab = new Map();
  for (const e of rows) for (const t of e.topics.map(expand)) vocab.set(t, (vocab.get(t) ?? 0) + 1);
  const missionTerms = uniq([...(floor.knownTerms ?? []), ...(floor.newTerms ?? [])]);
  const terms = uniq([...missionTerms, ...lines.flatMap((l) => [...l.terms, ...(l.tool ? [l.tool] : [])])]);
  // Pool topics: the given ones, plus a term's slug (or its plural) when the vocabulary has it.
  const poolTopics = uniq([...topics.map(expand), ...terms.map(topicSlug).flatMap((s) => [s, `${s}s`]).filter((s) => vocab.has(s))]);
  const pool = new Map(); // id -> { row, topics }
  for (const t of poolTopics) for (const e of matchRows(rows, { topic: t }, aliases)) (pool.get(e.id) ?? pool.set(e.id, { row: e, topics: [] }).get(e.id)).topics.push(t);
  const poolRows = [...pool.values()].map((p) => p.row);
  // Term hits: term -> Map(id -> queries), each query in the CLI's own words so the author can rerun it.
  const query = (id, flag, needle) => `search --topic ${pool.get(id).topics[0]} ${flag} "${needle}"`;
  const hits = new Map(); // term -> Map(id -> [{ q, body }])
  for (const t of terms) {
    const m = new Map();
    const add = (id, q, body) => (m.get(id) ?? m.set(id, []).get(id)).push({ q, body });
    for (const e of matchRows(poolRows, { text: t }, aliases)) add(e.id, query(e.id, '--text', t), false);
    const s = topicSlug(t);
    if (s !== t) for (const e of matchRows(poolRows, { text: s }, aliases)) add(e.id, query(e.id, '--text', s), false);
    for (const e of poolRows) if (String(readBody(e.id)).toLowerCase().includes(t)) add(e.id, query(e.id, '--body', t), true);
    hits.set(t, m);
  }
  const cited = new Set(cites);
  const cands = new Map(); // id -> { row, reasons, queries }
  const cand = (row) => cands.get(row.id) ?? cands.set(row.id, { row, reasons: [], queries: [] }).get(row.id);
  for (const { row, topics: ts } of pool.values()) {
    if (cited.has(row.id)) continue;
    const c = cand(row);
    c.reasons.push('uncited');
    c.queries.push(...ts.map((t) => `search --topic ${t}`));
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const c of cites) {
    for (const n of traverse(manifest, c, { depth: 2, direction: 'both' }).nodes) {
      const r = byId.get(n.id);
      if (!r || n.distance === 0 || cited.has(n.id) || (r.type !== 'note' && r.type !== 'synthesis')) continue;
      const k = cand(r);
      k.reasons.push('linked');
      k.queries.push(`related ${c} --depth 2`);
    }
  }
  // Grouping: a candidate follows the line one of whose terms it is a --text hit for (title, topics and
  // summary; body hits are evidence, not grouping), the line's terms: before a mission term in its title
  // before its tool: (the tool is often the product's name), the highest-numbered line among equals.
  const lineTerms = (l) => [[0, l.terms], [1, missionTerms.filter((t) => topicSlug(l.title).includes(topicSlug(t)))], [2, l.tool ? [l.tool] : []]]
    .flatMap(([rank, ts]) => ts.map((t) => [rank, t]));
  const groups = new Map(lines.map((l) => [l.n, []]));
  const noLine = [];
  for (const c of [...cands.values()].sort((a, b) => a.row.id.localeCompare(b.row.id))) {
    let best = null;
    for (const l of lines) {
      for (const [rank, t] of lineTerms(l)) {
        const qs = (hits.get(t)?.get(c.row.id) ?? []).filter((h) => !h.body).map((h) => h.q);
        if (qs.length && (!best || rank < best.rank || (rank === best.rank && l.n > best.line.n))) best = { line: l, rank, qs };
      }
    }
    const out = { id: c.row.id, type: c.row.type, title: c.row.title ?? c.row.id, reasons: uniq(c.reasons), queries: uniq([...c.queries, ...(best?.qs ?? [])]) };
    if (best) groups.get(best.line.n).push(out); else noLine.push(out);
  }
  // Uncovered mission terms: every New to me term, and a Known term only when the pool holds an entry for it
  // (the Floor needs no lesson; an entry on a known term that no line teaches is still worth a look).
  const covered = (t) => lines.some((l) => l.terms.includes(t) || l.tool === t || topicSlug(l.title).includes(topicSlug(t)));
  const known = new Set(floor.knownTerms ?? []);
  const uncovered = missionTerms.filter((t) => !covered(t) && (!known.has(t) || hits.get(t)?.size)).map((t) => ({
    term: t, hits: [...(hits.get(t) ?? [])].sort(([a], [b]) => a.localeCompare(b)).map(([id, hs]) => { const r = pool.get(id).row; return { id, type: r.type, title: r.title ?? id, queries: uniq(hs.map((h) => h.q)) }; }),
  }));
  return {
    poolTopics: poolTopics.map((t) => [t, vocab.get(t) ?? 0]), pool: pool.size, cited: [...cited],
    groups: lines.filter((l) => groups.get(l.n).length).map((l) => ({ line: l, candidates: groups.get(l.n) })), noLine, uncovered,
  };
}

// Spec 39: prose numbers per block, for the reader round and the GATE-LOG record; no threshold.
// The text is the one spec 37 scans; a sentence ends at . ! or ? before a space or the paragraph's end.
const PROSE_BLOCKS = ['mission', 'model', 'fact', 'example', 'note'];
export function proseMetrics(workspaceDir) {
  const rows = [];
  for (const d of ['lessons', 'reference']) {
    for (const f of listDir(join(workspaceDir, d), '.html')) {
      const { blocks } = parseLesson(readFileSync(join(workspaceDir, d, f), 'utf8'));
      for (const block of PROSE_BLOCKS) {
        if (!blocks.has(block)) continue;
        const paras = [...blocks.get(block).html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)]
          .map((m) => textOf(m[1].replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ').replace(/<code\b[\s\S]*?<\/code>/gi, ' ')));
        const sentences = paras.flatMap((t) => [...t.matchAll(/(\S[^.!?]*?[.!?])(?=\s|$)/g)].map((m) => m[1].trim()));
        const counts = sentences.map((x) => x.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length);
        const words = counts.reduce((a, b) => a + b, 0);
        rows.push({ file: `${d}/${f}`, block, paragraphs: paras.length, sentences: sentences.length, avg: sentences.length ? Math.round((words / sentences.length) * 10) / 10 : 0, longest: counts.length ? Math.max(...counts) : 0 });
      }
    }
  }
  return rows;
}

export function lintWorkspace(workspaceDir, ctx) {
  const c = { ...ctx, workspaceDir };
  const findings = ['lessons', 'reference'].flatMap((d) =>
    listDir(join(workspaceDir, d), '.html').flatMap((f) => lintLesson(join(workspaceDir, d, f), c)));
  findings.push(...lintStore(workspaceDir, c));
  if (c.lab) findings.push(...lintLab(workspaceDir, c.lab));
  const path = readPath(workspaceDir);
  if (path !== null) {
    findings.push(...lintPath(path));
    const newTerms = missionFloor(workspaceDir).newTerms;
    if (newTerms !== null) findings.push(...lintPathTerms(path, newTerms));
  } else if (listDir(join(workspaceDir, 'lessons'), '.html').length) {
    findings.push({ code: 'WARN_PATH_MISSING', file: 'PATH.md', message: 'no PATH.md; teach next cannot name the next lesson (PATH-FORMAT.md)', warning: true });
  }
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
