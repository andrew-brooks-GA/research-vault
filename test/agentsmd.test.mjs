import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadSchema } from '../bin/lib/schema.mjs';
import { generateAgentsMd } from '../bin/lib/agentsmd.mjs';

test('generates AGENTS.md containing schema-derived content, no BOM, single offline rule', () => {
  const md = generateAgentsMd(loadSchema(process.cwd()));
  assert.equal(md.charCodeAt(0), 0x23); // '#'
  assert.match(md, /software-engineering/);
  assert.match(md, /refresh window/i);
  // offline rule must allow inferred-stable AND human-spot-check (no contradiction)
  assert.match(md, /inferred-stable.*human-spot-check|human-spot-check.*inferred-stable/s);
  assert.ok(!/﻿/.test(md));
});

test('AGENTS.md introduces every artifact type and the distillation lifecycle', () => {
  const md = generateAgentsMd(loadSchema(process.cwd()));
  assert.match(md, /Artifact types/);
  for (const folder of ['sources/', 'notes/', 'synthesis/', 'snippets/', 'experiments/', 'questions/']) {
    assert.ok(md.includes('`' + folder + '`'), `AGENTS.md should describe ${folder}`);
  }
  assert.match(md, /distill/i);
});
