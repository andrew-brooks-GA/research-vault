import { isDeepStrictEqual } from 'node:util';

// Minimal YAML-subset parser/serializer for vault entry frontmatter.
// Supported: plain, double-quoted and single-quoted scalars (each may carry a trailing
// ` # comment`), flow sequences [a, "b, c"], block sequences of scalars, block sequence of
// maps (verifications), one nested map (subject), and top-level block scalars (| and >).

const FM = /^﻿?---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const BLOCK_HEADER = /^([|>])(?:([1-9])([-+])?|([-+])([1-9])?)?$/;

// Raw source lines per top-level key, recorded by the parser so a rewrite can leave keys it
// did not change byte-identical. Non-enumerable: invisible to Object.keys / deepEqual / JSON.
export const RAW = Symbol('frontmatterRaw');

// Drop a trailing YAML comment: `#` preceded by whitespace (or at the start), outside quotes.
// A quote only opens a quoted scalar at a token start, so `it's` stays plain text.
function stripComment(s) {
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") { i++; continue; }
        q = null;
      }
      continue;
    }
    if ((c === '"' || c === "'") && (i === 0 || /[\s,[]/.test(s[i - 1]))) { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s[i - 1]))) return s.slice(0, i).trimEnd();
  }
  return s;
}

// Split a flow-sequence body on top-level commas, ignoring commas inside quotes.
function splitFlow(s) {
  const out = [];
  let q = null, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (q === '"' && c === '\\') { i++; continue; }
      if (c === q) {
        if (q === "'" && s[i + 1] === "'") { i++; continue; }
        q = null;
      }
      continue;
    }
    if ((c === '"' || c === "'") && /^\s*$/.test(s.slice(start, i))) { q = c; continue; }
    if (c === ',') { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

function parseScalar(raw) {
  const s = stripComment(raw.trim());
  if (s === '') return '';
  if (s === '[]') return [];
  if (s.startsWith('[') && s.endsWith(']')) {
    return splitFlow(s.slice(1, -1)).map(x => parseScalar(x)).filter(x => x !== '');
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

// Nested values (subject, verifications items) are single-line scalars only. A block-scalar
// header there would otherwise swallow the next indented line as a sibling key.
function parseNestedScalar(raw, line) {
  if (BLOCK_HEADER.test(stripComment(raw.trim())))
    throw new Error(`block scalars are not supported in nested fields: ${line.trim()}`);
  return parseScalar(raw);
}

// Read a block scalar (| literal, > folded) whose header sits on lines[i]. Returns the value
// and the index of the first line after the block.
function parseBlockScalar(lines, i, header) {
  const [, style, ind1, chompA, chompB, ind2] = header;
  const chomp = chompA || chompB || '';
  const explicit = ind1 || ind2;
  const body = [];
  let j = i + 1;
  let indent = explicit ? Number(explicit) : null;
  for (; j < lines.length; j++) {
    const l = lines[j];
    if (l.trim() === '') { body.push(''); continue; }
    const lead = l.length - l.trimStart().length;
    if (indent === null) indent = lead;
    if (indent === 0 || lead < indent) break;
    body.push(l.slice(indent));
  }
  let trailing = 0;
  while (body.length && body[body.length - 1] === '') { body.pop(); trailing++; }
  const consumed = j;
  let text;
  if (style === '|') {
    text = body.join('\n');
  } else {
    text = '';
    let pending = 0, first = true, prevMore = false;
    for (const l of body) {
      if (l === '') { pending++; continue; }
      const more = /^\s/.test(l);
      if (first) text += '\n'.repeat(pending);
      else if (pending === 0) text += (more || prevMore) ? '\n' : ' ';
      else text += '\n'.repeat(pending + ((more || prevMore) ? 1 : 0));
      text += l;
      pending = 0; first = false; prevMore = more;
    }
  }
  if (body.length) {
    if (chomp === '') text += '\n';
    else if (chomp === '+') text += '\n' + '\n'.repeat(trailing);
  } else if (chomp === '+') {
    text = '\n'.repeat(trailing);
  }
  return { value: text, next: consumed };
}

export function parseFrontmatter(text) {
  const m = FM.exec(text);
  if (!m) throw new Error('missing or malformed frontmatter');
  const [, fm, body] = m;
  const lines = fm.split('\n');
  const data = {};
  const raw = {};
  let lastKey = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      if (lastKey) raw[lastKey].lines.push(line);
      i++; continue;
    }
    const top = /^([A-Za-z_][\w]*):(.*)$/.exec(line);
    if (!top) throw new Error(`unparseable frontmatter line: ${line}`);
    const key = top[1];
    const start = i;
    const rest = stripComment(top[2].trim());
    const header = BLOCK_HEADER.exec(rest);
    if (header) {
      const r = parseBlockScalar(lines, i, header);
      data[key] = r.value;
      i = r.next;
    } else if (rest !== '') {
      data[key] = parseScalar(rest);
      i++;
    } else {
      const next = lines[i + 1] ?? '';
      if (/^\s+-\s/.test(next)) {
        const seq = [];
        i++;
        while (i < lines.length && /^\s+-\s?/.test(lines[i])) {
          const itemFirst = lines[i].replace(/^\s+-\s?/, '');
          if (/^[A-Za-z_][\w]*:/.test(itemFirst)) {
            const obj = {};
            const kv = /^([A-Za-z_][\w]*):(.*)$/.exec(itemFirst);
            obj[kv[1]] = parseNestedScalar(kv[2], lines[i]);
            i++;
            while (i < lines.length && /^\s{4,}[A-Za-z_][\w]*:/.test(lines[i])) {
              const kv2 = /^\s+([A-Za-z_][\w]*):(.*)$/.exec(lines[i]);
              obj[kv2[1]] = parseNestedScalar(kv2[2], lines[i]);
              i++;
            }
            seq.push(obj);
          } else {
            seq.push(parseScalar(itemFirst));
            i++;
          }
        }
        data[key] = seq;
      } else if (/^\s+[A-Za-z_][\w]*:/.test(next)) {
        const obj = {};
        i++;
        while (i < lines.length && /^\s+[A-Za-z_][\w]*:/.test(lines[i])) {
          const kv = /^\s+([A-Za-z_][\w]*):(.*)$/.exec(lines[i]);
          obj[kv[1]] = parseNestedScalar(kv[2], lines[i]);
          i++;
        }
        data[key] = obj;
      } else {
        data[key] = '';
        i++;
      }
    }
    raw[key] = { lines: lines.slice(start, i), value: structuredClone(data[key]) };
    lastKey = key;
  }
  Object.defineProperty(data, RAW, { value: raw, enumerable: false });
  return { data, body };
}

function emitScalar(v) {
  if (Array.isArray(v)) return `[${v.map(emitScalar).join(', ')}]`;
  if (typeof v === 'string') {
    if (v === '' || /[:#"]|^\s|\s$/.test(v) || /^['[|>]/.test(v) ||
        v === 'true' || v === 'false' || /^-?\d+$/.test(v)) {
      return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
    }
    return v;
  }
  return String(v);
}

// A top-level multi-line string is written as a literal block scalar so it survives a
// round-trip. Chomping follows the trailing newlines; an indentation indicator is added
// when the first content line itself starts with a space.
function emitBlock(key, v) {
  const chomp = !v.endsWith('\n') ? '-' : (v.endsWith('\n\n') || v === '\n') ? '+' : '';
  const content = chomp === '-' ? v : v.slice(0, -1);
  const firstText = content.split('\n').find(l => l !== '') ?? '';
  const indicator = /^\s/.test(firstText) ? '2' : '';
  const out = [`${key}: |${indicator}${chomp}`];
  for (const l of content.split('\n')) out.push(l === '' ? '' : `  ${l}`);
  return out;
}

// `preserve` (default on) re-emits the original source lines of any top-level key whose value
// is unchanged since parse, and keeps the original key order; changed or new keys are
// normalized. Pass `{ preserve: false }` for a deliberate full normalization (lint --fix).
export function serializeFrontmatter(data, body, order = null, { preserve = true } = {}) {
  const raw = preserve ? data[RAW] : null;
  let keys;
  if (raw) {
    // Original order for keys that were already there; a new key goes in front of the first
    // existing key that follows it in `order`, else at the end.
    keys = Object.keys(raw).filter(k => k in data);
    for (const k of Object.keys(data)) {
      if (k in raw) continue;
      const at = order ? order.indexOf(k) : -1;
      const before = at < 0 ? -1 : keys.findIndex(x => order.indexOf(x) > at);
      if (before < 0) keys.push(k); else keys.splice(before, 0, k);
    }
  } else {
    const ordered = order ? order.filter(k => k in data) : Object.keys(data);
    const extra = order ? Object.keys(data).filter(k => !order.includes(k)) : [];
    keys = [...ordered, ...extra];
  }
  const out = ['---'];
  for (const key of keys) {
    const v = data[key];
    if (raw && raw[key] && isDeepStrictEqual(v, raw[key].value)) {
      out.push(...raw[key].lines);
    } else if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      out.push(`${key}:`);
      for (const item of v) {
        const ks = Object.keys(item);
        out.push(`  - ${ks[0]}: ${emitScalar(item[ks[0]])}`);
        for (const k of ks.slice(1)) out.push(`    ${k}: ${emitScalar(item[k])}`);
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(`${key}:`);
      for (const k of Object.keys(v)) out.push(`  ${k}: ${emitScalar(v[k])}`);
    } else if (typeof v === 'string' && v.includes('\n')) {
      out.push(...emitBlock(key, v));
    } else {
      out.push(`${key}: ${emitScalar(v)}`);
    }
  }
  out.push('---');
  const text = out.join('\n') + '\n' + (body.startsWith('\n') ? body.slice(1) : body);
  return text.replace(/\r/g, '');
}
