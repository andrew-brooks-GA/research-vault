// Minimal YAML-subset parser/serializer for vault entry frontmatter.
// Supported: scalars, flow sequences [a,b], block sequences of scalars,
// block sequence of maps (verifications), one nested map (subject).

const FM = /^﻿?---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function parseScalar(raw) {
  const s = raw.trim();
  if (s === '') return '';
  if (s === '[]') return [];
  if (s.startsWith('[') && s.endsWith(']')) {
    return s.slice(1, -1).split(',').map(x => parseScalar(x)).filter(x => x !== '');
  }
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+$/.test(s)) return Number(s);
  return s;
}

export function parseFrontmatter(text) {
  const m = FM.exec(text);
  if (!m) throw new Error('missing or malformed frontmatter');
  const [, fm, body] = m;
  const lines = fm.split('\n');
  const data = {};
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') { i++; continue; }
    const top = /^([A-Za-z_][\w]*):(.*)$/.exec(line);
    if (!top) throw new Error(`unparseable frontmatter line: ${line}`);
    const key = top[1];
    const rest = top[2].trim();
    if (rest !== '') { data[key] = parseScalar(rest); i++; continue; }
    const next = lines[i + 1] ?? '';
    if (/^\s+-\s/.test(next)) {
      const seq = [];
      i++;
      while (i < lines.length && /^\s+-\s?/.test(lines[i])) {
        const itemFirst = lines[i].replace(/^\s+-\s?/, '');
        if (/^[A-Za-z_][\w]*:/.test(itemFirst)) {
          const obj = {};
          const kv = /^([A-Za-z_][\w]*):(.*)$/.exec(itemFirst);
          obj[kv[1]] = parseScalar(kv[2]);
          i++;
          while (i < lines.length && /^\s{4,}[A-Za-z_][\w]*:/.test(lines[i])) {
            const kv2 = /^\s+([A-Za-z_][\w]*):(.*)$/.exec(lines[i]);
            obj[kv2[1]] = parseScalar(kv2[2]);
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
        obj[kv[1]] = parseScalar(kv[2]);
        i++;
      }
      data[key] = obj;
    } else {
      data[key] = '';
      i++;
    }
  }
  return { data, body };
}

function emitScalar(v) {
  if (Array.isArray(v)) return `[${v.map(emitScalar).join(', ')}]`;
  if (typeof v === 'string') {
    if (v === '' || /[:#"]|^\s|\s$/.test(v)) return `"${v.replace(/"/g, '\\"')}"`;
    return v;
  }
  return String(v);
}

export function serializeFrontmatter(data, body, order = null) {
  const keys = order ? order.filter(k => k in data) : Object.keys(data);
  const extra = order ? Object.keys(data).filter(k => !order.includes(k)) : [];
  const out = ['---'];
  for (const key of [...keys, ...extra]) {
    const v = data[key];
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
      out.push(`${key}:`);
      for (const item of v) {
        const ks = Object.keys(item);
        out.push(`  - ${ks[0]}: ${emitScalar(item[ks[0]])}`);
        for (const k of ks.slice(1)) out.push(`    ${k}: ${emitScalar(item[k])}`);
      }
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      out.push(`${key}:`);
      for (const k of Object.keys(v)) out.push(`  ${k}: ${emitScalar(v[k])}`);
    } else {
      out.push(`${key}: ${emitScalar(v)}`);
    }
  }
  out.push('---');
  const text = out.join('\n') + '\n' + (body.startsWith('\n') ? body.slice(1) : body);
  return text.replace(/[ \t]+\n/g, '\n').replace(/\r/g, '');
}
