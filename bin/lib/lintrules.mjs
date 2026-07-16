import { readFileSync, writeFileSync } from 'node:fs';
import { walkEntries, readEntry } from './fsutil.mjs';
import { loadSchema, stageAllowedInFolder, fieldOrder } from './schema.mjs';
import { serializeFrontmatter } from './frontmatter.mjs';
import { CONTROLLED_FIELDS, VERIFICATION_CONTROLLED_FIELDS } from './validate.mjs';

const FOLDER_TYPE = { sources:'source', notes:'note', synthesis:'synthesis', snippets:'snippet', experiments:'experiment', questions:'question' };
const MONOLITHIC_SYNTHESIS_WORDS = 1500;

// lint's enum coverage is driven from the same CONTROLLED_FIELDS / VERIFICATION_CONTROLLED_FIELDS
// maps the fail-fast validator (validate.mjs) uses, so the two cannot silently diverge. These
// tables only supply the emitted violation code + human label per field; the field list itself
// (hence coverage) comes from validate.mjs.
const ENUM_META = {
  domain:          { code: 'ENUM_DOMAIN',          label: 'domain' },
  volatility:      { code: 'ENUM_VOLATILITY',      label: 'volatility' },
  status:          { code: 'ENUM_STATUS',          label: 'status' },
  confidence:      { code: 'ENUM_CONFIDENCE',      label: 'confidence' },
  outcome:         { code: 'ENUM_OUTCOME',         label: 'outcome' },
  state:           { code: 'ENUM_QUESTION_STATE',  label: 'question state' },
  synthesis_basis: { code: 'ENUM_SYNTHESIS_BASIS', label: 'synthesis_basis' },
  authority_tier:  { code: 'ENUM_AUTHORITY_TIER',  label: 'authority_tier' },
  authority_basis: { code: 'ENUM_AUTHORITY_BASIS', label: 'authority_basis' },
};
// method/result are required-valid: an absent value lints as `unknown method: undefined`
// (lint is detective, so it flags the hole); validate skips absent fields. by_type is optional.
const VERIFICATION_ENUM_META = {
  method:  { code: 'ENUM_METHOD',  label: 'method',             required: true },
  result:  { code: 'ENUM_RESULT',  label: 'result',             required: true },
  by_type: { code: 'ENUM_BY_TYPE', label: 'verification by_type', required: false },
};

const allowedValues = (schema, key) => {
  const t = schema.taxonomy[key];
  return Array.isArray(t) ? t : Object.keys(t);
};
const isParsableUrl = (u) => { try { new URL(u); return true; } catch { return false; } };

export function lintVault(vaultPath, repoRoot) {
  const schema = loadSchema(repoRoot, { vaultPath });
  // Dangling-ref coverage = every declared edge field (backlink-forming + reference-only),
  // shared with the manifest's backlink builder via schema/frontmatter.schema.json.
  const edgeFields = [...schema.fields.edge_fields.backlink, ...schema.fields.edge_fields.reference_only];
  const files = walkEntries(vaultPath);
  const ids = new Set(files.map(f => f.split(/[\\/]/).pop().replace(/\.md$/, '')));
  const violations = [];
  const add = (file, code, msg) => violations.push({ file, code, msg });
  const warnings = [];
  const warn = (file, code, msg) => warnings.push({ file, code, msg });

  // First pass: build id -> type map for cross-entry checks (e.g. synthesis note-coverage).
  const idType = new Map();
  for (const abs of files) {
    try {
      const e = readEntry(abs);
      const id = abs.split(/[\\/]/).pop().replace(/\.md$/, '');
      if (e.data && e.data.type) idType.set(id, e.data.type);
    } catch { /* PARSE will surface in the main loop */ }
  }

  for (const abs of files) {
    const raw = readFileSync(abs, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) add(abs, 'ENCODING_BOM', 'file has a UTF-8 BOM');
    if (/\r/.test(raw)) add(abs, 'ENCODING_CRLF', 'file has CRLF line endings');
    if (/\u00C3\u00A2\u00E2\u201A\u00AC/.test(raw)) add(abs, 'ENCODING_MOJIBAKE', 'double-encoded UTF-8 detected');

    let entry;
    try { entry = readEntry(abs); } catch (e) { add(abs, 'PARSE', e.message); continue; }
    const { folder, data } = entry;

    for (const f of schema.fields.derived_forbidden) if (f in data) add(abs, 'STORED_DERIVED', `stored derived field: ${f}`);
    if (FOLDER_TYPE[folder] && data.type !== FOLDER_TYPE[folder]) add(abs, 'TYPE_FOLDER', `type ${data.type} in folder ${folder}`);
    if (data.stage && !stageAllowedInFolder(schema, folder, data.stage)) add(abs, 'STAGE_FOLDER', `stage ${data.stage} not allowed in ${folder}`);
    // Enum checks driven from CONTROLLED_FIELDS (validate.mjs). Shape-check array-valued
    // controlled fields (domain) BEFORE enum iteration, or a bare scalar `domain: security`
    // would be walked character-by-character into garbage per-char violations.
    for (const [field, key] of Object.entries(CONTROLLED_FIELDS)) {
      const val = data[field]; if (!val) continue;
      const meta = ENUM_META[field];
      if (field === 'domain') {
        if (!Array.isArray(val)) { add(abs, 'FIELD_SHAPE', 'domain must be a list'); continue; }
        for (const d of val) if (!allowedValues(schema, key).includes(d)) add(abs, meta.code, `unknown ${meta.label}: ${d}`);
      } else if (!allowedValues(schema, key).includes(val)) {
        add(abs, meta.code, `unknown ${meta.label}: ${val}`);
      }
    }
    for (const v of (data.verifications || [])) {
      for (const [field, key] of Object.entries(VERIFICATION_CONTROLLED_FIELDS)) {
        const meta = VERIFICATION_ENUM_META[field];
        const val = v[field];
        if (!meta.required && (val === undefined || val === null || val === '')) continue;
        if (!allowedValues(schema, key).includes(val)) add(abs, meta.code, `unknown ${meta.label}: ${val}`);
      }
    }
    if (data.type === 'source' && data.source_url && !isParsableUrl(data.source_url))
      add(abs, 'URL_INVALID', `source_url is not a valid URL: ${data.source_url}`);
    // A tool-output source is ground truth only for the tool version that produced it;
    // without subject.version it cannot participate in version-pinned reconciliation
    // (tool-probe verification, version succession). Hard violation, unlike the advisory
    // WARN_MISSING_VERSION for docs. See meta/prompt-templates/probe-tool.md.
    if (data.authority_basis === 'tool-output' && !(data.subject && data.subject.version))
      add(abs, 'TOOL_OUTPUT_VERSION', 'authority_basis tool-output requires subject.version (the probed tool version)');
    for (const f of edgeFields) {
      const val = data[f]; if (!val) continue;
      for (const ref of Array.isArray(val) ? val : [val]) if (ref && !ids.has(ref)) add(abs, 'DANGLING_REF', `${f} -> missing id ${ref}`);
    }
    const required = schema.fields.required_by_type[data.type] || [];
    // Presence-only is not enough: a required field present but empty ('' or []) is as broken
    // as an absent one. Capture refuses to emit these; hand-authored entries still can.
    for (const f of required) {
      const v = data[f];
      if (!(f in data) || v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0))
        add(abs, 'MISSING_REQUIRED', `missing required field: ${f}`);
    }
    if (data.status === 'superseded' && !data.superseded_by) add(abs, 'SUPERSEDE', 'superseded without superseded_by');
    if (data.subject && !(data.subject.name)) add(abs, 'SUBJECT_SHAPE', 'subject requires name');

    if (data.type === 'source' && data.volatility === 'fast' && data.source_type === 'docs' && !(data.subject && data.subject.version))
      warn(abs, 'WARN_MISSING_VERSION', 'fast docs source without subject.version');

    // Verification tenet: a source whose every verification is `captured` (capture-time
    // provenance, never an independent check) is not authoritative — its only basis is
    // that someone asserted it. Verify by fetch (refetched-source / cross-referenced) or
    // human-spot-check before relying on it. See AGENTS.md §7.
    if (data.type === 'source' && !(data.verifications || []).some(v => v.method && v.method !== 'captured'))
      warn(abs, 'WARN_SOURCE_UNVERIFIED', 'source has only capture-time provenance and was never independently verified; verify by refetched-source / cross-referenced / human-spot-check before treating it as authoritative');

    // A note/synthesis without a one-line summary is opaque to the manifest: retrieval,
    // advise, and export must open the body to know what it claims. Advisory only —
    // the field is optional and the detective floor is unaffected. See AGENTS.md §9.
    if ((data.type === 'note' || data.type === 'synthesis') && !(data.summary && String(data.summary).trim()))
      warn(abs, 'WARN_MISSING_SUMMARY', 'no summary: one-line claim; add it so search/advise/export can use the entry without a body read');

    // An answered question with no answer_summary exports nothing — the default export emits
    // only answered questions carrying a non-empty answer_summary. Advisory; exit code unaffected.
    if (data.type === 'question' && data.state === 'answered' && !(data.answer_summary && String(data.answer_summary).trim()))
      warn(abs, 'WARN_ANSWERED_NO_SUMMARY', 'answered question has no answer_summary; it exports nothing — add one (capture --answer-summary) so the answer is emitted');

    for (const t of (data.topics || [])) if (schema.taxonomy.topic_aliases[t]) warn(abs, 'WARN_TOPIC_ALIAS', `topic '${t}' should be normalized to '${schema.taxonomy.topic_aliases[t]}'`);

    // Synthesis note-coverage: a synthesis whose contributing_ids contain only sources
    // (no notes) is non-conforming unless it declares synthesis_basis: primary-rollup.
    // See AGENTS.md §2.5–2.6.
    if (data.type === 'synthesis' && Array.isArray(data.contributing_ids) && data.contributing_ids.length > 0 && data.synthesis_basis !== 'primary-rollup') {
      const types = data.contributing_ids.map(r => idType.get(r)).filter(Boolean);
      const hasNote = types.includes('note');
      const hasSource = types.includes('source');
      if (hasSource && !hasNote)
        warn(abs, 'WARN_SYNTHESIS_NO_NOTE_COVERAGE', 'synthesis cites sources directly with no contributing note; distill load-bearing sources to notes first, or set synthesis_basis: primary-rollup for a factual rollup');
    }

    // Monolithic-synthesis heuristic: large body + no note contributors + no primary-rollup
    // declaration is the empirical shape of a bypassed-distillation report. See AGENTS.md §2.6.
    if (data.type === 'synthesis' && data.synthesis_basis !== 'primary-rollup') {
      const types = (Array.isArray(data.contributing_ids) ? data.contributing_ids : []).map(r => idType.get(r)).filter(Boolean);
      const hasNote = types.includes('note');
      const words = (entry.body || '').split(/\s+/).filter(Boolean).length;
      if (!hasNote && words > MONOLITHIC_SYNTHESIS_WORDS)
        warn(abs, 'WARN_SYNTHESIS_MONOLITHIC', `synthesis body is ${words} words with no contributing note; extract notes and trim to cross-source claims, or set synthesis_basis: primary-rollup if this is a factual rollup`);
    }
  }
  return { violations, warnings, ids: [...ids] };
}

export function fixVault(vaultPath, repoRoot) {
  const schema = loadSchema(repoRoot, { vaultPath });
  let fixed = 0;
  for (const abs of walkEntries(vaultPath)) {
    const raw = readFileSync(abs, 'utf8');
    const normalized = raw.replace(/^\uFEFF/, '').replace(/\r/g, '');
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
