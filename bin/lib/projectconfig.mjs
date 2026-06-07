// Per-repo binding file (the .editorconfig/.nvmrc pattern): a `.research-vault.json`
// discovered by walking up from the working directory binds a repo to a vault and
// supplies capture defaults. The plugin ships the mechanism; every repo-specific value
// lives in the file, never here. Validated against the single schema/taxonomy.json.
import { existsSync as realExists, readFileSync as realRead, writeFileSync as realWrite } from 'node:fs';
import { dirname, join } from 'node:path';

export const PROJECT_CONFIG_FILENAME = '.research-vault.json';

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

// Parse + validate raw JSON against the taxonomy. Throws on malformed JSON or bad values.
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
  const capture = data.capture ?? {};
  if (capture.enabled !== undefined && typeof capture.enabled !== 'boolean') {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: capture.enabled must be a boolean`);
  }
  return { vault: data.vault, defaults, references, capture };
}

// Convenience: find + parse + validate. Returns { path, config } or null.
export function loadProjectConfig(startDir, opts = {}) {
  const hit = findProjectConfig(startDir, opts);
  if (!hit) return null;
  return { path: hit.path, config: parseProjectConfig(hit.raw, opts.schema) };
}

// Write a starter .research-vault.json binding `dir` to a vault. Refuses to clobber
// an existing binding (mirrors init's non-clobber discipline). Returns the file path.
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
  write(target, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return target;
}
