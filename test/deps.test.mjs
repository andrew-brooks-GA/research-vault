import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gitInvocation } from '../bin/lib/git.ts';
import { build, context, COUPLINGS, dependents, extensionOf, extract, EXTRACTED, IGNORED } from '../scripts/deps.ts';
import { testEnv, tmpVault } from './helpers.mjs';

const ctx = context();

test('no reference points at something that no longer exists (spec 14)', () => {
  const { broken } = build(ctx);
  const list = broken.map((e) => `  ${e.kind} ${e.from} -> ${e.to}`).join('\n');
  assert.equal(broken.length, 0, `broken edges; update every dependent listed or add the file back:\n${list}`);
});

test('the tooling lockfile contributes only coupling edges', () => {
  const { edges } = build(ctx);
  assert.deepEqual(edges.filter(({ from, kind }) => from === 'tooling/package-lock.json' && kind !== 'couples'), []);
});

// Guard shared vocabulary and quoted contracts at both ends of every declared coupling;
// a run cannot establish that documentation and unvisited code still contain each contract.
test('source scan: every COUPLINGS literal is still in both files (spec 14)', () => {
  for (const [a, b, why, literal] of COUPLINGS) {
    if (literal === undefined) continue;
    for (const f of [a, b]) {
      const text = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
      assert.ok(typeof literal === 'string' ? text.includes(literal) : literal.test(text), `${f} no longer contains ${literal} (${a} <-> ${b}: ${why}); move the row to where the literal now is, or update it`);
    }
  }
});

// One input per supported syntax and the edge it must yield. A regex that stops matching one form
// fails its row; there are no count floors, which would let one form die unseen.
const SAMPLES = [
  ['.github/workflows/ci.yml', '      - run: npm run coverage', 'npm', 'npm:coverage'],
  ['bin/commands/x.mjs', "import { listStale } from '../lib/stale.mjs';", 'import', 'bin/lib/stale.mjs'],
  ['bin/research-vault.mjs', "  init: () => import('./commands/init.mjs'),", 'import', 'bin/commands/init.mjs'],
  ['bin/lib/x.mjs', "import taxonomy from '../../schema/taxonomy.json' with { type: 'json' };", 'import', 'schema/taxonomy.json'],
  ['test/x.test.mjs', "import { build } from '../scripts/deps.ts';", 'tests', 'scripts/deps.ts'],
  ['bin/lib/x.mjs', "JSON.parse(readFileSync(join(repoRoot, 'schema', 'taxonomy.json'), 'utf8'))", 'reads', 'schema/taxonomy.json'],
  ['test/x.test.mjs', "read('skills/research-teach/LESSON-FORMAT.md')", 'reads', 'skills/research-teach/LESSON-FORMAT.md'],
  ['test/x.test.mjs', "readFileSync(join(ROOT, 'hooks', 'hooks.json'), 'utf8')", 'reads', 'hooks/hooks.json'],
  ['bin/commands/x.mjs', "readFileSync(join(repoRoot, 'vault-template', 'meta', 'entry-skeletons', `${type}.md`))", 'reads', 'vault-template/meta/entry-skeletons/note.md'],
  ['hooks/hooks.json', '"${CLAUDE_PLUGIN_ROOT}/hooks/pre-web.mjs"', 'registers', 'hooks/pre-web.mjs'],
  ['.claude/settings.json', '"args": ["${CLAUDE_PROJECT_DIR}/scripts/deps.mjs", "--hook"]', 'documents', 'scripts/deps.mjs'],
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
  ['AGENTS.md', '- `npm test` (isolated environment; a test or a test file may run 10 minutes and the whole run 20): every test passes.', 'npm', 'npm:test'],
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

function assertKnownExtensions(files) {
  for (const f of files) {
    const e = extensionOf(f);
    assert.ok(EXTRACTED.has(e) || IGNORED.has(e), `${f}: add ${JSON.stringify(e)} to EXTRACTED or IGNORED in scripts/deps.mjs`);
  }
}

test('every extension in the tree is extracted or ignored', () => {
  assertKnownExtensions(ctx.files);
});

for (const ext of ['.d.ts', '.d.mts']) {
  test(`the extension guard accepts ${ext} declaration files`, () => {
    assert.doesNotThrow(() => assertKnownExtensions([`bin/types${ext}`]));
  });
}

test('the extension guard rejects an unclassified extension', () => {
  assert.throws(() => assertKnownExtensions(['bin/source.xyz']), {
    message: 'bin/source.xyz: add ".xyz" to EXTRACTED or IGNORED in scripts/deps.mjs',
  });
});

test('a TypeScript file imports a JavaScript module', () => {
  assert.deepEqual(extract('bin/x.ts', "import './y.mjs';", ctx), [
    { from: 'bin/x.ts', kind: 'import', to: 'bin/y.mjs' },
  ]);
});

test('a TypeScript module lists its TypeScript importer as a dependent', () => {
  const edges = extract('bin/y.ts', "import './x.ts';", ctx);
  assert.deepEqual(dependents('bin/x.ts', { edges }), ['import bin/y.ts']);
});

for (const [name, source] of [
  ['an import type declaration', "import type { T } from './x.ts';"],
  ['an import with inline type and value specifiers', "import { type T, v } from './x.ts';"],
  ['an export type declaration', "export type { T } from './x.ts';"],
  ['a multiline TypeScript import', "import {\n  T,\n  v,\n} from\n  './x.ts';"],
]) {
  test(`${name} adds an import edge`, () => {
    assert.deepEqual(extract('bin/y.ts', source, ctx), [
      { from: 'bin/y.ts', kind: 'import', to: 'bin/x.ts' },
    ]);
  });
}

test('a TypeScript module adds a reads edge for a joined path', () => {
  assert.deepEqual(extract('bin/x.ts', "join(root, 'schema', 'x.json')", ctx), [
    { from: 'bin/x.ts', kind: 'reads', to: 'schema/x.json' },
  ]);
});

test('a .js module skips reads edges for a joined path', () => {
  assert.deepEqual(extract('bin/x.js', "join(root, 'schema', 'x.json')", ctx), []);
});

test('a quoted TypeScript path under a top-level directory adds a reads edge', () => {
  assert.deepEqual(extract('bin/x.mjs', "read('schema/x.ts')", ctx), [
    { from: 'bin/x.mjs', kind: 'reads', to: 'schema/x.ts' },
  ]);
});

test('a document code region invoking the TypeScript entry adds an invokes-cli edge', () => {
  const edges = extract('docs/X.md', '`node bin/research-vault.ts init`', ctx);
  assert.deepEqual(edges.filter(({ kind }) => kind === 'invokes-cli'), [
    { from: 'docs/X.md', kind: 'invokes-cli', to: 'cli:init' },
  ]);
});

test('a command string in JSON adds an invokes-cli edge', () => {
  const edges = extract('fixture.json', '{"command":"node research-vault.mjs init"}', ctx);
  assert.deepEqual(edges.filter(({ kind }) => kind === 'invokes-cli'), [
    { from: 'fixture.json', kind: 'invokes-cli', to: 'cli:init' },
  ]);
});

function buildFixture(entries) {
  const sources = new Map(entries);
  return build({ ...ctx, files: [...sources.keys()], commands: [], scripts: [] }, (file) => sources.get(file));
}

test('the TypeScript dependency scanner contributes no edges for its own quoted paths', () => {
  const source = "const path = 'scripts/missing.ts';";
  const { edges, broken } = buildFixture([
    ['scripts/deps.ts', source],
    ['scripts/other.ts', source],
  ]);
  assert.deepEqual(edges.filter(({ from }) => from === 'scripts/deps.ts'), [
    { from: 'scripts/deps.ts', kind: 'couples', to: 'test/tooling.test.mjs', why: 'the tooling import guard uses the import edge kind and paths' },
    { from: 'scripts/deps.ts', kind: 'couples', to: 'scripts/coverage.mjs', why: 'the order and coverage start from the same code extensions and source directories' },
    { from: 'scripts/deps.ts', kind: 'couples', to: 'test/deps.test.mjs', why: 'the order command reports tab-separated levels and sorted import cycle groups' },
    { from: 'scripts/deps.ts', kind: 'couples', to: 'test/launcher.test.mjs', why: 'the launcher guard uses import and tests edges and their from and to paths' },
    { from: 'scripts/deps.ts', kind: 'couples', to: 'test/layering.test.mjs', why: 'the layering tests use the import edge kind and its from and to paths' },
  ]);
  assert.deepEqual(broken.filter(({ from }) => from === 'scripts/other.ts'), [
    { from: 'scripts/other.ts', kind: 'reads', to: 'scripts/missing.ts' },
  ]);
});

test('a missing TypeScript import fails the dependency check', () => {
  const { broken } = buildFixture([['bin/source.ts', "import './missing.ts';"]]);
  assert.deepEqual(broken.filter(({ kind }) => kind === 'import'), [
    { from: 'bin/source.ts', kind: 'import', to: 'bin/missing.ts' },
  ]);
});

test('declaration files contribute no outgoing edges to the dependency graph', () => {
  const { edges } = buildFixture([
    ['bin/types.d.ts', "export type { Other } from './other.ts';"],
    ['bin/types.d.mts', "export type { Other } from './other.ts';"],
  ]);
  assert.deepEqual(edges.filter(({ from }) => from.startsWith('bin/types.')), []);
});

function repoFixture(t, sources) {
  const cwd = tmpVault('rv-deps-fixture-');
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const invocation = gitInvocation(['init', '-q'], { cwd });
  execFileSync('git', invocation.args, { ...invocation.options, env: testEnv() });
  cpSync(new URL('../package.json', import.meta.url), join(cwd, 'package.json'));
  for (const [file, source] of Object.entries(sources)) {
    mkdirSync(join(cwd, posix.dirname(file)), { recursive: true });
    writeFileSync(join(cwd, file), source);
  }
  for (const file of ['bin/lib/git.ts', 'bin/lib/node-floor.mjs', 'bin/lib/unknowns.ts', 'scripts/deps.mjs', 'scripts/deps.ts']) {
    mkdirSync(join(cwd, posix.dirname(file)), { recursive: true });
    cpSync(new URL(`../${file}`, import.meta.url), join(cwd, file));
  }
  return join(cwd, 'scripts/deps.mjs');
}

function cliFixture(t, sources) {
  const script = repoFixture(t, { 'package.json': '{}', ...sources });
  return import(new URL('./deps.ts', pathToFileURL(script)));
}

test('an agent without a frontmatter name is indexed under the undefined string', { timeout: 30000 }, async (t) => {
  const { context } = await cliFixture(t, {
    'bin/research-vault.mjs': '',
    'agents/fixture.md': '# Agent',
  });
  assert.deepEqual(context().names, { undefined: { kind: 'invokes-agent', file: 'agents/fixture.md' } });
});

test('a skill without a frontmatter name is indexed under the undefined string', { timeout: 30000 }, async (t) => {
  const { context } = await cliFixture(t, {
    'bin/research-vault.mjs': '',
    'skills/fixture/SKILL.md': '# Skill',
  });
  assert.deepEqual(context().names, { undefined: { kind: 'invokes-skill', file: 'skills/fixture/SKILL.md' } });
});

test('a CLI command dispatches to the TypeScript file in the entry map', { timeout: 30000 }, async (t) => {
  const { build } = await cliFixture(t, {
    'bin/research-vault.ts': "  related: () => import('./commands/related.ts'),",
    'bin/commands/related.ts': '',
  });
  const { edges } = build();
  assert.deepEqual(edges.filter(({ kind }) => kind === 'dispatches'), [
    { from: 'cli:related', kind: 'dispatches', to: 'bin/commands/related.ts' },
  ]);
});

test('a documented option read by a TypeScript command is accepted', { timeout: 30000 }, async (t) => {
  const { build, context } = await cliFixture(t, {
    'bin/research-vault.mjs': "  related: () => import('./commands/related.ts'),",
    'bin/commands/related.ts': 'const depth = args.depth;',
    'docs/commands.md': '`research-vault related --depth 2`',
  });
  const ctx = context();
  assert.deepEqual(ctx.flags.related, new Set(['depth']));
  const { edges } = build(ctx);
  assert.deepEqual(edges.filter(({ kind }) => kind === 'invokes-cli'), [
    { from: 'docs/commands.md', kind: 'invokes-cli', to: 'cli:related' },
  ]);
});

test('an args.ts comment does not make --ts a known option', { timeout: 30000 }, async (t) => {
  const { build } = await cliFixture(t, {
    'bin/research-vault.mjs': "  related: () => import('./commands/related.mjs'),",
    'bin/commands/related.mjs': '// See args.ts for argument parsing.',
    'docs/commands.md': '`research-vault related --ts`',
  });
  const { broken } = build();
  assert.deepEqual(broken.filter(({ kind }) => kind === 'invokes-cli'), [
    { from: 'docs/commands.md', kind: 'invokes-cli', to: 'cli:related --ts' },
  ]);
});

test('the dispatch map comes from the TypeScript entry when present and the .mjs entry otherwise', { timeout: 30000 }, async (t) => {
  const withLauncher = await cliFixture(t, {
    'bin/research-vault.mjs': "import './research-vault.ts';",
    'bin/research-vault.ts': "  related: () => import('./commands/related.ts'),",
    'bin/commands/related.ts': '',
  });
  assert.deepEqual(withLauncher.context().commands, ['related']);

  const withoutTypeScript = await cliFixture(t, {
    'bin/research-vault.mjs': "  init: () => import('./commands/init.mjs'),",
    'bin/commands/init.mjs': '',
  });
  assert.deepEqual(withoutTypeScript.context().commands, ['init']);
});

function order(script = fileURLToPath(new URL('../scripts/deps.mjs', import.meta.url))) {
  return spawnSync(process.execPath, [script, '--order'], {
    env: testEnv(), encoding: 'utf8', timeout: 20000,
  });
}

test('--hook prints nothing and exits successfully for a non-string file_path', { timeout: 30000 }, () => {
  const script = fileURLToPath(new URL('../scripts/deps.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--hook'], {
    env: testEnv(), encoding: 'utf8', timeout: 20000,
    input: JSON.stringify({ tool_input: { file_path: [script] } }),
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('--order prints exact import levels and sorts paths within a level', { timeout: 30000 }, (t) => {
  const result = order(repoFixture(t, {
    'bin/a.ts': "import './b.mjs';\nimport './Z.ts';",
    'bin/b.mjs': 'export const b = 1;',
    'bin/Y.js': '',
    'bin/Z.ts': "import type { T } from './c.ts';",
    'bin/c.ts': "import './types.d.ts';\nimport './types.d.mts';\nimport '../test/helper.mjs';\nimport 'node:fs';",
    'bin/d.js': '',
    'bin/types.d.ts': "export type { T } from './a.ts';",
    'bin/types.d.mts': "export type { T } from './a.ts';",
    'test/helper.mjs': "import '../bin/a.ts';",
  }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, [
    '0\tbin/Y.js', '0\tbin/b.mjs', '0\tbin/c.ts', '0\tbin/d.js', '0\tbin/lib/git.ts',
    '0\tbin/lib/node-floor.mjs', '0\tbin/lib/unknowns.ts',
    '1\tbin/Z.ts', '1\tscripts/deps.ts', '2\tbin/a.ts', '2\tscripts/deps.mjs', '',
  ].join('\n'));
});

test('--order refuses cycles and reports each sorted import group once', { timeout: 30000 }, (t) => {
  const result = order(repoFixture(t, {
    'bin/z.mjs': "import './z.mjs';",
    'bin/b.mjs': "import './a.ts';\nimport './c.ts';\nimport './z.mjs';",
    'bin/c.ts': "import './b.mjs';",
    'bin/a.ts': "import './b.mjs';",
    'bin/consumer.mjs': "import './a.ts';",
    'bin/leaf.mjs': '',
  }));
  assert.equal(result.status, 1, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'Cyclic import groups:\nbin/a.ts, bin/b.mjs, bin/c.ts\nbin/z.mjs\n');
});

test('--order lists the real code files once and puts each importer above its dependencies', { timeout: 30000 }, () => {
  const result = order();
  assert.equal(result.status, 0, result.stderr);
  const lines = result.stdout.trimEnd().split('\n').map((line) => line.split('\t'));
  const expectedFiles = ctx.files.filter((file) => /^(bin|hooks|scripts|skills)\/.*\.(mjs|js|ts)$/.test(file) && !file.endsWith('.d.ts'));
  assert.deepEqual(lines.map(([, file]) => file).sort(), expectedFiles);
  const levels = new Map(lines.map(([level, file]) => [file, Number(level)]));
  for (const { kind, from, to } of build(ctx).edges) {
    if (kind === 'import' && levels.has(from) && levels.has(to)) {
      assert.ok(levels.get(from) > levels.get(to), `${from} must follow ${to}`);
    }
  }
  assert.ok(levels.get('scripts/deps.ts') > levels.get('bin/lib/git.ts'));
});
