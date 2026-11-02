# Spec 27: `refresh --json` with `storedBody`, and the verify skill's diff step (issue #7)

Plan for issue #7, titled "05. Change-diff on refresh: show what changed, not just that it changed" on GitHub, at 23639cc on master, with a clean working tree (2026-11-02-repo-lines-behind-issue-7-refresh, the status line and the log line). The issue body is the one rescoped on 2026-11-02 at a0f6c91; this plan turns its "What remains" paragraph into the executable list (2026-11-02-repo-lines-behind-issue-7-refresh, the GitHub title and body). Every repo line named here is quoted in that snippet at 23639cc. Where a sentence says what a command does, it is read from the quoted code, not from a run.

## What exists

- `refreshVault(vaultPath, opts)` takes `opts.fetch` (default `fetchSource`) and `opts.targets` (default `gather`, the stale fetchable sources, or the one `--id`), and for each target resolves `{ id, result: 'unreachable', detail }` on a status of 400 or more or a thrown fetch, `{ id, result: 'confirmed' }` on a matching hash, else `{ id, result: 'changed', detail: 'run verify' }`; the word `diff` occurs in neither `refresh.mjs` nor `fetchsource.mjs` (2026-11-02-repo-lines-behind-issue-7-refresh, `refresh.mjs` lines 31 to 48, the `diff` grep). `run` returns 1 unless `RESEARCH_VAULT_ALLOW_NETWORK` is `1` (the dispatcher sets the return as the process exit code; SECURITY says non-zero exit), resolves the vault, gathers targets for `args.id`, prints `would-fetch` lines under `--dry-run`, else calls `refreshVault(vaultPath, { targets })` and prints one text line per result; it reads no `--json` and passes no `fetch` (2026-11-02-repo-lines-behind-issue-7-refresh, `refresh.mjs` lines 50 to 66, the dispatcher lines 29 to 36). `json` is in `parseArgs`'s `BOOL` set (2026-11-02-repo-lines-behind-issue-7-refresh, `args.mjs` line 1).
- `fetchSource`'s response handler buffers the body up to `MAX_BODY` only to hash it and resolves `{ status, hash }` (2026-11-02-repo-lines-behind-issue-7-refresh, `fetchsource.mjs` lines 1 to 20 and 50 to 70). `SECURITY.md` says `refresh` is hash-only and never mutates (2026-11-02-repo-lines-behind-issue-7-refresh, SECURITY lines 31 to 43).
- `capture --store-body` appends the given content to a source's body after the title line and optional skeleton, and `prepareEntry` throws unless `--ack-data-egress` accompanies it (2026-11-02-repo-lines-behind-issue-7-refresh, `capture.mjs` lines 20 to 30 and 99 to 112). `isStubBody` in `advise.mjs` is true for a body with no line other than blanks, a lone `-`, a heading or a bare fence; it is declared as a `const` at line 10 with no `export`, and `listStubBodies` applies it to every type except `source` (2026-11-02-repo-lines-behind-issue-7-refresh, `advise.mjs` lines 10 to 22, the `isStubBody` grep). `readEntry(absPath)` returns an object carrying `id`, `folder`, `data`, `body`, `hasBom` and `hasCrlf` and `TYPE_FOLDER.source` is `sources` (2026-11-02-repo-lines-behind-issue-7-refresh, `fsutil.mjs` lines 1 to 31).
- The research-verify skill names `refresh` nowhere; no file under `commands/` or `skills/` names the command (2026-11-02-repo-lines-behind-issue-7-refresh, the verify skill lines 1 to 15, the `refresh` grep over `commands/` and `skills/`). REFERENCE's `refresh` row says it reports `confirmed`, `changed` or `unreachable` per source, never edits entries, and needs the env flag; the `scripts/deps.mjs` row at line 111 ties `refresh.mjs` to SECURITY by `RESEARCH_VAULT_ALLOW_NETWORK` and `--dry-run` (2026-11-02-repo-lines-behind-issue-7-refresh, the REFERENCE grep, the `deps.mjs` grep).
- `test/refresh.test.mjs` has `freshVault()` (a copy of the fixture vault), `sourceTarget(dir)` (its first source row with a `source_url`); the fixture source `2026-01-01-a` has the body `# A`, one line, `handWriteStaleSource`, and tests that call `refreshVault(dir, { targets: [e], fetch })` with a fake `fetch` and `run({ vault: dir, fetch })` with the env flag deleted (2026-11-02-repo-lines-behind-issue-7-refresh, `refresh.test.mjs` lines 1 to 60 and 92 to 150, the fixture source file). The snippet's `npm test` tail reads 498 tests, 498 pass (2026-11-02-repo-lines-behind-issue-7-refresh, the `npm test` summary lines).

## Decisions

### D0. Contracts kept

1. `SECURITY.md` stays as it is: `refresh` keeps no fetched bytes beyond the hash, does no text conversion and writes nothing. The diff is the agent's step, as the issue's narrowed route says.
2. The text output of `refresh` is unchanged; `--json` is additive.
3. `storedBody` is read for `changed` results only, as the issue says: the entry file is opened only when there is something to diff.

### D1. `storedBody` and `--json`

`advise.mjs` exports `isStubBody`. `refreshVault`, for a `changed` outcome, reads the entry at `join(vaultPath, TYPE_FOLDER.source, id + '.md')` with `readEntry` and sets `storedBody` to `!isStubBody(body)`; `confirmed` and `unreachable` outcomes carry no `storedBody` key. `run` passes `fetch: args.fetch` through to `refreshVault` only when it is a function (the refusal test already hands `run` one), and with `--json` prints `JSON.stringify(results, null, 2)` instead of the text lines; `--dry-run` and the refusal are unchanged.

### D2. The verify skill's step

`skills/research-verify/SKILL.md` gains one paragraph after line 6: `refresh --json` lists each fetched source as `{ id, result, detail?, storedBody? }`, `storedBody` present on `changed` results; `true` means the entry's body holds a line other than blanks, a lone `-`, headings or a bare fence (stored text, if any, is such a line), so fetch the page as for any verification, diff its extracted text against the stored body, write the delta in the verification's notes (`verify --notes`, read as `args.notes`: 2026-11-02-repo-lines-behind-issue-7-refresh, `verify.mjs` lines 93 to 100), then confirm (`changed-trivially` or `confirmed`) or supersede; with `storedBody: false` there is nothing to diff against, so verify from the page alone and say so in the notes.

### D3. Documents that restate the behaviour

- `docs/REFERENCE.md`: the `refresh` row gains "`--json` prints one object per result, `{ id, result, detail?, storedBody? }`; `storedBody`, on a `changed` result, says whether the entry's body holds a line other than blanks, a lone `-`, headings or a bare fence (stored text, if any, is such a line) to diff against".
- `scripts/deps.mjs`: two `COUPLINGS` rows tie `refresh.mjs` to the verify skill and to REFERENCE by the `--json` result keys, literal `storedBody`.
- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Added`.
- Not changed: `SECURITY.md`, `fetchsource.mjs`, the generated vault `AGENTS.md`, the `commands/` files.

### D4. Tests

`test/refresh.test.mjs`: on a `freshVault()`, with `fetch` returning `{ status: 200, hash: 'sha256:deadbeef' }`, `refreshVault(dir, { targets: [buildManifest(dir).entries.find(e => e.id === '2026-01-01-a')], fetch })` gives a `changed` result with `storedBody` `false` (that source's body is the one line `# A`); after `writeEntry` rewrites that source with a body holding a paragraph of prose, the same call gives `storedBody` `true`; with `fetch` returning the entry's own `content_hash` the `confirmed` result has no `storedBody` key. With `RESEARCH_VAULT_ALLOW_NETWORK` set to `1` for the call and restored after, `run({ vault: dir, id: <that id>, json: true, fetch })` returns 0 and its captured stdout parses as an array of one object with `id`, `result` `changed` and `storedBody` `true`.

## Execution

One person, no sub-agents for the code: one export in `advise.mjs`, one read and one key in `refreshVault`, one branch in `run`, the tests, the skill paragraph and the document lines. The one subagent is a fresh claims review through the `research-claims-gate` skill (`AGENTS.md`), for this plan before any code is written and for the REFERENCE row after. The order: this plan gated; the code; the tests, run with `npm test`; the D2 and D3 lines; `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`; one commit on master, not pushed.

## Done when

`refresh --json` prints the four fields and the verify skill names the step and the field it keys on, which is what the issue's "Done when" sentence asks (2026-11-02-repo-lines-behind-issue-7-refresh, the GitHub body); `npm test` passes with the new tests; the four other checks `AGENTS.md` lists pass.
