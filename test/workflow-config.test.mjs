import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testEnv } from './helpers.mjs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

// Configuration scans: guard release eligibility and commit identity, not GitHub execution.
const releaseConfig = () => read('.github/workflows/release.yml').replace(/#[^\n]*/g, '');

test('release configuration triggers only on ci completion on master', () => {
  const trigger = releaseConfig().match(/^on:\s*\n([\s\S]*?)(?=^\S)/m)?.[1];
  assert.ok(trigger, 'missing trigger mapping');
  const tokens = trigger.match(/[\w-]+/g);
  assert.deepEqual(tokens, ['workflow_run', 'workflows', 'ci', 'types', 'completed', 'branches', 'master']);
});

// Source-scan guard: workflow_run subscribes by workflow name, not filename.
test('release workflow subscriptions name existing workflows and are exactly ci', () => {
  const subscriptions = releaseConfig().match(/^  workflow_run:\s*\n\s+workflows:\s*\[([^\]]*)\]/m)?.[1];
  assert.notEqual(subscriptions, undefined, 'missing workflow subscriptions');
  const names = subscriptions.split(',').map((name) => name.trim().replace(/^(['"])(.*)\1$/, '$2'));
  assert.deepEqual(names, ['ci']);
  const directory = new URL('../.github/workflows/', import.meta.url);
  const workflowNames = readdirSync(directory).filter((file) => /\.ya?ml$/.test(file))
    .map((file) => read(`.github/workflows/${file}`).replace(/#[^\n]*/g, '')
      .match(/^name:[ \t]*(.+)$/m)?.[1]?.trim().replace(/^(['"])(.*)\1$/, '$2'));
  for (const name of names) assert.ok(workflowNames.includes(name), `no workflow named ${name}`);
});

test('release configuration job condition requires successful push CI on master in the main repository', () => {
  const condition = releaseConfig().match(/^  release:\s*\n\s+if:\s*([^\n]+)/m)?.[1];
  assert.ok(condition, 'missing release job condition');
  const clauses = condition.replace(/\$\{\{|\}\}/g, '').split('&&')
    .map((clause) => clause.match(/[\w.-]+|==|'[^']*'/g)?.join(' ')).sort();
  assert.deepEqual(clauses, [
    "github.event.workflow_run.conclusion == 'success'",
    "github.event.workflow_run.event == 'push'",
    "github.event.workflow_run.head_branch == 'master'",
    "github.repository == 'andrew-brooks-GA/research-vault'",
  ].sort());
});

test('release configuration checks out and targets the CI head_sha', () => {
  const config = releaseConfig();
  assert.match(config, /uses:\s*actions\/checkout@[^\n]+\n\s+with:\s*\n\s+ref:\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/);
  const variable = config.match(/(\w+):\s*\$\{\{\s*github\.event\.workflow_run\.head_sha\s*\}\}/g)
    ?.find((entry) => !entry.startsWith('ref:'))?.split(':')[0];
  assert.ok(variable, 'missing CI SHA environment variable');
  assert.match(config, new RegExp(`gh release create[^\\n]*--target\\s+"\\$${variable}"`));
  assert.doesNotMatch(config, /\bGITHUB_SHA\b/);
});

test('documented Node floors agree with package engines', () => {
  const engines = JSON.parse(read('package.json')).engines.node;
  assert.match(engines, /^>=\d+$/);
  const floor = engines.slice(2);
  for (const path of ['README.md', 'docs/CODEX.md']) {
    const matches = [...read(path).matchAll(/Node (\d+) or newer/g)];
    assert.ok(matches.length, `${path}: missing Node floor`);
    for (const match of matches) assert.equal(match[1], floor, `${path}: Node floor`);
  }
  const badge = read('README.md').match(/!\[Node ≥(\d+)\]\(https:\/\/img\.shields\.io\/badge\/node-%E2%89%A5(\d+)-[^)]+\)/);
  assert.ok(badge, 'README.md: missing Node badge');
  assert.equal(badge[1], floor, 'README.md: badge alt Node floor');
  assert.equal(badge[2], floor, 'README.md: badge URL Node floor');
  assert.equal(read('AGENTS.md').match(/`engines` >=(\d+)/)?.[1], floor, 'AGENTS.md: Node floor');
});

// Source-scan guard: every external action in workflow YAML must use a full commit SHA.
test('every action a workflow uses is pinned by a full commit SHA', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  const files = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
  assert.ok(files.length, 'missing workflows');
  for (const file of files) {
    // Consume comments separately; accept block/flow mappings and quoted keys/values.
    const entries = read(`.github/workflows/${file}`).matchAll(
      /#[^\r\n]*|(?:^|[\s{,])(?:uses|"uses"|'uses')\s*:\s*(?:"([^"]*)"|'([^']*)'|([^\s,}#]+))/gm,
    );
    for (const match of entries) {
      const entry = match[1] ?? match[2] ?? match[3];
      if (entry === undefined || entry.startsWith('./') || entry.startsWith('docker://')) continue;
      assert.match(entry, /^[\w-]+\/[\w.-]+(?:\/[\w.-]+)*@[a-f0-9]{40}$/, `${file}: ${entry}`);
    }
  }
});

test('S-21: every actions/checkout step sets persist-credentials: false', () => {
  const directory = new URL('../.github/workflows/', import.meta.url);
  const files = readdirSync(directory).filter((name) => /\.ya?ml$/.test(name));
  for (const file of files) {
    const config = read(`.github/workflows/${file}`).replace(/#[^\n]*/g, '');
    const checkoutUses = /(?:uses|"uses"|'uses')\s*:\s*["']?actions\/checkout@/;
    const checkouts = config.matchAll(new RegExp(`(?:^|[\\s{,])${checkoutUses.source}`, 'gm'));
    let checked = 0;
    for (const [step] of config.matchAll(/^( *)-(?= |$)[^\n]*(?:\n(?: *$|\1 +\S[^\n]*))*/gm)) {
      // A step ends at the next list item or dedent. Match only its direct keys and inputs.
      const mapping = step.replace('-', ' ');
      const indent = mapping.match(/^ *(?=\S)/m)?.[0];
      if (indent === undefined) continue;
      const fields = mapping.split(new RegExp(`^${indent}(?=\\S)`, 'm')).slice(1);
      const checkout = fields.find((field) => field.search(checkoutUses) === 0);
      if (!checkout) continue;
      const inputs = fields.find((field) => /^(?:with|"with"|'with')[ \t]*:[ \t]*\n/.test(field));
      const inputIndent = inputs?.match(/\n( +)\S/)?.[1];
      const setting = /(?:persist-credentials|"persist-credentials"|'persist-credentials')[ \t]*:[ \t]*(?:false|"false"|'false')[ \t]*$/;
      assert.ok(inputIndent && new RegExp(`^${inputIndent}${setting.source}`, 'm').test(inputs),
        `${file}: ${checkout.trim()} must set with.persist-credentials to false`);
      checked++;
    }
    assert.equal(checked, [...checkouts].length, `${file}: could not verify the inputs of every checkout step`);
  }
});

// Source-scan guard: extract the version step's real heredoc so these cases execute
// the release check shipped in the workflow, rather than a duplicate implementation.
for (const { name, plugin, marketplace, status, error, notice } of [
  { name: 'accepts equal versions', plugin: '1.2.3', marketplace: { version: '1.2.3' }, status: 0 },
  { name: 'rejects a differing plugin version', plugin: '9.8.7', marketplace: { version: '1.2.3' }, status: 1,
    error: 'Release versions differ: package.json=1.2.3, plugin.json=9.8.7, marketplace.json=1.2.3' },
  { name: 'accepts a marketplace entry without a version', plugin: '1.2.3', marketplace: {}, status: 0,
    notice: 'No marketplace version to compare.' },
  { name: 'rejects a differing marketplace version', plugin: '1.2.3', marketplace: { version: '9.8.7' }, status: 1,
    error: 'Release versions differ: package.json=1.2.3, plugin.json=1.2.3, marketplace.json=9.8.7' },
]) {
  test(`release version step ${name}`, { timeout: 15000 }, (t) => {
    const script = read('.github/workflows/release.yml').match(
      /- name: Check release versions\n        run: \|\n          node --input-type=module <<'NODE'\n([\s\S]*?)^          NODE$/m,
    )?.[1];
    assert.ok(script, 'missing version step heredoc');
    const cwd = mkdtempSync(join(tmpdir(), 'rv-release-versions-'));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));
    mkdirSync(join(cwd, '.claude-plugin'));
    const files = {
      'package.json': JSON.stringify({ name: 'fixture-plugin', version: '1.2.3' }),
      '.claude-plugin/plugin.json': JSON.stringify({ version: plugin }),
      '.claude-plugin/marketplace.json': JSON.stringify({ plugins: [
        { name: 'other-plugin', version: '0.0.0' }, { name: 'fixture-plugin', ...marketplace },
      ] }),
    };
    for (const [path, content] of Object.entries(files)) writeFileSync(join(cwd, path), content);
    const result = spawnSync(process.execPath, ['--input-type=module'], {
      cwd, input: script.replace(/^          /gm, ''), encoding: 'utf8', timeout: 10000, env: testEnv(),
    });
    assert.ifError(result.error);
    assert.equal(result.status, status, result.stderr);
    assert.equal(result.stderr, error ? `${error}\n` : '');
    assert.equal(result.stdout, notice ? `${notice}\n` : '');
    assert.deepEqual(readdirSync(cwd).sort(), ['.claude-plugin', 'package.json']);
    assert.deepEqual(readdirSync(join(cwd, '.claude-plugin')).sort(), ['marketplace.json', 'plugin.json']);
    for (const [path, content] of Object.entries(files)) assert.equal(readFileSync(join(cwd, path), 'utf8'), content);
  });
}
