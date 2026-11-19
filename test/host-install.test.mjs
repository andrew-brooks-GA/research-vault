import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { manageCodex, installationFiles, shellQuote } from '../bin/lib/host-install.mjs';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), "rv codex $' "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('Codex install is pinned, repeatable, works from nested directories, and preserves unowned files on uninstall', t => {
  const root = project(t);
  assert.equal(manageCodex(root, 'status').installed, false);
  assert.equal(manageCodex(root, 'install', { dryRun: true }).dryRun, true);
  assert.equal(existsSync(join(root, '.agents')), false);
  manageCodex(root, 'install');
  assert.deepEqual(manageCodex(root, 'status').changed, []);
  const manifest = readFileSync(join(root, '.research-vault-host/codex-install.json'), 'utf8');
  manageCodex(root, 'install');
  assert.equal(readFileSync(join(root, '.research-vault-host/codex-install.json'), 'utf8'), manifest);
  const s = readFileSync(join(root, '.agents/skills/research-claims-gate/SKILL.md'), 'utf8');
  assert.ok(s.includes('research-vault-claims-reviewer'));
  assert.ok(!s.includes('${CLAUDE_PLUGIN_ROOT}'));
  assert.ok(!s.includes('subagent_type: research-vault:'));
  const wrappers = ['research', 'research-init', 'research-search', 'research-related', 'research-lint', 'research-compile', 'research-obsidian'];
  for (const task of wrappers) assert.match(readFileSync(join(root, `.agents/skills/${task}/agents/openai.yaml`), 'utf8'), /allow_implicit_invocation: false/);
  const nested = join(root, 'nested'); mkdirSync(nested);
  const run = args => spawnSync(process.execPath, [join(root, '.research-vault-host/codex/run.mjs'), ...args], { cwd: nested, encoding: 'utf8' });
  const vault = join(root, 'research');
  assert.equal(run(['init', '--vault', vault]).status, 0);
  assert.equal(run(['lint', '--vault', vault, '--check']).status, 0);
  writeFileSync(join(root, '.agents/skills/personal.txt'), 'keep');
  manageCodex(root, 'uninstall');
  assert.equal(existsSync(join(root, '.agents/skills/research/SKILL.md')), false);
  assert.equal(readFileSync(join(root, '.agents/skills/personal.txt'), 'utf8'), 'keep');
  assert.ok(existsSync(join(vault, 'AGENTS.md')));
});

test('existing hook settings are not clobbered; hook-free installation is available', t => {
  const root = project(t); mkdirSync(join(root, '.codex'));
  writeFileSync(join(root, '.codex/hooks.json'), '{"hooks":{}}');
  assert.throws(() => manageCodex(root, 'install'), /refusing to overwrite/);
  assert.equal(existsSync(join(root, '.agents')), false);
  manageCodex(root, 'install', { withoutHooks: true });
  manageCodex(root, 'uninstall');
  assert.equal(readFileSync(join(root, '.codex/hooks.json'), 'utf8'), '{"hooks":{}}');
});

test('edited installation files stop upgrade/uninstall, and pinned launcher rejects package drift', t => {
  const root = project(t); manageCodex(root, 'install');
  const p = join(root, '.research-vault-host/codex/package/package.json');
  writeFileSync(p, '{}');
  assert.deepEqual(manageCodex(root, 'status').changed, ['.research-vault-host/codex/package/package.json']);
  assert.throws(() => manageCodex(root, 'install'), /owned files changed/);
  assert.throws(() => manageCodex(root, 'uninstall'), /owned files changed/);
  const run = spawnSync(process.execPath, [join(root, '.research-vault-host/codex/run.mjs'), 'host', 'paths'], { encoding: 'utf8' });
  assert.equal(run.status, 2); assert.match(run.stderr, /installed package changed/);
});

test('installer refuses symlinked destination ancestors before writes', t => {
  const root = project(t), outside = project(t);
  symlinkSync(outside, join(root, '.agents'));
  assert.throws(() => manageCodex(root, 'install'), /symlink/);
  assert.equal(existsSync(join(outside, 'skills')), false);
});

test('Codex generation keeps shared Claude sources byte-identical and pins custom agents', t => {
  const root = project(t);
  const before = readFileSync(new URL('../agents/claims-reviewer.md', import.meta.url));
  const { files } = installationFiles(root);
  assert.deepEqual(files.get('.research-vault-host/codex/package/agents/claims-reviewer.md'), before);
  assert.deepEqual(readFileSync(new URL('../agents/claims-reviewer.md', import.meta.url)), before);
  const agent = files.get('.codex/agents/research-vault-claims-reviewer.toml').toString();
  assert.match(agent, /model = "gpt-6.1-sol"/); assert.match(agent, /model_reasoning_effort = "high"/);
  const hooks = JSON.parse(files.get('.codex/hooks.json'));
  assert.equal(Object.keys(hooks.hooks).length, 4);
  assert.ok(hooks.hooks.PostToolUse[0].hooks[0].command.includes("'\\''"));
});

 test('failed exclusive temp creation preserves the unowned file and rolls back the install', t => {
  const root = project(t);
  const p = join(root, '.research-vault-host/codex/package/bin/commands/advise.mjs');
  mkdirSync(join(p, '..'), { recursive: true });
  const temp = `${p}.rv-install-${process.pid}`;
  writeFileSync(temp, 'user-owned sentinel');
  assert.throws(() => manageCodex(root, 'install'), /EEXIST/);
  assert.equal(readFileSync(temp, 'utf8'), 'user-owned sentinel');
  assert.equal(existsSync(join(root, '.research-vault-host/codex-install.json')), false);
  assert.equal(existsSync(join(root, '.research-vault-host/install.lock')), false);
});

test('generated review commands honor installed model and effort choices', t => {
  const root = project(t);
  const { files } = installationFiles(root, { model: 'gpt-6-astra', effort: 'xhigh' });
  const skill = files.get('.agents/skills/research-claims-gate/SKILL.md').toString();
  assert.match(skill, /host review codex --model gpt-6-astra --effort xhigh --role claims-reviewer/);
  assert.ok(!skill.includes('host review codex --role'));
});

// Issue 72 item 10: the Codex copy of the orchestrate script runs the pinned launcher, whatever args.cli names.
test('the Codex orchestrate script runs the pinned launcher, not the path args.cli names', async t => {
  const root = project(t);
  const { files } = installationFiles(root);
  const skill = files.get('.agents/skills/research-orchestrate/SKILL.md').toString();
  const script = skill.slice(skill.indexOf('## 2. Run the workflow')).match(/```javascript\n([\s\S]*?)\n```/)[1];
  const page = { url: 'https://example.com/a', title: 't', domain: 'd', topics: 'x', authorityTier: 'a', authorityBasis: 'b', summary: 's', claims: [{ claim: 'c', quote: 'q' }] };
  let prompt = '', recon = '';
  const agent = async (text, opts) => (opts.phase === 'Recon' ? ((recon = text), 'none') : opts.phase === 'Research' ? { pages: [structuredClone(page)] } : ((prompt = text), { status: 'complete', lint: '' }));
  const AsyncFunction = (async () => {}).constructor;
  await new AsyncFunction('agent', 'parallel', 'pipeline', 'phase', 'log', 'args', 'budget', 'workflow', script.replace(/^export /, ''))(
    agent, (fns) => Promise.all(fns.map((f) => f())), null, () => {}, () => {}, { question: 'q', cli: '/bypass/research-vault.mjs', vault: '/v', today: '2026-11-17', runKey: 'run-test72', storeText: true, lanes: ['one lane'], pagesPerLane: 2 });
  const launcher = `node ${shellQuote(join(root, '.research-vault-host/codex/run.mjs'))} `;
  assert.ok(prompt.includes(`${launcher}capture --fill`), 'the Write step runs the launcher');
  assert.ok(recon.includes(`${launcher}search`), 'so does the Recon step');
  assert.ok(!prompt.includes('/bypass') && !recon.includes('/bypass'), 'and neither names the path args.cli names');
  // A Codex controller runs the steps inline from this text: the constant and the args comment name no other CLI.
  assert.ok(script.includes(`const CLI = ${JSON.stringify(launcher)}`), 'the constant in the text is the launcher');
  assert.ok(!script.includes('${args.cli}') && !script.includes('absolute path to research-vault.mjs'), 'the text sends no reader to args.cli');
});
