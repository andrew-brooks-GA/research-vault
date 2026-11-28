// Static workspace files and the navigation, citations and lab steps rendered on their pages.
import { lstatSync, readFileSync, statSync } from 'node:fs';
import { extname, join, relative, resolve, sep } from 'node:path';
import { isInsideVault, isInsideWorkspaceFolder } from './containment.ts';
import { escapeHtml } from './escape.ts';
import { extractCites } from './lesson-format.mjs';
import { lessonLab, readLabs } from './labs.mjs';
import { neighbours, pathPosition } from '../../skills/research-teach/assets/quiz.js';

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

export const STATIC_DIRS = ['lessons', 'reference', 'assets', 'brand'];
export const CONTENT_TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
};

// Citations as the learner sees them: every `<a data-cite="ID">` outside the sources block becomes a
// numbered footnote `[n]` (its position in the sources list, as an unserved page's authored [n] is; an id
// the list lacks numbers after it) carrying the entry's title, and the sources block's
// anchors get `id="src-ID"`, their title as text, and their number. The file on disk is untouched, so
// the claims-gate hash is unaffected. `titles` maps vault id to title; an unknown id keeps the id as its title.
// `sourceHref(id)` is the href given a sources-block anchor that has none (`teach export` points it at sources.html).
export function footnoteCitations(html, titles = {}, sourceHref = (id) => `#src-${id}`) {
  const srcRe = /(<[a-z][a-z0-9]*\b[^>]*\bdata-block\s*=\s*(["'])sources\2[^>]*>)([\s\S]*?)(<\/section>|<\/div>)/i;
  const m = srcRe.exec(html);
  const order = m ? extractCites(m[3]) : [];
  const num = (id) => { let i = order.indexOf(id); if (i === -1) { order.push(id); i = order.length - 1; } return i + 1; };
  const before = m ? html.slice(0, m.index) : html;
  const sources = m ? m[3] : '';
  const after = m ? html.slice(m.index + m[0].length) : '';
  const anchor = /<a\b([^>]*)\bdata-cite\s*=\s*(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  const title = (id) => (Object.hasOwn(titles, id) ? titles[id] ?? id : id); // an id from the page: `constructor` is not a title (S-13)
  const body = before.replace(anchor, (_, pre, q, id, post) => {
    const n = num(id);
    return `<a${pre}data-cite="${id}"${post} class="cite" href="#src-${escapeHtml(String(id))}" title="${escapeHtml(String(title(id)))}">[${n}]</a>`;
  });
  if (!m) return body;
  const srcBody = sources.replace(anchor, (_, pre, q, id, post) => {
    const n = num(id);
    const hrefOnly = /\bhref\s*=/.test(pre + post) ? '' : ` href="${escapeHtml(String(sourceHref(id)))}"`;
    return `<a${pre}data-cite="${id}"${post}${hrefOnly} id="src-${escapeHtml(String(id))}">[${n}] ${escapeHtml(String(title(id)))}</a>`;
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
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').some((seg) => seg.startsWith('.'))) return { status: 404 };
  const target = join(workspaceDir, decoded);
  const glossary = target === join(workspaceDir, 'GLOSSARY.md');
  // Check the URL's own folder before following its links.
  const allowed = glossary || STATIC_DIRS.some((d) => {
    const folder = join(workspaceDir, d);
    return relative(folder, target) !== '' && isInsideVault(folder, target, undefined, null) && isInsideWorkspaceFolder(workspaceDir, folder, target);
  });
  if (!allowed) return { status: 404 };
  try {
    if (glossary && (!lstatSync(target).isFile() || !isInsideVault(workspaceDir, target))) return { status: 404 };
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

// The file `teach serve` returns for the URL of an <img> src on a page in fromDir, and under lessons/, reference/ or assets/
// (serveFile decodes, refuses a dot segment and a non-file): its workspace-relative path, ok, and the bytes (body null when
// there is no such file; with bytes false the file is only stat-ed and body is undefined).
export function imageTarget(ws, fromDir, src, { bytes = true, dirs = ['lessons', 'reference', 'assets'] } = {}) {
  const path = src.split(/[?#]/)[0];
  if (path.includes('\\')) return { path, ok: false, body: null };
  const raw = relative(ws, src.startsWith('/') ? join(ws, path) : resolve(fromDir, path)).split(sep).join('/');
  let decoded;
  try { decoded = decodeURIComponent(raw); } catch { return { path: '', ok: false, body: null }; }
  const served = !decoded.startsWith('..') && dirs.includes(decoded.split('/')[0]) ? serveFile(ws, `/${raw}`, { bytes }) : { status: 404 };
  return served.status === 200 ? { path: decoded, ok: true, body: served.body } : { path: decoded, ok: false, body: null };
}
