// Spec 50: a workspace's brand package, brand/brand.json and the files it names, put on every served and exported page.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { escapeHtml } from './teach.mjs';

// D2: the tokens a brand may set are the custom properties of lesson.css's first :root block.
const CSS = readFileSync(new URL('../../skills/research-teach/assets/lesson.css', import.meta.url), 'utf8');
const ROOT_BLOCK = CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {')));
export const BRAND_TOKENS = [...ROOT_BLOCK.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]);

const KEYS = ['name', 'logo', 'favicon', 'color', 'font', 'footer', 'audience', 'tokens', 'voice'];
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const REF_RE = /^\{([^{}]+)\}$/;
const NAME_RE = /^[A-Za-z0-9 -]*[A-Za-z0-9][A-Za-z0-9 -]*$/;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isPath = (p) => typeof p === 'string' && p.split('/').every((s) => /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(s));
const isHex = (c) => typeof c === 'string' && HEX_RE.test(c);
const isFamily = (f) => typeof f === 'string' && f.split(',').every((n) => NAME_RE.test(n));
export const brandUrl = (p) => '/brand/' + p.split('/').map(encodeURIComponent).join('/');

// D6: `{a.b.c}` is the `$value` at that dotted path of the tokens file; a `$value` that is itself `{...}` is an alias,
// followed at most eight times. Returns { value } or { problem }.
function lookup(tokens, ref) {
  let v = ref;
  for (let hops = 0; typeof v === 'string' && REF_RE.test(v); hops++) {
    if (hops > 8) return { problem: `${ref}: more than eight aliases` };
    if (!tokens) return { problem: `${ref}: no tokens file` };
    let node = tokens;
    for (const k of REF_RE.exec(v)[1].split('.')) node = isObj(node) && Object.hasOwn(node, k) ? node[k] : undefined;
    if (!isObj(node) || !Object.hasOwn(node, '$value')) return { problem: `${v} is not a token of the tokens file` };
    v = node.$value;
  }
  return { value: v };
}

// The brand of workspace `ws`: { brand: null, problems: [] } with no brand/ folder; else the brand with every reference
// resolved, or brand null and one { code, message } per problem of brand/brand.json (D1, D5, D6).
export function readBrand(ws) {
  if (!existsSync(join(ws, 'brand'))) return { brand: null, problems: [] };
  const problems = [];
  const bad = (message, code = 'BRAND_INVALID') => { problems.push({ code, message }); return false; };
  let b;
  try { b = JSON.parse(readFileSync(join(ws, 'brand', 'brand.json'), 'utf8')); } catch (e) {
    bad(`brand/brand.json is ${e.code === 'ENOENT' ? 'missing' : 'not JSON'}`);
    return { brand: null, problems };
  }
  const keys = (v, where, allowed) => {
    if (!isObj(v)) return bad(`${where} must be an object`);
    for (const k of Object.keys(v)) if (!allowed.includes(k)) bad(`${where}: unknown key ${k}`);
    return true;
  };
  const str = (v, where) => typeof v === 'string' || bad(`${where} must be a string`);
  const path = (v, where) => isPath(v) || bad(`${where} must be a path under brand/ whose segments are [A-Za-z0-9._-], none starting with .`);
  if (!keys(b, 'brand.json', KEYS)) return { brand: null, problems };
  let tokens = null;
  if (b.tokens !== undefined && path(b.tokens, 'tokens')) {
    try { tokens = JSON.parse(readFileSync(join(ws, 'brand', b.tokens), 'utf8')); } catch { bad(`tokens: brand/${b.tokens} is not a JSON file`); }
  }
  // A value written as a {reference} is looked up, then `fromTokens` turns the token's $value into the form `ok` takes.
  const value = (v, where, ok, what, fromTokens) => {
    if (typeof v === 'string' && REF_RE.test(v)) {
      const r = lookup(tokens, v);
      if (r.problem) return bad(`${where}: ${r.problem}`);
      v = fromTokens(r.value);
    }
    return ok(v) ? v : bad(`${where} must be ${what}`);
  };
  const out = { ...b };
  if (b.name !== undefined) str(b.name, 'name');
  if (b.favicon !== undefined) path(b.favicon, 'favicon');
  if (b.logo !== undefined && keys(b.logo, 'logo', ['light', 'dark', 'alt'])) {
    path(b.logo.light, 'logo.light');
    if (b.logo.dark !== undefined) path(b.logo.dark, 'logo.dark');
    if (b.logo.alt !== undefined) str(b.logo.alt, 'logo.alt');
  }
  if (b.color !== undefined && keys(b.color, 'color', ['light', 'dark'])) {
    out.color = {};
    for (const scheme of ['light', 'dark']) {
      const m = b.color[scheme];
      if (m === undefined || !keys(m, `color.${scheme}`, Object.keys(m ?? {}))) continue;
      out.color[scheme] = {};
      for (const [t, v] of Object.entries(m)) {
        if (!BRAND_TOKENS.includes(t)) bad(`color.${scheme}: ${t} is not a token of lesson.css`, 'BRAND_TOKEN_UNKNOWN');
        out.color[scheme][t] = value(v, `color.${scheme}.${t}`, isHex, '#rgb, #rrggbb or a {reference}', (x) => (isObj(x) ? x.hex : x));
      }
    }
  }
  if (b.font !== undefined && keys(b.font, 'font', ['body', 'code'])) {
    out.font = {};
    for (const k of ['body', 'code']) {
      if (b.font[k] === undefined) continue;
      out.font[k] = value(b.font[k], `font.${k}`, isFamily, 'comma-separated names of letters, digits, spaces and hyphens, or a {reference}',
        (x) => (Array.isArray(x) && x.every((s) => typeof s === 'string') ? x.join(', ') : x));
    }
  }
  const c = b.footer?.classification;
  if (b.footer !== undefined && keys(b.footer, 'footer', ['classification', 'copyright'])) {
    if (c !== undefined && typeof c !== 'string' && !(isObj(c) && Object.values(c).every((v) => typeof v === 'string'))) {
      bad('footer.classification must be a string or an object of audience to string');
    }
    if (b.footer.copyright !== undefined) str(b.footer.copyright, 'footer.copyright');
  }
  if (b.audience !== undefined) str(b.audience, 'audience');
  if (isObj(c) && !(typeof b.audience === 'string' && Object.hasOwn(c, b.audience))) {
    bad(b.audience === undefined ? 'audience is not set, and footer.classification is by audience' : `audience ${JSON.stringify(b.audience)} is not a key of footer.classification`);
  } else if (!isObj(c) && b.audience !== undefined) bad('audience needs a footer.classification by audience');
  if (b.voice !== undefined && keys(b.voice, 'voice', ['avoid'])) {
    const ok = Array.isArray(b.voice.avoid) && b.voice.avoid.every((a) => isObj(a) && typeof a.term === 'string' && a.term !== '' &&
      Object.keys(a).every((k) => k === 'term' || (k === 'use' && typeof a.use === 'string')));
    if (!ok) bad('voice.avoid must be a list of { "term": string, "use": string (optional) }');
  }
  return problems.length ? { brand: null, problems } : { brand: out, problems };
}

// D2 and D3: the one <style>: the colours in lesson.css's three selector blocks, the fonts, and the slot rules.
const darkRule = (sel, body) => `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"])${sel} { ${body} } }\n:root[data-theme="dark"]${sel} { ${body} }\n`;
const decls = (o = {}) => Object.entries(o).map(([k, v]) => `${k}: ${v};`).join(' ');
export function brandCss(b) {
  let css = '';
  if (decls(b.color?.light)) css += `:root { ${decls(b.color.light)} }\n`;
  if (decls(b.color?.dark)) css += darkRule('', decls(b.color.dark));
  if (b.font?.body) css += `body, a.cite, a[data-cite]:not(.cite):not([href]) { font-family: ${b.font.body}; }\n`;
  if (b.font?.code) css += `code, pre { font-family: ${b.font.code}; }\n`;
  css += '.brand-header, .brand-footer { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; color: var(--muted); font-size: 0.85rem; }\n';
  css += '.brand-header img { max-height: 3rem; width: auto; }\n';
  if (b.logo?.dark) css += '.brand-logo-dark { display: none; }\n' + darkRule(' .brand-logo-light', 'display: none;') + darkRule(' .brand-logo-dark', 'display: inline;');
  return css;
}

// D3: the favicon link and the <style> before the first </head>; the header after the nav bar, else after <body>; the
// footer before the last </body>, its spans apart by a space so the export's phrase check reads each as its own words.
// `position` is [n, m] on a lesson, else null; `year` replaces {year}. All brand text is escaped. With no brand the html
// is returned as it is.
export function withBrand(html, brand, { position = null, year } = {}) {
  if (!brand) return html;
  const b = brand;
  const head = (b.favicon ? `<link rel="icon" href="${escapeHtml(brandUrl(b.favicon))}">` : '') + `<style>\n${brandCss(b)}</style>`;
  const img = (f, cls) => `<img class="${cls}" src="${escapeHtml(brandUrl(f))}" alt="${escapeHtml(b.logo.alt ?? '')}">`;
  const logo = b.logo ? `<a href="/">${img(b.logo.light, 'brand-logo-light')}${b.logo.dark ? img(b.logo.dark, 'brand-logo-dark') : ''}</a>` : '';
  const name = b.name !== undefined ? `<span class="brand-name">${escapeHtml(b.name)}</span>` : '';
  const header = logo || name ? `<header class="brand-header">${logo}${name}</header>` : '';
  const f = b.footer ?? {};
  const classification = typeof f.classification === 'string' ? f.classification : f.classification?.[b.audience];
  const spans = [classification, f.copyright?.replaceAll('{year}', String(year)), position && `lesson ${position[0]} of ${position[1]}`];
  const footer = classification !== undefined || f.copyright !== undefined
    ? `<footer class="brand-footer">${spans.filter((s) => typeof s === 'string').map((s) => `<span>${escapeHtml(s)}</span>`).join(' ')}</footer>` : '';
  let out = html.replace(/<\/head>/i, (m) => head + m);
  const nav = /<nav class="lesson-nav">[\s\S]*?<\/nav>/.exec(out);
  out = nav ? out.slice(0, nav.index + nav[0].length) + header + out.slice(nav.index + nav[0].length) : out.replace(/<body\b[^>]*>/i, (m) => m + header);
  const i = out.toLowerCase().lastIndexOf('</body>');
  return i === -1 ? out : out.slice(0, i) + footer + out.slice(i);
}
