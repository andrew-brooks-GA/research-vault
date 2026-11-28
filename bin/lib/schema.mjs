import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ENTRY_FOLDERS } from './fsutil.ts';
import { EXTENSIBLE_TAXONOMY_FIELDS, PROJECT_CONFIG_FILENAME, readTaxonomyExtensions } from './projectconfig.ts';
import { isRecord, parseJson } from './unknowns.ts';

function wrongShape(file, field, shape) {
  throw new Error(field ? `${file}: ${field} must be ${shape}` : `${file}: expected ${shape}`);
}

function isArray(value) {
  return Array.isArray(value);
}

function checkLists(value, file, fields, prefix = '') {
  for (const field of fields) {
    const list = value[field];
    if (!isArray(list) || !list.every(item => typeof item === 'string')) {
      wrongShape(file, prefix + field, 'an array of strings');
    }
  }
}

function checkStringMap(value, file, field) {
  if (!isRecord(value)) return wrongShape(file, field, 'an object');
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== 'string') wrongShape(file, `${field}.${key}`, 'a string');
  }
}

function isTaxonomy(value, file) {
  if (!isRecord(value)) return wrongShape(file, '', 'an object');
  checkLists(value, file, [
    'domain', 'artifact_type', 'stage', 'status', 'confidence', 'outcome', 'verification_method',
    'verification_result', 'by_type', 'question_state', 'synthesis_basis', 'authority_tier',
    'authority_basis', 'durable_source_types',
  ]);
  checkStringMap(value.artifact_purpose, file, 'artifact_purpose');
  checkStringMap(value.topic_aliases, file, 'topic_aliases');
  if (!isRecord(value.volatility)) return wrongShape(file, 'volatility', 'an object');
  for (const [key, entry] of Object.entries(value.volatility)) {
    const field = `volatility.${key}`;
    if (!isRecord(entry)) return wrongShape(file, field, 'an object');
    if (typeof entry.refresh_after_days !== 'number') wrongShape(file, `${field}.refresh_after_days`, 'a number');
    if (typeof entry.description !== 'string') wrongShape(file, `${field}.description`, 'a string');
  }
  const stages = value.stage_by_folder;
  if (!isRecord(stages)) return wrongShape(file, 'stage_by_folder', 'an object');
  // Capture reads the default for each entry folder directly.
  for (const key of new Set([...Object.keys(stages), ...ENTRY_FOLDERS])) {
    const entry = stages[key];
    const field = `stage_by_folder.${key}`;
    if (!isRecord(entry)) return wrongShape(file, field, 'an object');
    checkLists(entry, file, ['allowed'], `${field}.`);
    if (typeof entry.default !== 'string') wrongShape(file, `${field}.default`, 'a string');
  }
  return true;
}

function checkEntryFields(value, file) {
  if (!isRecord(value)) return wrongShape(file, '', 'an object');
  checkLists(value, file, ['common', 'derived_forbidden']);
  for (const field of ['by_type', 'required_by_type']) {
    const map = value[field];
    if (!isRecord(map)) return wrongShape(file, field, 'an object');
    checkLists(map, file, Object.keys(map), `${field}.`);
  }
}

function checkEdgeFields(value, file) {
  if (!isRecord(value)) return wrongShape(file, 'edge_fields', 'an object');
  checkLists(value, file, ['backlink', 'reference_only'], 'edge_fields.');
}

function isFrontmatterFields(value, file) {
  checkEntryFields(value, file);
  checkLists(value, file, ['verification_subfields']);
  checkEdgeFields(value.edge_fields, file);
  checkStringMap(value.edge_fields.intended_targets, file, 'edge_fields.intended_targets');
  return true;
}

function isTeachFields(value, file) {
  checkEntryFields(value, file);
  checkEdgeFields(value.edge_fields, file);
  return true;
}

function isTeachTaxonomy(value, file) {
  if (!isRecord(value)) return wrongShape(file, '', 'an object');
  checkLists(value, file, ['status', 'kind', 'type']);
  checkStringMap(value.type_folder, file, 'type_folder');
  return true;
}

function readSchema(repoRoot, file, check) {
  const value = parseJson(readFileSync(join(repoRoot, file), 'utf8'));
  if (check(value, file)) return value;
  throw new Error('readSchema: expected the check to accept or throw');
}

// Additively merge a vault's `taxonomy_extensions` onto the bundled taxonomy. Only the
// extensible list fields are touched, values are appended (deduped, built-ins first), and
// the input taxonomy is not mutated. Unknown fields are ignored here; rejection of
// non-extensible fields happens upstream in projectconfig.validateTaxonomyExtensions.
export function applyTaxonomyExtensions(taxonomy, extensions) {
  if (!extensions || Object.keys(extensions).length === 0) return taxonomy;
  const merged = { ...taxonomy };
  for (const field of EXTENSIBLE_TAXONOMY_FIELDS) {
    const extra = extensions[field];
    if (!extra || extra.length === 0) continue;
    const builtIn = taxonomy[field] || [];
    if (!isArray(builtIn) || !isArray(extra)) {
      throw new Error('applyTaxonomyExtensions: expected lists for an extensible field');
    }
    merged[field] = [...new Set([...builtIn, ...extra])];
  }
  // Spec 24: vault alias pairs after the built-ins; a built-in key cannot be redefined. One hop only.
  const extraAliases = extensions.topic_aliases;
  if (extraAliases) {
    for (const k of Object.keys(extraAliases)) if (Object.hasOwn(taxonomy.topic_aliases || {}, k))
      throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.topic_aliases.${k} redefines a built-in alias`);
    const aliases = { ...taxonomy.topic_aliases };
    for (const key of Reflect.ownKeys(extraAliases)) {
      if (!Object.prototype.propertyIsEnumerable.call(extraAliases, key)) continue;
      const target = Reflect.get(extraAliases, key);
      if (typeof target !== 'string') throw new Error('applyTaxonomyExtensions: expected a string alias target');
      // Match spread: __proto__ is an own data property.
      Object.defineProperty(aliases, key, { value: target, enumerable: true, writable: true, configurable: true });
    }
    merged.topic_aliases = aliases;
  }
  return merged;
}

// loadSchema(repoRoot) returns the bundled schema unchanged. Pass `{ vaultPath }` to merge
// the bound vault's `.research-vault.json` taxonomy_extensions (discovered by walking up
// from the vault), or `{ extensions }` to inject them directly (tests). `{ hooks }` injects
// fs for the extension lookup. Discovery is keyed on the vault, not cwd, so a vault's
// vocabulary is the same wherever a command runs from.
export function loadSchema(repoRoot, opts = {}) {
  const taxonomy = readSchema(repoRoot, 'schema/taxonomy.json', isTaxonomy);
  const fields = readSchema(repoRoot, 'schema/frontmatter.schema.json', isFrontmatterFields);
  let extensions = opts.extensions;
  if (!extensions && opts.vaultPath) extensions = readTaxonomyExtensions(opts.vaultPath, opts.hooks ?? {});
  const merged = applyTaxonomyExtensions(taxonomy, extensions);
  if (merged === taxonomy) return { taxonomy, fields };
  if (isTaxonomy(merged, `${PROJECT_CONFIG_FILENAME} taxonomy_extensions`)) return { taxonomy: merged, fields };
  throw new Error('loadSchema: expected the check to accept or throw');
}

export function stageAllowedInFolder(schema, folder, stage) {
  const e = schema.taxonomy.stage_by_folder[folder];
  return !!e && e.allowed.includes(stage);
}

export function fieldOrder(schema, type) {
  // A type is a string from an entry: `constructor` is a type with no field list (S-13).
  const key = String(type);
  const fields = Object.hasOwn(schema.fields.by_type, key) ? schema.fields.by_type[key] : [];
  if (fields === undefined) throw new Error('fieldOrder: expected a field list for an own type');
  return [...schema.fields.common, ...fields];
}

// The research-teach workspace schema: field lists from teach.schema.json at the top level,
// controlled values under `taxonomy`. Separate from the vault schema; nothing here touches it.
export function loadTeachSchema(repoRoot) {
  const fields = readSchema(repoRoot, 'schema/teach.schema.json', isTeachFields);
  const taxonomy = readSchema(repoRoot, 'schema/teach-taxonomy.json', isTeachTaxonomy);
  return { ...fields, taxonomy };
}
