// research-teach lesson parser and the `teach lint` checks for lessons, reference docs and the
// workspace store (spec 12 "Lesson lint"). Pure over files; the verb lives in bin/commands/teach.mjs.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { parseFrontmatter } from './frontmatter.mjs';
import { checkCitations } from '../commands/check.mjs';
import {
  extractQuizJson, extractCites, validateEntry, ENUM_CODES, LESSON_ID_RE, RECORD_ID_RE,
} from './teach.mjs';
import { answerLengthSpread } from '../../skills/research-teach/assets/quiz.js';

export const FACT_WORDS = 300;
export const QUIZ_MIN_ITEMS = 3;
export const QUIZ_SPREAD_MAX = 1.6;
const FOLLOWUP = 'You can ask follow-up questions in the terminal.';
const REQUIRED = {
  lesson: ['mission', 'fact', 'example', 'quiz', 'step', 'sources', 'followup'],
  review: ['mission', 'quiz', 'followup', 'sources'],
  reference: ['note', 'sources'],
};

const textOf = (s) => s.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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
function parseBlocks(html) {
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
  return {
    blocks: parseBlocks(html),
    quiz: parseQuiz(html),
    cites: extractCites(html),
    links: [...html.matchAll(/\bhref\s*=\s*(["'])(.*?)\1/gi)].map((m) => m[2]),
  };
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

export function lintLesson(filePath, ctx) {
  const cls = lessonClass(filePath);
  if (!cls) return [];
  const ws = ctx.workspaceDir;
  const file = relative(ws, filePath).replace(/\\/g, '/');
  const findings = [];
  const add = (code, message) => findings.push({ code, file, message, warning: code.startsWith('WARN_') });
  const { blocks, quiz, cites, links } = parseLesson(readFileSync(filePath, 'utf8'));

  for (const b of REQUIRED[cls]) if (!blocks.has(b)) add('LESSON_BLOCK_MISSING', `missing block: ${b}`);
  const followup = blocks.get('followup');
  if (followup && !textOf(followup.html).includes(FOLLOWUP)) add('LESSON_FOLLOWUP_MISSING', `followup block lacks: ${FOLLOWUP}`);

  const fact = blocks.get('fact');
  if (fact) {
    const words = textOf(fact.html).split(' ').filter(Boolean).length;
    if (words > FACT_WORDS) add('LESSON_FACT_TOO_LONG', `fact block is ${words} words (max ${FACT_WORDS})`);
    [...fact.html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)].forEach((m, i) => {
      if (!/<a\b[^>]*\bdata-cite\s*=/i.test(m[1])) add('LESSON_CLAIM_UNCITED', `fact paragraph ${i} has no data-cite: ${textOf(m[1]).slice(0, 60)}`);
    });
  }
  const note = blocks.get('note');
  if (cls === 'reference' && note && !/\bdata-cite\s*=/i.test(note.attrs)) add('LESSON_CLAIM_UNCITED', 'note block has no data-cite');

  // Stale and superseded entries resolve; freshness is the claims gate's job.
  for (const r of checkCitations(cites.map((value) => ({ type: 'id', value })), ctx.entries, ctx.schema, ctx.now)) {
    if (r.status === 'uncovered') add('LESSON_CITE_UNRESOLVED', `data-cite ${r.value} has no vault entry`);
  }
  for (const href of new Set(links)) {
    if (!linkResolves(ws, dirname(filePath), href)) add('LESSON_LINK_DANGLING', `href ${href} does not resolve`);
  }

  if (cls !== 'reference' && blocks.has('quiz')) quizFindings(quiz, cls, ws, add);

  if (cls === 'lesson' && fact) {
    const ev = join(ws, 'evidence', basename(filePath).slice(0, 4));
    if (!existsSync(ev)) add('WARN_EVIDENCE_FOLDER_MISSING', `no evidence/${basename(ev)}/ folder (lesson predates plan-before-probe)`);
    else if (!existsSync(join(ev, 'PLAN.md'))) add('EVIDENCE_PLAN_MISSING', `evidence/${basename(ev)}/ has no PLAN.md`);
  }
  return findings;
}

// The vault lint's store codes, over learning-records/ and attempts/.
export function lintStore(workspaceDir, ctx) {
  const ws = workspaceDir;
  const { teachSchema } = ctx;
  const findings = [];
  const exists = { lessons: (id) => LESSON_ID_RE.test(id) && existsSync(join(ws, 'lessons', `${id}.html`)),
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

export function lintWorkspace(workspaceDir, ctx) {
  const c = { ...ctx, workspaceDir };
  const findings = ['lessons', 'reference'].flatMap((d) =>
    listDir(join(workspaceDir, d), '.html').flatMap((f) => lintLesson(join(workspaceDir, d, f), c)));
  findings.push(...lintStore(workspaceDir, c));
  return findings.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}
