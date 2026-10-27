import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import { build, context, extract, EXTRACTED, IGNORED } from '../scripts/deps.mjs';

const ctx = context();

test('no reference points at something that no longer exists (spec 14)', () => {
  const { broken } = build(ctx);
  const list = broken.map((e) => `  ${e.kind} ${e.from} -> ${e.to}`).join('\n');
  assert.equal(broken.length, 0, `broken edges; update every dependent listed or add the file back:\n${list}`);
});

// One input per supported syntax and the edge it must yield. A regex that stops matching one form
// fails its row; there are no count floors, which would let one form die unseen.
const SAMPLES = [
  ['bin/commands/x.mjs', "import { listStale } from '../lib/stale.mjs';", 'import', 'bin/lib/stale.mjs'],
  ['bin/research-vault.mjs', "  init: () => import('./commands/init.mjs'),", 'import', 'bin/commands/init.mjs'],
  ['bin/lib/x.mjs', "import taxonomy from '../../schema/taxonomy.json' with { type: 'json' };", 'import', 'schema/taxonomy.json'],
  ['test/x.test.mjs', "import { build } from '../scripts/deps.mjs';", 'tests', 'scripts/deps.mjs'],
  ['bin/lib/x.mjs', "JSON.parse(readFileSync(join(repoRoot, 'schema', 'taxonomy.json'), 'utf8'))", 'reads', 'schema/taxonomy.json'],
  ['test/x.test.mjs', "read('skills/research-teach/LESSON-FORMAT.md')", 'reads', 'skills/research-teach/LESSON-FORMAT.md'],
  ['hooks/hooks.json', '"${CLAUDE_PLUGIN_ROOT}/hooks/pre-web.mjs"', 'registers', 'hooks/pre-web.mjs'],
  ['docs/X.md', 'edit `bin/lib/stale.mjs` first', 'documents', 'bin/lib/stale.mjs'],
  ['.github/workflows/ci.yml', '      - run: node scripts/check-encoding.mjs', 'documents', 'scripts/check-encoding.mjs'],
  ['docs/X.md', 'see [security](../SECURITY.md)', 'documents', 'SECURITY.md'],
  ['docs/X.md', 'the `LICENSE` file', 'documents', 'LICENSE'],
  ['skills/x/SKILL.md', 'follow `meta/prompt-templates/probe-tool.md`', 'documents', 'vault-template/meta/prompt-templates/probe-tool.md'],
  ['skills/x/SKILL.md', 'cp -n "${CLAUDE_PLUGIN_ROOT}/skills/research-teach/assets/quiz.js" assets/', 'documents', 'skills/research-teach/assets/quiz.js'],
  ['skills/x/SKILL.md', 'subagent_type: research-vault:claims-reviewer', 'invokes-agent', 'agents/claims-reviewer.md'],
  ['docs/X.md', 'the `research-capture` skill', 'invokes-skill', 'skills/research-capture/SKILL.md'],
  ['docs/X.md', 'or `/research-init`', 'invokes-command', 'commands/research-init.md'],
  ['docs/X.md', 'the `research-vault:no-such-agent` agent', 'invokes-unknown', 'no-such-agent'],
  ['docs/X.md', 'Run `research-vault lint --fix`.', 'invokes-cli', 'cli:lint'],
  ['docs/X.md', '```\nnode bin/research-vault.mjs init --vault ./ci-vault\n```', 'invokes-cli', 'cli:init'],
  ['commands/x.md', 'Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" obsidian`.', 'invokes-cli', 'cli:obsidian'],
  ['skills/x/SKILL.md', 'Run `gate evidence <draft> --extra <ids> --changed`.', 'invokes-cli', 'cli:gate'],
  ['.github/workflows/ci.yml', '      - run: node bin/research-vault.mjs lint --vault ./ci-vault --check', 'invokes-cli', 'cli:lint'],
  ['commands/x.md', '`research-vault init --refresh-doc`', 'invokes-cli', 'cli:init --refresh-doc'],
  ['docs/X.md', '`research-vault lnt`', 'invokes-cli', 'cli:lnt'],
  ['AGENTS.md', '- `npm run lint:self`: the template lints clean.', 'npm', 'npm:lint:self'],
];

test('every supported reference syntax still yields its edge', () => {
  for (const [file, text, kind, to] of SAMPLES) {
    const edges = extract(file, text, ctx);
    assert.ok(edges.some((e) => e.kind === kind && e.to === to), `${file} ${JSON.stringify(text)}: want ${kind} ${to}, got ${JSON.stringify(edges)}`);
  }
});

test('running prose and the plugin name are not invocations', () => {
  const edges = extract('docs/X.md', 'The research-vault plugin: research-vault gives the agent a folder. Run research-vault lint by hand.', ctx);
  assert.deepEqual(edges.filter((e) => e.kind === 'invokes-cli'), []);
});

test('every extension in the tree is extracted or ignored', () => {
  for (const f of ctx.files) {
    const e = posix.extname(f);
    assert.ok(EXTRACTED.has(e) || IGNORED.has(e), `${f}: add ${JSON.stringify(e)} to EXTRACTED or IGNORED in scripts/deps.mjs`);
  }
});
