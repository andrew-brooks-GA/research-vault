import { isDeepStrictEqual } from 'node:util';

// Minimal YAML-subset parser/serializer for vault entry frontmatter.
// Supported: plain, double-quoted and single-quoted scalars (each may carry a trailing
// ` # comment`), flow sequences [a, "b, c"], block sequences of scalars, block sequence of
// maps (verifications), one nested map (subject), and top-level block scalars (| and >).
// Double-quoted scalars decode \n, \r, \\, and \" escapes.

const FM = /^﻿?---\n([\s\S]*?)\n---\n?([\s\S]*)$/;
const BLOCK_HEADER = /^([|>])(?:([1-9])([-+])?|([-+])([1-9])?)?$/;

// Raw source lines per top-level key, recorded by the parser so a rewrite can leave keys it
// did not change byte-identical. Non-enumerable: invisible to Object.keys / deepEqual / JSON.
export const RAW: unique symbol = Symbol('frontmatterRaw');

type Scalar = string | number | boolean | Scalar[];
type ScalarMap = Record<string, Scalar>;
type ParsedValue = Scalar | ScalarMap | (Scalar | ScalarMap)[];
type RawFrontmatter<T> = Record<string, { lines: string[]; value: T }>;
type FrontmatterData<T> = {
  [key: string]: T;
  readonly [RAW]?: RawFrontmatter<T>;
};

// Drop a trailing YAML comment: `#` preceded by whitespace (or at the start), outside quotes.
// A quote only opens a quoted scalar at a token start, so `it's` stays plain text.
function stripComment(s: string) {
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
    if ((c === '"' || c === "'") && (i === 0 || /[\s,[]/.test(s.charAt(i - 1)))) { q = c; continue; }
    if (c === '#' && (i === 0 || /\s/.test(s.charAt(i - 1)))) return s.slice(0, i).trimEnd();
  }
  return s;
}

// Split a flow-sequence body on top-level commas, ignoring commas inside quotes.
function splitFlow(s: string) {
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

function parseScalar(raw: string): Scalar {
  const s = stripComment(raw.trim());
  if (s === '') return '';
  if (s === '[]') return [];
  if (s.startsWith('[') && s.endsWith(']')) {
    return splitFlow(s.slice(1, -1)).filter((x: string) => stripComment(x.trim()) !== '').map((x: string) => parseScalar(x));
  }
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/\\(["\\nr])/g, (_: string, c: string) => c === 'n' ? '\n' : c === 'r' ? '\r' : c);
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) return s.slice(1, -1).replace(/''/g, "'");
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

// Nested values (subject, verifications items) are single-line scalars only. A block-scalar
// header there would otherwise swallow the next indented line as a sibling key.
function parseNestedScalar(raw: string, line: string) {
  if (BLOCK_HEADER.test(stripComment(raw.trim())))
    throw new Error(`block scalars are not supported in nested fields: ${line.trim()}`);
  return parseScalar(raw);
}

// Read a block scalar (| literal, > folded) whose header sits on lines[i]. Returns the value
// and the index of the first line after the block.
function parseBlockScalar(lines: string[], i: number, header: RegExpExecArray) {
  const [, style, ind1, chompA, chompB, ind2] = header;
  const chomp = chompA || chompB || '';
  const explicit = ind1 || ind2;
  const body = [];
  let j = i + 1;
  let indent = explicit ? Number(explicit) : null;
  for (let line; (line = lines[j]) !== undefined; j++) {
    const l = line.replace(/\r$/, '');
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

// S-13: assigning a `__proto__` key would set the object's prototype (an object value) or be dropped (a scalar), so
// the key is refused; any other key, `constructor` or `toString` too, is an ordinary own key.
function keyOf(key: string) {
  if (key === '__proto__') throw new Error('unsupported frontmatter key: __proto__');
  return key;
}

export function parseFrontmatter(text: string): { data: FrontmatterData<ParsedValue>; body: string } {
  const m = FM.exec(text.replace(/\r\n/g, '\n'));
  if (!m) throw new Error('missing or malformed frontmatter');
  const [, fm, body] = m;
  if (fm === undefined || body === undefined) throw new Error('parseFrontmatter: expected frontmatter and body captures');
  const lines = fm.split('\n');
  const data: FrontmatterData<ParsedValue> = {};
  const raw: RawFrontmatter<ParsedValue> = {};
  let lastLines = null;
  let i = 0;
  let line;
  while ((line = lines[i]) !== undefined) {
    if (line.trim() === '') {
      if (lastLines) lastLines.push(line);
      i++; continue;
    }
    const top = /^([A-Za-z_][\w]*):([\s\S]*)$/.exec(line);
    if (!top) throw new Error(`unparseable frontmatter line: ${line}`);
    const [, topKey, topValue] = top;
    if (topKey === undefined || topValue === undefined) throw new Error('parseFrontmatter: expected top-level key and value captures');
    const key = keyOf(topKey);
    const start = i;
    const rest = stripComment(topValue.trim());
    const header = BLOCK_HEADER.exec(rest);
    let value: ParsedValue;
    if (header) {
      const r = parseBlockScalar(lines, i, header);
      value = r.value;
      i = r.next;
    } else if (rest !== '') {
      value = parseScalar(rest);
      i++;
    } else {
      const next = lines[i + 1] ?? '';
      if (/^\s+-\s/.test(next)) {
        const seq = [];
        i++;
        let item;
        while ((item = lines[i]) !== undefined) {
          const marker = /^\s+-\s?([\s\S]*)$/.exec(item);
          if (!marker) break;
          const [, itemFirst] = marker;
          if (itemFirst === undefined) throw new Error('parseFrontmatter: expected a sequence item capture');
          const kv = /^([A-Za-z_][\w]*):([\s\S]*)$/.exec(itemFirst);
          if (kv) {
            const obj: ScalarMap = {};
            const [, itemKey, itemValue] = kv;
            if (itemKey === undefined || itemValue === undefined) throw new Error('parseFrontmatter: expected sequence key and value captures');
            obj[keyOf(itemKey)] = parseNestedScalar(itemValue, item);
            i++;
            let field;
            while ((field = lines[i]) !== undefined) {
              const kv2 = /^\s{4,}([A-Za-z_][\w]*):([\s\S]*)$/.exec(field);
              if (!kv2) break;
              const [, fieldKey, fieldValue] = kv2;
              if (fieldKey === undefined || fieldValue === undefined) throw new Error('parseFrontmatter: expected sequence field key and value captures');
              obj[keyOf(fieldKey)] = parseNestedScalar(fieldValue, field);
              i++;
            }
            seq.push(obj);
          } else {
            seq.push(parseScalar(itemFirst));
            i++;
          }
        }
        value = seq;
      } else {
        const obj: ScalarMap = {};
        i++;
        let field;
        while ((field = lines[i]) !== undefined) {
          const kv = /^\s+([A-Za-z_][\w]*):([\s\S]*)$/.exec(field);
          if (!kv) break;
          const [, fieldKey, fieldValue] = kv;
          if (fieldKey === undefined || fieldValue === undefined) throw new Error('parseFrontmatter: expected nested key and value captures');
          obj[keyOf(fieldKey)] = parseNestedScalar(fieldValue, field);
          i++;
        }
        value = i === start + 1 ? '' : obj;
      }
    }
    data[key] = value;
    lastLines = lines.slice(start, i);
    raw[key] = { lines: lastLines, value: structuredClone(value) };
  }
  Object.defineProperty(data, RAW, { value: raw, enumerable: false });
  return { data, body };
}

function emitScalar(v: unknown, flow: boolean = false): string {
  if (Array.isArray(v)) return `[${v.map((x: unknown) => emitScalar(x, true)).join(', ')}]`;
  if (typeof v === 'string') {
    if (v === '' || /[:#"\n\r]|^\s|\s$/.test(v) || (flow && /,|[\s[]'/.test(v)) || /^['[|>]/.test(v) ||
        v === 'true' || v === 'false' || /^-?\d+$/.test(v)) {
      return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')}"`;
    }
    return v;
  }
  return String(v);
}

// Keep the existing block form for top-level multiline strings unless CRs or whitespace-only
// lines would be lost. Chomping follows the trailing newlines; an indentation indicator is
// added when the first content line itself starts with a space.
function emitBlock(key: string, v: string) {
  const chomp = !v.endsWith('\n') ? '-' : (v.endsWith('\n\n') || v === '\n') ? '+' : '';
  const content = chomp === '-' ? v : v.slice(0, -1);
  const firstText = content.split('\n').find((l: string) => l !== '') ?? '';
  const indicator = /^\s/.test(firstText) ? '2' : '';
  const out = [`${key}: |${indicator}${chomp}`];
  for (const l of content.split('\n')) out.push(l === '' ? '' : `  ${l}`);
  return out;
}

function hasCarriageReturn(v: unknown): unknown {
  if (typeof v === 'string') return v.includes('\r');
  return v && typeof v === 'object' && Object.values(v).some(hasCarriageReturn);
}

// `preserve` (default on) re-emits the original source lines of any top-level key whose value
// is unchanged since parse, and keeps the original key order; changed or new keys are
// normalized. Pass `{ preserve: false }` for a deliberate full normalization (lint --fix).
export function serializeFrontmatter(data: FrontmatterData<unknown>, body: string, order: readonly string[] | null = null, { preserve = true }: { preserve?: boolean | undefined } = {}): string {
  const raw = preserve ? data[RAW] : null;
  let keys;
  if (raw) {
    // Original order for keys that were already there; a new key goes in front of the first
    // existing key that follows it in `order`, else at the end.
    keys = Object.keys(raw).filter((k: string) => Object.hasOwn(data, k));
    for (const k of Object.keys(data)) {
      if (Object.hasOwn(raw, k)) continue;
      const at = order ? order.indexOf(k) : -1;
      const before = !order || at < 0 ? -1 : keys.findIndex((x: string) => order.indexOf(x) > at);
      if (before < 0) keys.push(k); else keys.splice(before, 0, k);
    }
  } else {
    const ordered = order ? order.filter((k: string) => Object.hasOwn(data, k)) : Object.keys(data);
    const extra = order ? Object.keys(data).filter((k: string) => !order.includes(k)) : [];
    keys = [...ordered, ...extra];
  }
  function isMap(item: unknown): item is Record<string, unknown> {
    return item !== null && typeof item === 'object' && !Array.isArray(item);
  }
  const out = ['---'];
  for (const key of keys) {
    const v = data[key];
    const saved = raw && Object.hasOwn(raw, key) ? raw[key] : undefined;
    // CRs inside raw block values are content; final normalization would erase them.
    if (saved && isDeepStrictEqual(v, saved.value) &&
        !(saved.lines.some((l: string) => l.includes('\r')) && hasCarriageReturn(v))) {
      out.push(...saved.lines);
    } else if (Array.isArray(v) && v.some((item: unknown) => isMap(item) || Array.isArray(item))) {
      out.push(`${key}:`);
      for (const item of v) {
        if (!isMap(item)) {
          out.push(`  - ${emitScalar(item)}`);
          continue;
        }
        const [first, ...rest] = Object.entries(item);
        if (first === undefined) throw new Error('serializeFrontmatter: a row with no key');
        const [firstKey, firstValue] = first;
        out.push(`  - ${firstKey}: ${emitScalar(firstValue)}`);
        for (const [k, value] of rest) out.push(`    ${k}: ${emitScalar(value)}`);
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(`${key}:`);
      for (const [k, value] of Object.entries(v)) out.push(`  ${k}: ${emitScalar(value)}`);
    } else if (typeof v === 'string' && v.includes('\n') && !v.includes('\r') && !v.split('\n').some((l: string) => l !== '' && l.trim() === '')) {
      out.push(...emitBlock(key, v));
    } else {
      out.push(`${key}: ${emitScalar(v)}`);
    }
  }
  out.push('---');
  const text = out.join('\n') + '\n' + (body.startsWith('\n') ? body.slice(1) : body);
  return text.replace(/\r/g, '');
}
