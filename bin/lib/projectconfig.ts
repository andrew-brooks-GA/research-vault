// Per-repo binding file (the .editorconfig/.nvmrc pattern): a `.research-vault.json`
// discovered by walking up from the working directory binds a repo to a vault and
// supplies capture defaults. The plugin ships the mechanism; every repo-specific value
// lives in the file, never here. Validated against the single schema/taxonomy.json.
import { existsSync as realExists, lstatSync as realLstat, readFileSync as realRead, writeFileSync as realWrite } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { isInsideVault } from './containment.ts';
import { errorCode, isRecord, parseJson } from './unknowns.ts';

type ReadHooks = {
  existsSync?: (path: string) => boolean;
  readFileSync?: (path: string, encoding: 'utf8') => string;
  workspaceDir?: string | null | undefined;
};
type WriteHooks = {
  lstatSync?: (path: string, options: { throwIfNoEntry: false }) => unknown;
  writeFileSync?: (path: string, data: string, options: { encoding: 'utf8'; flag: 'wx' }) => void;
};
type ConfigSchema = { taxonomy: { domain: readonly string[]; volatility: object } };
type ScaffoldOptions = {
  vault?: string;
  domain?: string | undefined;
  topics?: readonly string[];
  volatility?: string | undefined;
  globs?: readonly string[];
  codeLinks?: readonly string[];
  schema: ConfigSchema;
};
type ScaffoldBinding = {
  vault: string | undefined;
  defaults: { domain: string | undefined; topics: readonly string[]; volatility: string };
  references: { globs: readonly string[] };
  capture: { enabled: boolean };
  code?: { globs: readonly string[]; languages: Record<string, never>; versions: Record<string, never> };
};
type TaxonomyExtensions = Record<string, string[] | Record<string, unknown>>;
type CodeLanguage = { comment: RegExp; decl: RegExp };
type CodeVersion = { file: string; pattern: RegExp };
type CodeConfig = { globs: string[]; languages: Record<string, CodeLanguage>; versions: Record<string, CodeVersion> };
type NonEmptyString = string & { readonly 0: string };
type LabConfig = { docs: string[]; [field: string]: string[] };
type ProjectConfig = {
  vault: string | undefined;
  defaults: Record<string, unknown>;
  references: Record<string, unknown>;
  gates: Record<string, unknown>;
  capture: Record<string, unknown>;
  usage: Record<string, unknown>;
  taxonomyExtensions: TaxonomyExtensions;
  embedding?: ReturnType<typeof validateEmbedding>;
  code?: CodeConfig;
  lab?: LabConfig;
};

export const PROJECT_CONFIG_FILENAME: '.research-vault.json' = '.research-vault.json';

// Controlled vocabularies a vault may extend additively via `taxonomy_extensions`.
// These are the flat list-valued enums; map-valued taxonomy (volatility, stage_by_folder) and
// the open `topics:` tag space are deliberately excluded. `topic_aliases` is the one map-valued
// extension (spec 24): a vault adds pairs, validated below and merged in schema.mjs. Extension is
// additive only: a vault can add values, never remove or redefine the built-ins, so a
// built-in value means the same thing in every vault and entries stay portable.
export const EXTENSIBLE_TAXONOMY_FIELDS: string[] = [
  'domain',
  'confidence',
  'outcome',
  'question_state',
  'verification_method',
  'verification_result',
];

// Walk up from startDir; the nearest .research-vault.json wins. Returns { path, raw } or null.
export function findProjectConfig(startDir: string, hooks: ReadHooks = {}): { path: string; raw: string } | null {
  const exists = hooks.existsSync ?? realExists;
  const read = hooks.readFileSync ?? realRead;
  const ws = hooks.workspaceDir;
  let dir = startDir;
  for (;;) {
    const candidate = join(dir, PROJECT_CONFIG_FILENAME);
    // Configs inherited from above the workspace are still discovered normally.
    const inside = !ws || !isInsideVault(ws, candidate, undefined, null) || isInsideVault(ws, candidate);
    if (inside && exists(candidate)) return { path: candidate, raw: read(candidate, 'utf8') };
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

function assertEnum(value: string, field: string, allowed: readonly string[]): void {
  if (!allowed.includes(value)) {
    throw new Error(`unknown ${field}: ${value} (allowed: ${allowed.join(', ')})`);
  }
}

// Validate + normalize a `taxonomy_extensions` block. Schema-free on purpose: this runs
// while the schema is still being assembled (loadSchema reads extensions before merging),
// so it only enforces shape — an object whose keys are extensible fields and whose values
// are arrays of non-empty strings. Returns a clean map (possibly empty); throws on misuse.
export function validateTaxonomyExtensions(ext: unknown): TaxonomyExtensions {
  if (ext === undefined) return {};
  if (!isRecord(ext)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions must be an object`);
  }
  const out: TaxonomyExtensions = {};
  for (const [field, values] of Object.entries(ext)) {
    if (field === 'topic_aliases') {
      const ok = isRecord(values)
        && Object.entries(values).every(([k, v]: [string, unknown]) => k.length > 0 && typeof v === 'string' && v.length > 0);
      if (!ok) throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.topic_aliases must be an object of non-empty strings`);
      out[field] = { ...values };
      continue;
    }
    if (!EXTENSIBLE_TAXONOMY_FIELDS.includes(field)) {
      throw new Error(
        `invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.${field} is not extensible (allowed: ${EXTENSIBLE_TAXONOMY_FIELDS.join(', ')})`,
      );
    }
    if (!Array.isArray(values)) {
      throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.${field} must be an array of strings`);
    }
    const strings: string[] = [];
    for (const v of values) {
      if (typeof v !== 'string' || v.length === 0) {
        throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: taxonomy_extensions.${field} entries must be non-empty strings`);
      }
      strings.push(v);
    }
    out[field] = strings;
  }
  return out;
}

// The one compiler for every regex the binding carries (`code.versions.*.pattern`,
// `code.languages.*.comment`, `code.languages.*.decl`): the source must compile and hold at least
// `groups` capture groups; the error names the field. Returns the RegExp.
export function compilePattern(field: string, source: unknown, { groups = 1, flags = '' }: { groups?: number; flags?: string } = {}): RegExp {
  if (typeof source !== 'string') throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field} must be a string`);
  let re;
  try { re = new RegExp(source, flags); } catch (e) {
    if (!(e instanceof Error)) throw e;
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field}: ${e.message}`);
  }
  // `(?:source)|` matches the empty string with one slot per capture group.
  const match = new RegExp(`(?:${source})|`).exec('');
  if (!match) throw new Error('compilePattern: expected the empty alternative to match');
  if (match.length - 1 < groups) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field}: pattern has no capture group`);
  }
  return re;
}

// A non-empty path relative to the binding file with no `..` segment.
export const isRelativeInside = (p: unknown): boolean => typeof p === 'string' && p.length > 0 && !isAbsolute(p)
  && !/^[a-z]:/i.test(p) && !p.split(/[\\/]/).includes('..');

// Issue 60: the optional `lab` block `{ docs, uses, bypass }`: `docs` are files explaining the repo's lab
// (relative to the binding, no `..`), `uses` strings that show a script stands on the lab, `bypass` strings
// that show it stands up an environment by hand. All literal strings.
function validateLab(lab: unknown): LabConfig {
  const bad = (msg: string) => new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${msg}`);
  if (!isRecord(lab)) throw bad('lab must be an object');
  const out: LabConfig = { docs: [] };
  for (const f of ['docs', 'uses', 'bypass']) {
    const values = lab[f];
    if (!Array.isArray(values) || !values.length || !values.every((v: unknown): v is NonEmptyString => typeof v === 'string' && v.length > 0)) throw bad(`lab.${f} must be a non-empty array of non-empty strings`);
    out[f] = [...values];
  }
  if (!out.docs.every(isRelativeInside)) throw bad('lab.docs entries must be relative paths with no .. segment');
  return out;
}

// Validate the `code` block (spec 15). It needs a project-specific vault inside the repo: a
// relative `vault` with no `..` segment. Returns { globs, languages, versions } with every pattern
// compiled; throws on misuse.
function validateCode(code: unknown, vault: string | undefined): CodeConfig {
  const bad = (msg: string) => new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${msg}`);
  if (!isRecord(code)) throw bad('code must be an object');
  if (typeof vault !== 'string' || !vault || !isRelativeInside(vault)) {
    throw bad(`code links need a project-specific vault inside the repo (a relative vault path); this binding points at ${vault || '(none)'}`);
  }
  const globs = code.globs ?? [];
  if (!Array.isArray(globs) || !globs.every((g: unknown): g is string => typeof g === 'string')) throw bad('code.globs must be an array of strings');
  const table = (name: 'languages' | 'versions') => {
    const t = code[name] ?? {};
    if (!isRecord(t)) throw bad(`code.${name} must be an object`);
    return t;
  };
  // A key of the binding is a row name; `__proto__` would set the prototype and drop the row (S-13).
  const rows = (name: 'languages' | 'versions') => Object.entries(table(name)).map(([key, row]: [string, unknown]): [string, unknown] => {
    if (key === '__proto__') throw bad(`code.${name} cannot have the key "__proto__"`);
    return [key, row];
  });
  const languages = Object.fromEntries(rows('languages').map(([ext, row]: [string, unknown]): [string, CodeLanguage] => {
    if (row === null || typeof row !== 'object') throw bad(`code.languages[${JSON.stringify(ext)}] must be { comment, decl }`);
    return [ext, {
      comment: compilePattern(`code.languages[${JSON.stringify(ext)}].comment`, 'comment' in row ? row.comment : undefined),
      decl: compilePattern(`code.languages[${JSON.stringify(ext)}].decl`, 'decl' in row ? row.decl : undefined),
    }];
  }));
  const versions = Object.fromEntries(rows('versions').map(([key, row]: [string, unknown]): [string, CodeVersion] => {
    if (row === null || typeof row !== 'object' || !('file' in row) || typeof row.file !== 'string') throw bad(`code.versions.${key} must be { file, pattern }`);
    if (!isRelativeInside(row.file)) throw bad(`code.versions.${key}.file must be a relative path inside the repository with no .. segment`);
    return [key, { file: row.file, pattern: compilePattern(`code.versions.${key}.pattern`, 'pattern' in row ? row.pattern : undefined, { flags: 'm' }) }];
  }));
  return { globs, languages, versions };
}

// Parse + validate raw JSON against the taxonomy. Throws on malformed JSON or bad values.
// The returned object carries `code` only when the block is present; every consumer tests it.
// Spec 34: the embedding endpoint block `{ url, model?, chunk?, overlap? }`.
function validateEmbedding(e: unknown) {
  const bad = (m: string) => new Error(`invalid ${PROJECT_CONFIG_FILENAME}: embedding.${m}`);
  if (!isRecord(e)) throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: embedding must be an object`);
  let u; try { if (typeof e.url === 'string') u = new URL(e.url); } catch { /* reported below */ }
  if (typeof e.url !== 'string' || !u || !['http:', 'https:'].includes(u.protocol)) throw bad('url must be an http or https URL');
  if (e.model !== undefined && typeof e.model !== 'string') throw bad('model must be a string');
  const integer = (k: 'chunk' | 'overlap', fallback: number) => {
    const value = e[k];
    if (value === undefined) return fallback;
    if (typeof value !== 'number' || !Number.isInteger(value)) throw bad(`${k} must be an integer`);
    return value;
  };
  const chunk = integer('chunk', 800), overlap = integer('overlap', 100);
  if (chunk < 1 || overlap < 0 || overlap >= chunk) throw bad('chunk must be at least 1 and overlap at least 0 and below chunk');
  return { url: e.url, model: e.model, chunk, overlap };
}

function parseBinding(raw: string) {
  let data;
  try {
    data = parseJson(raw);
  } catch (e) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!isRecord(data)) throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: must be a JSON object`);
  return data;
}

function objectSection(value: unknown, name: string) {
  const section = value ?? {};
  if (!isRecord(section)) throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${name} must be an object`);
  return section;
}

function isStringArray(value: unknown) {
  return Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');
}

function assertDefaultEnum(value: unknown, field: string, allowed: readonly string[]): void {
  if (typeof value !== 'string') throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${field} must be a string`);
  try {
    assertEnum(value, field, allowed);
  } catch (e) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function parseProjectConfig(raw: string, schema: ConfigSchema): ProjectConfig {
  const data = parseBinding(raw);
  if (data.vault !== undefined && typeof data.vault !== 'string') {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: vault must be a string`);
  }
  const defaults = objectSection(data.defaults, 'defaults');
  if (defaults.domain !== undefined) {
    assertDefaultEnum(defaults.domain, 'defaults.domain', schema.taxonomy.domain);
  }
  if (defaults.volatility !== undefined) {
    assertDefaultEnum(defaults.volatility, 'defaults.volatility', Object.keys(schema.taxonomy.volatility));
  }
  if (defaults.topics !== undefined && !isStringArray(defaults.topics)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: defaults.topics must be an array of strings`);
  }
  const references = objectSection(data.references, 'references');
  if (references.globs !== undefined && !isStringArray(references.globs)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: references.globs must be an array of strings`);
  }
  const gates = objectSection(data.gates, 'gates');
  if (gates.globs !== undefined && !isStringArray(gates.globs)) {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: gates.globs must be an array of strings`);
  }
  const capture = objectSection(data.capture, 'capture');
  if (capture.enabled !== undefined && typeof capture.enabled !== 'boolean') {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: capture.enabled must be a boolean`);
  }
  const usage = objectSection(data.usage, 'usage');
  if (usage.text !== undefined && typeof usage.text !== 'boolean') {
    throw new Error(`invalid ${PROJECT_CONFIG_FILENAME}: usage.text must be a boolean`);
  }
  const taxonomyExtensions = validateTaxonomyExtensions(data.taxonomy_extensions);
  const out: ProjectConfig = { vault: data.vault, defaults, references, gates, capture, usage, taxonomyExtensions };
  if (data.embedding !== undefined) out.embedding = validateEmbedding(data.embedding);
  if (data.code !== undefined) out.code = validateCode(data.code, data.vault);
  if (data.lab !== undefined) out.lab = validateLab(data.lab);
  return out;
}

// Schema-free read of just the `taxonomy_extensions` block for the nearest config above
// startDir. Used by loadSchema to merge a vault's additions before the schema exists, so
// it cannot depend on a parsed schema. Returns {} when there is no config or no extensions.
export function readTaxonomyExtensions(startDir: string, hooks: ReadHooks = {}): TaxonomyExtensions {
  const hit = findProjectConfig(resolve(startDir), hooks);
  if (!hit) return {};
  const data = parseBinding(hit.raw);
  return validateTaxonomyExtensions(data.taxonomy_extensions);
}

// Convenience: find + parse + validate. Returns { path, config } or null.
export function loadProjectConfig(startDir: string, opts: ReadHooks & { schema: ConfigSchema }): { path: string; config: ProjectConfig } | null {
  const hit = findProjectConfig(startDir, opts);
  if (!hit) return null;
  return { path: hit.path, config: parseProjectConfig(hit.raw, opts?.schema) };
}

// A glob that kept its shell quotes (cmd.exe passes '...' through) matches nothing. Returns the
// refusal for the first such glob, or null; check and init --project print it and exit 2.
export function quotedGlob(globs: readonly string[]): string | null {
  const g = globs.find((x: string) => /^['"]|['"]$/.test(x));
  return g === undefined ? null : `${g} looks quoted; remove the quotes`;
}

// Write a starter .research-vault.json binding `dir` to a vault. Refuses to clobber
// an existing binding (mirrors init's non-clobber discipline). `codeLinks` globs add the `code`
// block; the body goes through parseProjectConfig first, so its rules live in one place. Returns the file path.
export function scaffoldProjectConfig(dir: string, opts: ScaffoldOptions, hooks: WriteHooks = {}): string {
  const lstat = hooks.lstatSync ?? realLstat;
  const write = hooks.writeFileSync ?? realWrite;
  const target = join(dir, PROJECT_CONFIG_FILENAME);
  const alreadyExists = `${PROJECT_CONFIG_FILENAME} already exists at ${target}`;
  if (lstat(target, { throwIfNoEntry: false })) throw new Error(alreadyExists);
  const body: ScaffoldBinding = {
    vault: opts.vault,
    defaults: { domain: opts.domain, topics: opts.topics ?? [], volatility: opts.volatility ?? 'fast' },
    references: { globs: opts.globs ?? [] },
    capture: { enabled: true },
  };
  if (opts.codeLinks?.length) body.code = { globs: opts.codeLinks, languages: {}, versions: {} };
  parseProjectConfig(JSON.stringify(body), opts.schema);
  try {
    write(target, JSON.stringify(body, null, 2) + '\n', { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    if (errorCode(e) === 'EEXIST') throw new Error(alreadyExists);
    throw e;
  }
  return target;
}
