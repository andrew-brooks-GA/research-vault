// Per-repo binding file (the .editorconfig/.nvmrc pattern): a `.research-vault.json`
// discovered by walking up from the working directory binds a repo to a vault and
// supplies capture defaults. The plugin ships the mechanism; every repo-specific value
// lives in the file, never here. Validated against the single schema/taxonomy.json.
import { existsSync as realExists, readFileSync as realRead, writeFileSync as realWrite } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

export const PROJECT_CONFIG_FILENAME = '.research-vault.json';

// Controlled vocabularies a vault may extend additively via `taxonomy_extensions`.
// These are the flat list-valued enums; map-valued taxonomy (volatility, stage_by_folder,
// topic_aliases) and the open `topics:` tag space are deliberately excluded. Extension is
// additive only: a vault can add values, never remove or redefine the built-ins, so a
// built-in value means the same thing in every vault and entries stay portable.
export const EXTENSIBLE_TAXONOMY_FIELDS = [
  'domain',
  'confidence',
  'outcome',
  'question_state',
  'verification_method',
  'verification_result',
];

// Walk up from startDir; the nearest .research-vault.json wins. Returns { path, raw } or null.
export function findProjectConfig(startDir, hooks = {}) {
  const exists = hooks.existsSync ?? realExists;
  const read = hooks.readFileSync ?? realRead;
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, PROJECT_CONFIG_FILENAME);
    if (exists(candidate)) return { path: candidate, raw: read(candidate, 'utf8') };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function assertEnum(value, field, allowed) {
  if (!allowed.includes(value)) {
    throw new Error(`unknown ${field}: ${value} (allowed: ${allowed.join(', ')})`);
  }
}

// Validate + normalize a `taxonomy_extensions` block. Schema-free on purpose: this runs
// while the schema is still being assembled (loadSchema reads extensions before merging),
// so it only enforces shape — an object whose keys are extensible fields and whose values
// are arrays of non-empty strings. Returns a clean map (possibly empty); throws on misuse.
export function validateTaxonomyExtensions(ext) {
  if (ext === undefined) return {};
  if (ext === null || typeof ext !== 'object' || Array.isArray(ext)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions must be an object`);
  }
  const out = {};
  for (const [field, values] of Object.entries(ext)) {
    if (!EXTENSIBLE_TAXONOMY_FIELDS.includes(field)) {
      throw new Error(
        `invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.${field} is not extensible (allowed: ${EXTENSIBLE_TAXONOMY_FIELDS.join(', ')})`,
      );
    }
    if (!Array.isArray(values)) {
      throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.${field} must be an array of strings`);
    }
    for (const v of values) {
      if (typeof v !== 'string' || v.length === 0) {
        throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.${field} entries must be non-empty strings`);
      }
    }
    out[field] = [...values];
  }
  return out;
}

// The one compiler for every regex the binding carries (`code.versions.*.pattern`,
// `code.languages.*.comment`, `code.languages.*.decl`): the source must compile and hold at least
// `groups` capture groups; the error names the field. Returns the RegExp.
export function compilePattern(field, source, { groups = 1, flags = '' } = {}) {
  if (typeof source !== 'string') throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field} must be a string`);
  let re;
  try { re = new RegExp(source, flags); } catch (e) { throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field}: ${e.message}`); }
  // `(?:source)|` matches the empty string with one slot per capture group.
  if (new RegExp(`(?:${source})|`).exec('').length - 1 < groups) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field}: pattern has no capture group`);
  }
  return re;
}

// Validate the `code` block (spec 15). It needs a project-specific vault inside the repo: a
// relative `vault` with no `..` segment. Returns { globs, languages, versions } with every pattern
// compiled; throws on misuse.
function validateCode(code, vault) {
  const bad = (msg) => new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${msg}`);
  if (code === null || typeof code !== 'object' || Array.isArray(code)) throw bad('code must be an object');
  if (typeof vault !== 'string' || !vault || isAbsolute(vault) || vault.split(/[\\/]/).includes('..')) {
    throw bad(`code links need a project-specific vault inside the repo (a relative vault path); this binding points at ${vault || '(none)'}`);
  }
  const globs = code.globs ?? [];
  if (!Array.isArray(globs) || !globs.every((g) => typeof g === 'string')) throw bad('code.globs must be an array of strings');
  const table = (name) => {
    const t = code[name] ?? {};
    if (t === null || typeof t !== 'object' || Array.isArray(t)) throw bad(`code.${name} must be an object`);
    return t;
  };
  const languages = {};
  for (const [ext, row] of Object.entries(table('languages'))) {
    if (row === null || typeof row !== 'object') throw bad(`code.languages[${JSON.stringify(ext)}] must be { comment, decl }`);
    languages[ext] = {
      comment: compilePattern(`code.languages[${JSON.stringify(ext)}].comment`, row.comment),
      decl: compilePattern(`code.languages[${JSON.stringify(ext)}].decl`, row.decl),
    };
  }
  const versions = {};
  for (const [key, row] of Object.entries(table('versions'))) {
    if (row === null || typeof row !== 'object' || typeof row.file !== 'string') throw bad(`code.versions.${key} must be { file, pattern }`);
    versions[key] = { file: row.file, pattern: compilePattern(`code.versions.${key}.pattern`, row.pattern, { flags: 'm' }) };
  }
  return { globs, languages, versions };
}

// Parse + validate raw JSON against the taxonomy. Throws on malformed JSON or bad values.
// The returned object carries `code` only when the block is present; every consumer tests it.
export function parseProjectConfig(raw, schema) {
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${e.message}`);
  }
  if (data.vault !== undefined && typeof data.vault !== 'string') {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: vault must be a string`);
  }
  const defaults = data.defaults ?? {};
  if (defaults.domain !== undefined) {
    assertEnum(defaults.domain, 'defaults.domain', schema.taxonomy.domain);
  }
  if (defaults.volatility !== undefined) {
    assertEnum(defaults.volatility, 'defaults.volatility', Object.keys(schema.taxonomy.volatility));
  }
  if (defaults.topics !== undefined && !Array.isArray(defaults.topics)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: defaults.topics must be an array`);
  }
  const references = data.references ?? {};
  if (references.globs !== undefined && !Array.isArray(references.globs)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: references.globs must be an array`);
  }
  const gates = data.gates ?? {};
  if (gates.globs !== undefined && !Array.isArray(gates.globs)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: gates.globs must be an array`);
  }
  const capture = data.capture ?? {};
  if (capture.enabled !== undefined && typeof capture.enabled !== 'boolean') {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: capture.enabled must be a boolean`);
  }
  const taxonomyExtensions = validateTaxonomyExtensions(data.taxonomy_extensions);
  const out = { vault: data.vault, defaults, references, gates, capture, taxonomyExtensions };
  if (data.code !== undefined) out.code = validateCode(data.code, data.vault);
  return out;
}

// Schema-free read of just the `taxonomy_extensions` block for the nearest config above
// startDir. Used by loadSchema to merge a vault's additions before the schema exists, so
// it cannot depend on a parsed schema. Returns {} when there is no config or no extensions.
export function readTaxonomyExtensions(startDir, hooks = {}) {
  const hit = findProjectConfig(resolve(startDir), hooks);
  if (!hit) return {};
  let data;
  try { data = JSON.parse(hit.raw); } catch (e) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${e.message}`);
  }
  return validateTaxonomyExtensions(data.taxonomy_extensions);
}

// Convenience: find + parse + validate. Returns { path, config } or null.
export function loadProjectConfig(startDir, opts = {}) {
  const hit = findProjectConfig(startDir, opts);
  if (!hit) return null;
  return { path: hit.path, config: parseProjectConfig(hit.raw, opts.schema) };
}

// Write a starter .research-vault.json binding `dir` to a vault. Refuses to clobber
// an existing binding (mirrors init's non-clobber discipline). `codeLinks` globs add the `code`
// block; the body goes through parseProjectConfig first, so its rules live in one place. Returns the file path.
export function scaffoldProjectConfig(dir, opts = {}, hooks = {}) {
  const exists = hooks.existsSync ?? realExists;
  const write = hooks.writeFileSync ?? realWrite;
  const target = join(dir, PROJECT_CONFIG_FILENAME);
  if (exists(target)) throw new Error(`${PROJECT_CONFIG_FILENAME} already exists at ${target}`);
  const body = {
    vault: opts.vault,
    defaults: { domain: opts.domain, topics: opts.topics ?? [], volatility: opts.volatility ?? 'fast' },
    references: { globs: opts.globs ?? [] },
    capture: { enabled: true },
  };
  if (opts.codeLinks?.length) body.code = { globs: opts.codeLinks, languages: {}, versions: {} };
  parseProjectConfig(JSON.stringify(body), opts.schema);
  write(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return target;
}
