import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

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
