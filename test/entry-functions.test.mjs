import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { put, testEnv, tmpVault } from './helpers.mjs';

function entryVault(root) {
  const vault = join(root, 'vault');
  put(vault, 'note', '2026-01-01-entry-point', { title: 'Entry point fixture', volatility: 'volatile' });
  return vault;
}

function gatedDraft(root) {
  const project = join(root, 'project');
  mkdirSync(join(project, 'vault'), { recursive: true });
  writeFileSync(join(project, '.research-vault.json'), JSON.stringify({ vault: 'vault', gates: { globs: ['draft.md'] } }));
  const draft = join(project, 'draft.md');
  writeFileSync(draft, 'See https://example.com/entry-point.\n');
  return { project, draft };
}

const jsonLine = (value) => JSON.stringify(value) + '\n';
const contextLine = (hookEventName, additionalContext) => jsonLine({ hookSpecificOutput: { hookEventName, additionalContext } });

const cases = [
  ['hooks/session-start.mjs', (root, cwd) => {
    const vault = entryVault(root);
    return {
      event: { cwd }, env: { RESEARCH_VAULT_PATH: vault },
      stdout: `research-vault: 1 entries; 1 stale; ${vault} (env)\n`,
    };
  }],
  ['hooks/pre-web.mjs', (root, cwd) => ({
    event: { cwd, tool_name: 'WebSearch', tool_input: { query: 'Entry point fixture' } },
    env: { RESEARCH_VAULT_PATH: entryVault(root) },
    stdout: contextLine('PreToolUse', 'Vault entries matching this query:\n- 2026-01-01-entry-point [note, STALE] Entry point fixture'),
  })],
  ['hooks/post-tool-use.mjs', (root, cwd) => {
    const { draft } = gatedDraft(root);
    return {
      event: { cwd, tool_name: 'Write', tool_input: { file_path: draft } },
      stdout: contextLine('PostToolUse', 'research-vault: UNCOVERED https://example.com/entry-point in draft.md\ncapture it (or verify the entry) before the claims gate.'),
    };
  }],
  ['hooks/stop-gate.mjs', (root) => {
    const { project } = gatedDraft(root);
    return {
      event: { cwd: project, stop_hook_active: false },
      stdout: jsonLine({ decision: 'block', reason: 'Gated drafts changed without a claims verdict for their current content:\n- draft.md: run the research-claims-gate skill, then research-vault gate record draft.md PASS|MERIT' }),
    };
  }],
  ['scripts/deps.mjs', () => ({ args: ['npm:test'], stdout: /^npm \.github\/workflows\/ci\.yml$/m }), 'scripts/deps.ts'],
  ['hooks/codex.mjs', (root, cwd) => ({
    args: ['PostToolUse'], event: { cwd },
    stdout: jsonLine({ systemMessage: 'research-vault: no edited paths supplied; run lint/check explicitly.' }),
  })],
];

function fixture(t, setup) {
  const root = tmpVault('rv-entry-functions-');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cwd = join(root, 'cwd');
  mkdirSync(cwd);
  const { args = [], event = {}, env = {}, stdout } = setup(root, cwd);
  return {
    cwd, args, stdout,
    run(nodeArgs) {
      // spawnSync sends the input and closes the child's stdin pipe.
      const result = spawnSync(process.execPath, [...nodeArgs, ...args], {
        cwd, env: testEnv(env), input: jsonLine(event), encoding: 'utf8', timeout: 30000, killSignal: 'SIGKILL',
      });
      assert.ifError(result.error);
      return result;
    },
  };
}

function assertOutput(actual, expected) {
  if (expected instanceof RegExp) assert.match(actual, expected);
  else assert.equal(actual, expected);
}

for (const [file, setup, source = file] of cases) {
  const url = new URL(`../${file}`, import.meta.url);
  const importFile = `await import(${JSON.stringify(new URL(`../${source}`, import.meta.url).href)})`;

  test(`${file} produces the expected output and exit status when started directly`, (t) => {
    const { run, stdout } = fixture(t, setup);
    const result = run([fileURLToPath(url)]);
    assert.equal(result.status, 0, result.stderr);
    assertOutput(result.stdout, stdout);
  });

  test(`${source} exits silently when merely imported`, (t) => {
    const { run } = fixture(t, setup);
    // The placeholder occupies argv[1], keeping the row's arguments at argv[2] and after.
    const { status, stdout, stderr } = run(['--input-type=module', '-e', importFile, '--', 'import-only.mjs']);
    assert.deepEqual({ status, stdout, stderr }, { status: 0, stdout: '', stderr: '' });
  });

  test(`${source} produces the expected output and exit status when a launcher calls main()`, (t) => {
    const { cwd, run, stdout } = fixture(t, setup);
    const launcher = join(cwd, 'entry-launcher.mjs');
    writeFileSync(launcher, `const m = ${importFile}; m.main();\n`);
    const result = run([launcher]);
    assert.equal(result.status, 0, result.stderr);
    assertOutput(result.stdout, stdout);
  });
}
