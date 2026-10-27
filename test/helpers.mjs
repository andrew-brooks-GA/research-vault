// Shared temp-vault builder for graph tests: hand-writes lint-shaped entries by id.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
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

const ver = (date) => [{ date, by_type: 'human', by_id: '', method: 'human-spot-check', result: 'confirmed', notes: '' }];
const LONG = 'The fixture function reads an integer and prints a value. '.repeat(5);

// Claims-gate fixture vault: the ids the gate fixtures
// cite, a snippet for `gate evidence --extra`, and one stale note. Returns the temp path.
export function fixtureVault(dir = tmpVault('rv-gate-vault-')) {
  put(dir, 'source', '2026-01-01-fx-doc', { source_type: 'article', source_url: 'https://example.org/fx' },
    `# 2026-01-01-fx-doc\n\n${LONG}\n`);
  put(dir, 'source', '2026-01-01-fx-doc-nobody', { source_type: 'article', source_url: 'https://example.org/nobody' });
  put(dir, 'snippet', '2026-01-01-fx-snippet', { language: 'js', tested: true, source_id: '2026-01-01-fx-doc' },
    '# 2026-01-01-fx-snippet\n\n```js\nexport function fx(n) { return n * 6; }\n```\n');
  put(dir, 'experiment', '2026-01-01-fx-experiment',
    { provider: 'local', model_id: 'none', date_run: '2026-01-01', task: 'run fx with input 7', outcome: 'success' },
    `# 2026-01-01-fx-experiment\n\nRan it with 7; it printed 42.\n`);
  put(dir, 'note', '2026-01-01-old', { sources: [], confidence: 'medium', volatility: 'fast', verifications: ver('2020-01-01') },
    `# 2026-01-01-old\n\n${LONG}\n`);
  put(dir, 'source', '2026-01-01-fx-gone', { source_type: 'article', source_url: 'https://example.org/gone', status: 'superseded', superseded_by: '2026-01-01-fx-doc' });
  return dir;
}

// Spec 15 fixture repo: the fixture vault at research/ (relative, inside the repo), a doc under
// references.globs, two .lua files with a bare id and a pinned id, and a versions file. With
// `code`, the binding carries the code block; without it, the same files and no block.
export const LUA_A = 'local _, ns = ...\n\n-- per 2026-01-01-fx-doc\nlocal function f()\n  return 1\nend\n';
export const LUA_B = '-- per 2026-01-01-fx-missing@dep=1.2.3\nfunction ns.g()\n  return 2\nend\n';
export function codeRepo({ code = true } = {}) {
  const root = tmpVault('rv-code-');
  const vault = join(root, 'research');
  fixtureVault(vault);
  const cfg = { vault: 'research', references: { globs: ['docs/*.md'] } };
  if (code) cfg.code = { globs: ['src/**/*.lua'], languages: {}, versions: { dep: { file: 'deps.txt', pattern: '^dep (\\S+)' } } };
  writeFileSync(join(root, '.research-vault.json'), JSON.stringify(cfg) + '\n');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src', 'a.lua'), LUA_A);
  writeFileSync(join(root, 'src', 'b.lua'), LUA_B);
  writeFileSync(join(root, 'docs', 'd.md'), 'See 2026-01-01-fx-doc.\n');
  writeFileSync(join(root, 'deps.txt'), '# deps\ndep 1.2.3\n');
  return { root, vault, cfg };
}
