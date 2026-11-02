# Spec 28: `nearDuplicates` in `advise` by host and path or by title terms (issue #11)

Plan for issue #11, titled "06. Near-duplicate source detection" on GitHub, at 75fa96d on master with a clean working tree (2026-11-02-lines-behind-issue-11-near-duplicates, the status line and the log line). The issue body is the one rescoped on 2026-11-02 at a0f6c91; this plan turns its "What remains" paragraph into the executable list (2026-11-02-lines-behind-issue-11-near-duplicates, the GitHub title and body). Every repo line named here is quoted in that snippet at 75fa96d, its round 1 additions included. Where a sentence says what a command does, it is read from the quoted code, not from a run.

## What exists

- A manifest row carries `id`, `type`, `title`, `status` (default `active`) and `source_url` normalised through `normalizeUrlSafe`; rows are sorted by id (2026-11-02-lines-behind-issue-11-near-duplicates, `manifest.mjs` lines 24 to 47 and, in the round 1 additions, lines 55 to 56). `normalizeUrl` lower-cases the protocol and host, drops tracking parameters and a trailing `?` or `/`, and keeps other query strings (2026-11-02-lines-behind-issue-11-near-duplicates, `ids.mjs` lines 16 to 31).
- `advise` returns eleven keys; `listSupersedeSuspects` pairs non-superseded rows of one type at one subject version that share a `source_url` or a subject name, older first, as `{ older, newer, by }` (2026-11-02-lines-behind-issue-11-near-duplicates, `advise.mjs` lines 93 to 133). The command prints the suspects line last, as `supersede suspects (<n>): <older> -> <newer> (<by>)` (2026-11-02-lines-behind-issue-11-near-duplicates, the command file lines 1 to 28).
- The pre-web hook's `STOP` set and term extraction live at its lines 9 and 15: the query text lower-cased, URLs blanked, split on anything outside `[a-z0-9_.-]`, terms shorter than three characters and stop words dropped, deduplicated, cut to twelve; the hook scores an entry by how many terms its title, topics and summary contain (2026-11-02-lines-behind-issue-11-near-duplicates, `pre-web.mjs` lines 1 to 35). `STOP` occurs only there under `bin` and `hooks`; `ids.mjs` has its own smaller `STOPWORDS` for `slugify` (2026-11-02-lines-behind-issue-11-near-duplicates, the `STOP` grep, `ids.mjs` lines 1 to 14). None of `jaccard`, `shingl`, `near-dup`, `levenshtein` or `similar` occurs under `bin` or `hooks` (2026-11-02-lines-behind-issue-11-near-duplicates, the similarity grep).
- `verify --result outdated --superseded-by <id>` sets `status: superseded` and `superseded_by` (2026-11-02-lines-behind-issue-11-near-duplicates, `verify.mjs` lines 48 to 60).
- The librarian skill says eleven sections, lists them with **supersede suspects** at line 17, and has the judging step at line 18; `COUPLINGS` rows 124 and 125 tie `advise.mjs` to the skill ("'eleven sections', their list and OPEN_QUESTION_DAYS as 60 days") and to REFERENCE; REFERENCE line 184 is the `advise` row (2026-11-02-lines-behind-issue-11-near-duplicates, the librarian skill lines 1 to 20, the `deps.mjs` grep, the REFERENCE grep). The pre-web hook is registered on `WebFetch|WebSearch` (2026-11-02-lines-behind-issue-11-near-duplicates, `hooks.json` lines 31 to 46).
- `test/preweb.test.mjs` calls `vaultContext(v, 'WebSearch', { query })` on a `tmpVault` built with `put` and asserts on the returned text; `test/advise.test.mjs` imports `advise`, `put`, `tmpVault`, `execFileSync`, `applyVerification` and the command's `run`, and the spec 26 test is the shape to follow (2026-11-02-lines-behind-issue-11-near-duplicates, `preweb.test.mjs` lines 1 to 20, `advise.test.mjs` lines 1 to 15 and the spec 26 test, `helpers.mjs` lines 12 to 26).

## Decisions

### D0. Contracts kept

1. Advisory only: a new `advise` key, nothing in `lint --check`, no merge; the agent resolves a pair with the existing `verify` call, as the issue says.
2. A pair whose two normalised `source_url` values are equal is listed by neither key here: at one subject version it is a supersede suspect (spec 26), and at different versions it is the succession the verify skill prescribes.
3. The pre-web hook's output is unchanged: its term extraction moves to a shared module and the hook calls it.
4. Body shingling, the issue's second pass, is not built: it needs a body read per source, and the two manifest-only signals ship first. A dismissal mark for a pair judged distinct is the issue's open question and stays open; such a pair stays listed.

### D1. `terms.mjs` and `nearDuplicates`

`bin/lib/terms.mjs` exports `STOP` (the pre-web set, moved) and `termsOf(text)`: the hook's extraction without the cut to twelve, returning the deduplicated terms in first-occurrence order. `pre-web.mjs` imports both and computes `terms` as `termsOf(text).slice(0, 12)`.

`advise.mjs` gains `listNearDuplicates(m)`: over the manifest rows with `type` `source` and `status` other than `superseded`, every pair in row order (`older` first, rows being sorted by id) whose normalised `source_url` values differ, whatever their subject versions, with the first signal that holds: `url`, when both URLs parse, share a host, each has at least one path segment (the pathname split on `/`, empty parts dropped), and the segments of the older that also occur in the newer number more than half of the longer segment list; else `title`, when the two titles' `termsOf` lists share at least two terms and the shared terms number more than half of the longer list. Each pair is `{ older, newer, by }`. A URL that does not parse gives no `url` signal. `advise` returns it as a twelfth key, `nearDuplicates`. The scan is a pair loop like `listSupersedeSuspects`, under the same `ponytail:` note.

The command prints one more line after the suspects line: `near duplicates (<n>): <older> -> <newer> (<by>), ...`, or `—`.

### D2. The librarian's step

`skills/research-librarian/SKILL.md`: "twelve sections", a bullet **near duplicates** (pairs of live sources at different URLs on one host sharing more than half of the longer path's segments, or whose titles share at least two terms, more than half of the longer title's terms; older first with the signal), and one sentence added to the judging step at line 18: a near duplicate is judged the same way, and a pair that proves to be two distinct sources stays listed, since there is no dismissal mark yet.

### D3. Documents that restate the behaviour

- `docs/REFERENCE.md`: the `advise` row gains "near duplicates (two live sources at different URLs on one host sharing more than half of the longer path's segments, or whose titles share at least two terms, more than half of the longer title's terms)".
- `scripts/deps.mjs`: row 124 becomes "'twelve sections', their list and OPEN_QUESTION_DAYS as 60 days". `terms.mjs` reaches `pre-web.mjs` and `advise.mjs` by import, so no coupling row.
- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Added`.
- Not changed: `hooks.json`, the generated vault `AGENTS.md`, `lint`, the schema files.

### D4. Tests

1. `test/preweb.test.mjs` is unchanged and must still pass: the hook's text is the same after the move.
2. `test/advise.test.mjs`: on a `tmpVault`, `put` sources `2026-01-01-a` (title `Install guide for Linux`, url `https://docs.example.com/guide/install/linux`), `2026-02-01-b` (title `Second copy`, url `https://docs.example.com/guide/install/linux?v=2`, which `normalizeUrl` keeps as it is, so a different normalised URL on the same host with the same three segments), `2026-03-01-c` (title `Linux install guide, second edition`, url `https://other.example.com/guide/install/linux`, another host, and five title terms of which three are shared with `a`), `2026-04-01-d` (title `Unrelated post`, url `https://docs.example.com/guide/blog/post`, one shared segment, `guide`, of three) and `2026-05-01-e` (title `Install guide for Linux`, url `https://docs.example.com/guide/install/linux/`, which `normalizeUrl` turns into `a`'s URL by dropping the slash). Both readings follow `ids.mjs` lines 16 to 31: `v` is not a tracking key, and the trailing slash is dropped. `advise(dir, process.cwd()).nearDuplicates` deep-equals `[{ older: '2026-01-01-a', newer: '2026-02-01-b', by: 'url' }, { older: '2026-01-01-a', newer: '2026-03-01-c', by: 'title' }, { older: '2026-02-01-b', newer: '2026-05-01-e', by: 'url' }, { older: '2026-03-01-c', newer: '2026-05-01-e', by: 'title' }]`, and `a` and `e` appear together only under `supersedeSuspects`. After `applyVerification(dir, { id: '2026-01-01-a', method: 'cross-referenced', result: 'outdated', supersededBy: '2026-05-01-e', repoRoot: process.cwd() })` no pair names `a`. The CLI, run with `execFileSync` on `bin/research-vault.mjs advise --vault <dir>`, prints a line matching `/^near duplicates \(2\): 2026-02-01-b -> 2026-05-01-e \(url\), 2026-03-01-c -> 2026-05-01-e \(title\)$/m`.

## Execution

One person, no sub-agents for the code: one new module, two lines in the hook, one function and one key in `advise.mjs`, one printed line in the command, the test, and the document lines. The one subagent is a fresh claims review through the `research-claims-gate` skill (`AGENTS.md`), for this plan before any code is written and for the REFERENCE row after. The order: this plan gated; the code; the tests, run with `npm test`; the D2 and D3 lines; `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`; one commit on master, not pushed.

## Done when

`advise` lists pairs with their signal, a superseded pair drops out, and the librarian skill's section list and REFERENCE's `advise` row name the new section, which is what the issue's "Done when" sentence asks (2026-11-02-lines-behind-issue-11-near-duplicates, the GitHub body); `npm test` passes with the new test; the four other checks `AGENTS.md` lists pass.
