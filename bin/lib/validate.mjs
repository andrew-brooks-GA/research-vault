// Single source of truth for which frontmatter fields are controlled by which taxonomy
// enum. Both the fail-fast mutators (assertControlledValues) and the detective floor
// (lint) derive their enum coverage from this map so the two cannot silently diverge.
export const CONTROLLED_FIELDS = {
  domain: 'domain',
  volatility: 'volatility',
  status: 'status',
  confidence: 'confidence',
  outcome: 'outcome',
  state: 'question_state',
  synthesis_basis: 'synthesis_basis',
  authority_tier: 'authority_tier',
  authority_basis: 'authority_basis',
};

export const VERIFICATION_CONTROLLED_FIELDS = {
  method: 'verification_method',
  result: 'verification_result',
  by_type: 'by_type',
};

export function allowedValues(schema, key) {
  const t = schema.taxonomy[key];
  return Array.isArray(t) ? t : Object.keys(t);
}

// Entry readers and lint share this boundary; consumers never iterate malformed fields.
export function fieldShapeErrors(data) {
  const errors = [];
  const add = (field, shape) => errors.push(`${field} must be ${shape}`);
  const map = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  for (const field of ['domain', 'topics', 'related', 'sources', 'contributing_ids', 'contributing', 'attachments', 'verifications']) {
    if (data[field] === undefined || data[field] === '') continue;
    if (!Array.isArray(data[field])) { add(field, 'a list'); continue; }
    for (const [i, value] of data[field].entries()) {
      const at = `${field}[${i}]`;
      if (['related', 'sources', 'contributing_ids', 'contributing'].includes(field)) {
        if (typeof value !== 'string') add(at, 'a string');
      } else if (field === 'verifications' && !map(value)) add(at, 'a map');
    }
  }
  for (const field of ['source_id', 'prompt_id', 'superseded_by']) {
    const value = data[field];
    if (value === undefined || value === '') continue;
    if (typeof value !== 'string') add(field, 'a string');
  }
  if (data.subject !== undefined && data.subject !== '') {
    if (!map(data.subject)) add('subject', 'a map');
  }
  return errors;
}

export function assertFieldShapes(data) {
  const errors = fieldShapeErrors(data);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'FIELD_SHAPE' });
}

function check(schema, field, key, value) {
  const allow = allowedValues(schema, key);
  if (!allow.includes(value)) throw new Error(`unknown ${field}: ${value} (allowed: ${allow.join(', ')})`);
}

export function assertControlledValues(data, schema) {
  assertFieldShapes(data);
  for (const [field, key] of Object.entries(CONTROLLED_FIELDS)) {
    if (data[field] === undefined || data[field] === null || data[field] === '') continue;
    let vals;
    if (field === 'domain') {
      vals = data[field];
    } else {
      vals = [data[field]];
    }
    for (const v of vals) check(schema, field, key, v);
  }
  for (const v of (data.verifications || [])) {
    for (const [field, key] of Object.entries(VERIFICATION_CONTROLLED_FIELDS)) {
      if (v[field] === undefined || v[field] === null || v[field] === '') continue;
      check(schema, `verification ${field}`, key, v[field]);
    }
  }
}
