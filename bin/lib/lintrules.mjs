import { readFileSync, writeFileSync } from 'node:fs';
import { walkEntries, readEntry } from './fsutil.mjs';
import { loadSchema, stageAllowedInFolder, fieldOrder } from './schema.mjs';
import { serializeFrontmatter } from './frontmatter.mjs';

const FOLDER_TYPE = { sources:'source', notes:'note', synthesis:'synthesis', snippets:'snippet', experiments:'experiment', questions:'question' };
const EDGE_FIELDS = ['related','contributing_ids','sources','source_id','prompt_id','superseded_by'];

export function lintVault(vaultPath, repoRoot) {
  const schema = loadSchema(repoRoot);
  const files = walkEntries(vaultPath);
  const ids = new Set(files.map(f => f.split(/[\\/]/).pop().replace(/\.md$/, '')));
  const violations = [];
  const add = (file, code, msg) => violations.push({ file, code, msg });

  for (const abs of files) {
    const raw = readFileSync(abs, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) add(abs, 'ENCODING_BOM', 'file has a UTF-8 BOM');
    if (/\r/.test(raw)) add(abs, 'ENCODING_CRLF', 'file has CRLF line endings');
    if (/Ã¢â‚¬/.test(raw)) add(abs, 'ENCODING_MOJIBAKE', 'double-encoded UTF-8 detected');

    let entry;
    try { entry = readEntry(abs); } catch (e) { add(abs, 'PARSE', e.message); continue; }
    const { folder, data } = entry;

    for (const f of schema.fields.derived_forbidden) if (f in data) add(abs, 'STORED_DERIVED', `stored derived field: ${f}`);
    if (FOLDER_TYPE[folder] && data.type !== FOLDER_TYPE[folder]) add(abs, 'TYPE_FOLDER', `type ${data.type} in folder ${folder}`);
    if (data.stage && !stageAllowedInFolder(schema, folder, data.stage)) add(abs, 'STAGE_FOLDER', `stage ${data.stage} not allowed in ${folder}`);
    if (data.domain) for (const d of data.domain) if (!schema.taxonomy.domain.includes(d)) add(abs, 'ENUM_DOMAIN', `unknown domain: ${d}`);
    if (data.volatility && !(data.volatility in schema.taxonomy.volatility)) add(abs, 'ENUM_VOLATILITY', `unknown volatility: ${data.volatility}`);
    if (data.status && !schema.taxonomy.status.includes(data.status)) add(abs, 'ENUM_STATUS', `unknown status: ${data.status}`);
    for (const v of (data.verifications || [])) {
      if (!schema.taxonomy.verification_method.includes(v.method)) add(abs, 'ENUM_METHOD', `unknown method: ${v.method}`);
      if (!schema.taxonomy.verification_result.includes(v.result)) add(abs, 'ENUM_RESULT', `unknown result: ${v.result}`);
    }
    for (const f of EDGE_FIELDS) {
      const val = data[f]; if (!val) continue;
      for (const ref of Array.isArray(val) ? val : [val]) if (ref && !ids.has(ref)) add(abs, 'DANGLING_REF', `${f} -> missing id ${ref}`);
    }
    const required = schema.fields.required_by_type[data.type] || [];
    for (const f of required) if (!(f in data)) add(abs, 'MISSING_REQUIRED', `missing required field: ${f}`);
    if (data.status === 'superseded' && !data.superseded_by) add(abs, 'SUPERSEDE', 'superseded without superseded_by');
    if (data.subject && !(data.subject.name)) add(abs, 'SUBJECT_SHAPE', 'subject requires name');
  }
  return { violations, ids: [...ids] };
}

export function fixVault(vaultPath, repoRoot) {
  const schema = loadSchema(repoRoot);
  let fixed = 0;
  for (const abs of walkEntries(vaultPath)) {
    const raw = readFileSync(abs, 'utf8');
    const normalized = raw.replace(/^﻿/, '').replace(/\r/g, '');
    let out = normalized;
    let entry;
    try { entry = readEntry(abs); } catch { }
    if (entry) {
      const order = fieldOrder(schema, entry.data.type);
      out = serializeFrontmatter(entry.data, entry.body, order);
    }
    if (out !== raw) { writeFileSync(abs, out, 'utf8'); fixed++; }
  }
  return { fixed };
}
