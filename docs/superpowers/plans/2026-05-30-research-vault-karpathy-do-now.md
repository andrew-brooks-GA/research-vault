# Karpathy "Do-Now" Changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the three design-consistent "Do-now" changes from the Karpathy/research-vault evaluation: a missing coverage test, a spec/code contradiction fix, and a zero-dependency body-search mode.

**Architecture:** Three independent tasks against the existing zero-dependency Node CLI. Task 1 is a characterization test (asserts already-correct behavior). Task 2 is a documentation-only edit. Task 3 is a real feature added TDD-style entirely within `bin/commands/search.mjs` plus its test — it reuses `walkEntries`/`readEntry` from `bin/lib/fsutil.mjs`, adds no dependency, and reads entry bodies on demand only when `--body` is passed.

**Tech Stack:** Node ≥18, ESM, `node:test` (no test framework), stdlib only.

**Scope:** ONLY the three tasks below. The "Consider next / external / optional" items from the evaluation (richer ingest, Obsidian, advisory librarian, finetuning, auto-compile staging) are explicitly OUT of scope.

**Commits:** Andrew prefers the `/commit` workflow. A subagent without it may use `git commit` with the message shown. Branch off `master` first (e.g. `feat/karpathy-do-now`); do not commit on `master`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `test/lint.test.mjs` | Lint rule + `lint --check` behavior tests | Modify — add a populated-vault `MANIFEST_STALE` test + a `freshVault` helper |
| `docs/superpowers/specs/2026-05-27-research-vault-plugin-design.md` | Design spec | Modify — correct the §9.3 capture-body description; record the scaffold as deferred |
| `bin/commands/search.mjs` | `search` command (facet/text query over the manifest) | Modify — add an opt-in `--body` substring filter |
| `test/search.test.mjs` | `search`/`related` tests | Modify — add a `--body` test + a `freshVault` helper |

---

## Task 1: Cover `MANIFEST_STALE` on a populated vault

Closes the gap where `lint --check`'s manifest-staleness path is exercised in CI only against a freshly-`init`'d empty vault. The behavior already exists (`bin/commands/lint.mjs:13-16`); this test pins it on a vault that has entries.

**Files:**
- Modify: `test/lint.test.mjs`

- [ ] **Step 1: Add imports and a `freshVault` helper at the top of the file**

Add these imports alongside the existing ones, and the helper after the `BAD` constant:

```javascript
import { mkdtempSync, cpSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintAndReport } from '../bin/commands/lint.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-lint-')), 'v');
  cpSync(GOOD, dir, { recursive: true });
  return dir;
}
```

(`GOOD` already points at `./fixtures/vault` via `fileURLToPath`.)

- [ ] **Step 2: Add the test at the end of the file**

```javascript
test('lint --check flags MANIFEST_STALE after an out-of-band entry edit on a populated vault', () => {
  const dir = freshVault();
  // Make the on-disk manifest match reality, then confirm it is clean under --check.
  lintAndReport(dir, { check: false });
  assert.ok(
    !lintAndReport(dir, { check: true }).violations.some(v => v.code === 'MANIFEST_STALE'),
    'a freshly-rebuilt manifest must be clean under --check',
  );

  // Simulate a non-tooling writer editing an entry without rebuilding the manifest.
  const f = join(dir, 'sources', '2026-01-01-a.md');
  const original = readFileSync(f, 'utf8');
  const edited = original.replace(/^title:.*/m, 'title: Edited Out Of Band');
  assert.notEqual(edited, original, 'precondition: the entry had a title line to edit');
  writeFileSync(f, edited, 'utf8');

  const res = lintAndReport(dir, { check: true });
  assert.ok(
    res.violations.some(v => v.code === 'MANIFEST_STALE'),
    'an out-of-band entry edit must make lint --check report MANIFEST_STALE',
  );
});
```

- [ ] **Step 3: Run the test**

Run: `node --test test/lint.test.mjs`
Expected: PASS — all tests in the file pass, including the new one. (`lint --check` with `{check: true}` only reads and compares; it never rebuilds, so the stale manifest is genuinely detected.)

- [ ] **Step 4: Commit**

```bash
git add test/lint.test.mjs
git commit -m "test: cover MANIFEST_STALE on a populated vault"
```

---

## Task 2: Correct the §9.3 spec/code contradiction

The spec says `capture` "scaffolds the body from the matching prompt template," but `bin/commands/capture.mjs:76` writes only `# <title>`. Align the spec to reality and record the scaffold as a deferred, opt-in idea. Documentation only — no code, no test.

**Files:**
- Modify: `docs/superpowers/specs/2026-05-27-research-vault-plugin-design.md`

- [ ] **Step 1: Read §9.3 to confirm the exact wording**

Run: `grep -n "scaffolds the body" docs/superpowers/specs/2026-05-27-research-vault-plugin-design.md`
Expected: one match inside the "### 9.3 `capture`" subsection.

- [ ] **Step 2: Fix the capture-body clause**

Replace the exact substring:

```
scaffolds the body from the matching prompt template,
```

with:

```
writes only an `# <title>` heading as the body (no template scaffolding is implemented),
```

- [ ] **Step 3: Record the scaffold as deferred**

In "## 12. Deferred / future (out of scope for v1)", replace:

```
- `sqlite-vec` semantic-search MCP (§5.4).
```

with:

```
- `sqlite-vec` semantic-search MCP (§5.4).
- Opt-in `capture` body-template scaffold seeding entries from `meta/prompt-templates/*` (§9.3).
```

- [ ] **Step 4: Verify the contradiction is gone**

Run: `grep -n "scaffolds the body from the matching prompt template" docs/superpowers/specs/2026-05-27-research-vault-plugin-design.md`
Expected: no matches.

> NOTE (out of scope): §9.3 also still says capture "updates folder + root `INDEX.md`," which `init` no longer creates. That is a *separate* drift; do not fix it in this plan.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-05-27-research-vault-plugin-design.md
git commit -m "docs: correct §9.3 capture-body description to match implementation"
```

---

## Task 3: Add a zero-dependency `--body` search mode

`search --text` matches title + topics only (`bin/commands/search.mjs:18`). Add an opt-in `--body <term>` that substring-matches entry bodies. `--body` parses as a value flag automatically (it is NOT in the `BOOL` set in `bin/lib/args.mjs`), so no arg-parser change is needed. Bodies are read on demand via `walkEntries`/`readEntry` only when `--body` is supplied.

**Files:**
- Modify: `bin/commands/search.mjs`
- Test: `test/search.test.mjs`

- [ ] **Step 1: Write the failing test**

Add these imports to `test/search.test.mjs` (alongside the existing ones) and a `freshVault` helper after the `VAULT` constant:

```javascript
import { mkdtempSync, cpSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { captureEntry } from '../bin/commands/capture.mjs';

function freshVault() {
  const dir = join(mkdtempSync(join(tmpdir(), 'rv-search-')), 'v');
  cpSync(VAULT, dir, { recursive: true });
  return dir;
}
```

Then add the test at the end of the file:

```javascript
test('search --body matches entry body text, not just title/topics', () => {
  const dir = freshVault();
  const r = captureEntry(dir, {
    type: 'note', title: 'Plain Title', sources: '2026-01-01-a',
    confidence: 'high', now: '2026-05-30', repoRoot: process.cwd(),
  });
  appendFileSync(r.path, 'The syncer shares the host APF bucket under contention.\n');

  const hit = searchVault(dir, { body: 'apf bucket' });
  assert.ok(hit.some(e => e.id === r.id), '--body finds the appended body phrase');

  const miss = searchVault(dir, { body: 'no such phrase zzz' });
  assert.ok(!miss.some(e => e.id === r.id), '--body excludes entries without the phrase');

  const viaText = searchVault(dir, { text: 'apf bucket' });
  assert.ok(!viaText.some(e => e.id === r.id), 'title/topic --text must NOT match body-only text');
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test test/search.test.mjs`
Expected: FAIL on `--body excludes entries without the phrase` — without the feature, `q.body` is ignored, so `searchVault` returns every entry and the `miss` assertion fails.

- [ ] **Step 3: Add the `fsutil` import to `bin/commands/search.mjs`**

Replace:

```javascript
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { resolveVault } from '../lib/resolve.mjs';
```

with:

```javascript
import { loadSchema } from '../lib/schema.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { walkEntries, readEntry } from '../lib/fsutil.mjs';
import { resolveVault } from '../lib/resolve.mjs';
```

- [ ] **Step 4: Add the body filter in `searchVault`**

Replace:

```javascript
  if (q.text) { const t = q.text.toLowerCase(); rows = rows.filter(e => (e.title || '').toLowerCase().includes(t) || e.topics.join(' ').includes(t)); }
  return rows;
```

with:

```javascript
  if (q.text) { const t = q.text.toLowerCase(); rows = rows.filter(e => (e.title || '').toLowerCase().includes(t) || e.topics.join(' ').includes(t)); }
  if (q.body) {
    const needle = q.body.toLowerCase();
    const bodyById = new Map();
    for (const abs of walkEntries(vaultPath)) { const e = readEntry(abs); bodyById.set(e.id, (e.body || '').toLowerCase()); }
    rows = rows.filter(e => (bodyById.get(e.id) || '').includes(needle));
  }
  return rows;
```

- [ ] **Step 5: Wire `--body` through `run`**

Replace:

```javascript
  const rows = searchVault(vaultPath, { type: args.type, domain: args.domain, topic: args.topic, series: args.series, text: args.text });
```

with:

```javascript
  const rows = searchVault(vaultPath, { type: args.type, domain: args.domain, topic: args.topic, series: args.series, text: args.text, body: args.body });
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/search.test.mjs`
Expected: PASS — all tests pass.

- [ ] **Step 7: Run the full suite for regressions**

Run: `node --test`
Expected: PASS — entire suite green (no other command depends on `searchVault`'s signature; `body` is an additive optional field).

- [ ] **Step 8: Commit**

```bash
git add bin/commands/search.mjs test/search.test.mjs
git commit -m "feat: add zero-dependency search --body substring mode"
```

---

## Self-Review

**Spec coverage** (against the three "Do-now" items):
- MANIFEST_STALE populated-vault test → Task 1. ✓
- §9.3 spec/code contradiction → Task 2 (chose the spec-edit fix; scaffold recorded as deferred). ✓
- Zero-dependency body search → Task 3. ✓

**Placeholder scan:** No TBD/TODO; every code and command step shows literal content. ✓

**Type/name consistency:** `searchVault` gains an optional `body` field used identically in `run` (Step 5) and the filter (Step 4); `freshVault` is defined locally in each test file it's used in (Task 1 copies `GOOD`, Task 3 copies `VAULT`); `lintAndReport(dir, {check})` matches its export in `bin/commands/lint.mjs`. ✓

**Guardrails honored:** body search stays substring/non-semantic with no index file (does not drift into the deferred §5.4 layer); the MANIFEST_STALE test induces drift by a direct out-of-band file edit and asserts detection *before* any rebuild. ✓