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

function allowed(schema, key) {
  const t = schema.taxonomy[key];
  return Array.isArray(t) ? t : Object.keys(t);
}

function check(schema, field, key, value) {
  const allow = allowed(schema, key);
  if (!allow.includes(value)) throw new Error(`unknown ${field}: ${value} (allowed: ${allow.join(', ')})`);
}

export function assertControlledValues(data, schema) {
  for (const [field, key] of Object.entries(CONTROLLED_FIELDS)) {
    if (data[field] === undefined || data[field] === null || data[field] === '') continue;
    let vals;
    if (field === 'domain') {
      // Shape before values: a bare scalar `domain: security` must fail once here, not get
      // iterated character-by-character into `unknown domain: s`, `e`, `c`, …
      if (!Array.isArray(data[field])) throw new Error('domain must be a list');
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
