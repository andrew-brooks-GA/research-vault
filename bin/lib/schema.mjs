import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EXTENSIBLE_TAXONOMY_FIELDS, readTaxonomyExtensions } from './projectconfig.mjs';

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
    merged[field] = [...new Set([...(taxonomy[field] || []), ...extra])];
  }
  return merged;
}

// loadSchema(repoRoot) returns the bundled schema unchanged. Pass `{ vaultPath }` to merge
// the bound vault's `.research-vault.json` taxonomy_extensions (discovered by walking up
// from the vault), or `{ extensions }` to inject them directly (tests). `{ hooks }` injects
// fs for the extension lookup. Discovery is keyed on the vault, not cwd, so a vault's
// vocabulary is the same wherever a command runs from.
export function loadSchema(repoRoot, opts = {}) {
  let taxonomy = JSON.parse(readFileSync(join(repoRoot, 'schema', 'taxonomy.json'), 'utf8'));
  const fields = JSON.parse(readFileSync(join(repoRoot, 'schema', 'frontmatter.schema.json'), 'utf8'));
  let extensions = opts.extensions;
  if (!extensions && opts.vaultPath) extensions = readTaxonomyExtensions(opts.vaultPath, opts.hooks ?? {});
  taxonomy = applyTaxonomyExtensions(taxonomy, extensions);
  return { taxonomy, fields };
}

export function stageAllowedInFolder(schema, folder, stage) {
  const e = schema.taxonomy.stage_by_folder[folder];
  return !!e && e.allowed.includes(stage);
}

export function fieldOrder(schema, type) {
  return [...schema.fields.common, ...(schema.fields.by_type[type] || [])];
}
