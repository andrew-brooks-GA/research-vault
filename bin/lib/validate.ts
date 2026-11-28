type TaxonomySchema = {
  taxonomy: Record<string, readonly unknown[] | object | null | undefined>;
};

type Fields = Record<string, unknown>;

type ShapedFields = Fields & {
  domain?: readonly unknown[] | '' | undefined;
  topics?: readonly unknown[] | '' | undefined;
  related?: readonly string[] | '' | undefined;
  sources?: readonly string[] | '' | undefined;
  contributing_ids?: readonly string[] | '' | undefined;
  contributing?: readonly string[] | '' | undefined;
  attachments?: readonly unknown[] | '' | undefined;
  verifications?: readonly Fields[] | '' | undefined;
  source_id?: string | undefined;
  prompt_id?: string | undefined;
  superseded_by?: string | undefined;
  subject?: object | '' | undefined;
};

// Single source of truth for which frontmatter fields are controlled by which taxonomy
// enum. Both the fail-fast mutators (assertControlledValues) and the detective floor
// (lint) derive their enum coverage from this map so the two cannot silently diverge.
export const CONTROLLED_FIELDS: Record<'domain' | 'volatility' | 'status' | 'confidence' | 'outcome' | 'state' | 'synthesis_basis' | 'authority_tier' | 'authority_basis', string> = {
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

export const VERIFICATION_CONTROLLED_FIELDS: Record<'method' | 'result' | 'by_type', string> = {
  method: 'verification_method',
  result: 'verification_result',
  by_type: 'by_type',
};

export function allowedValues(schema: TaxonomySchema, key: string): readonly unknown[] {
  const t = schema.taxonomy[key];
  if (t === undefined || t === null) throw new Error(`allowedValues: no taxonomy list named ${key}`);
  return Array.isArray(t) ? t : Object.keys(t);
}

export function isAllowedValue(schema: TaxonomySchema, key: string, value: unknown): boolean {
  return allowedValues(schema, key).includes(value);
}

// Entry readers and lint share this boundary; consumers never iterate malformed fields.
export function fieldShapeErrors(data: Fields): string[] {
  const errors: string[] = [];
  const add = (field: string, shape: string) => errors.push(`${field} must be ${shape}`);
  const map = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value);
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

export function assertFieldShapes(data: Fields): asserts data is ShapedFields {
  const errors = fieldShapeErrors(data);
  if (errors.length) throw Object.assign(new Error(errors.join('; ')), { code: 'FIELD_SHAPE' });
}

function check(schema: TaxonomySchema, field: string, key: string, value: unknown) {
  if (!isAllowedValue(schema, key, value)) {
    const allow = allowedValues(schema, key);
    throw new Error(`unknown ${field}: ${value} (allowed: ${allow.join(', ')})`);
  }
}

export function assertControlledValues(data: Fields, schema: TaxonomySchema): void {
  assertFieldShapes(data);
  for (const [field, key] of Object.entries(CONTROLLED_FIELDS)) {
    if (data[field] === undefined || data[field] === null || data[field] === '') continue;
    let vals: readonly unknown[];
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
