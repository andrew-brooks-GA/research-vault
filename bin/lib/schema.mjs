import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export function loadSchema(repoRoot) {
  const taxonomy = JSON.parse(readFileSync(join(repoRoot, 'schema', 'taxonomy.json'), 'utf8'));
  const fields = JSON.parse(readFileSync(join(repoRoot, 'schema', 'frontmatter.schema.json'), 'utf8'));
  return { taxonomy, fields };
}

export function stageAllowedInFolder(schema, folder, stage) {
  const e = schema.taxonomy.stage_by_folder[folder];
  return !!e && e.allowed.includes(stage);
}

export function fieldOrder(schema, type) {
  return [...schema.fields.common, ...(schema.fields.by_type[type] || [])];
}
