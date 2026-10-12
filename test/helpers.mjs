// Shared temp-vault builder for graph tests: hand-writes lint-shaped entries by id.
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeEntry, TYPE_FOLDER } from '../bin/lib/fsutil.mjs';
import { loadSchema, fieldOrder } from '../bin/lib/schema.mjs';

const schema = loadSchema(process.cwd());

export function tmpVault(prefix = 'rv-graph-') { return mkdtempSync(join(tmpdir(), prefix)); }

export function put(dir, type, id, extra = {}, body = `# ${id}\n`) {
  const folder = TYPE_FOLDER[type];
  const date = id.slice(0, 10);
  const data = {
    title: id, type, created: date, domain: ['software-engineering'],
    stage: schema.taxonomy.stage_by_folder[folder].default, topics: [], status: 'active',
    related: [], volatility: 'slow',
    verifications: [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }],
    ...extra,
  };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k]; // `x: undefined` drops a default
  mkdirSync(join(dir, folder), { recursive: true });
  writeEntry(join(dir, folder, `${id}.md`), data, body, fieldOrder(schema, type));
  return id;
}
