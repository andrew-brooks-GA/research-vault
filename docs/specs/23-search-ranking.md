# Spec 23: `search --sort authority|fresh` and the tier and freshness annotation (issue #9)

Plan for issue #9, titled "01. Authority + freshness ranking in search" on GitHub, at c59648e. The issue body is the one rescoped on 2026-11-02 and gated in `docs/specs/issues-2026-11-02-remaining.md`, whose issue 9 section matches the body on GitHub (2026-11-02-lines-behind-issue-9-search-ranking, round 1 additions, the GitHub title and body and the gated section); this plan turns its "What remains" paragraph into the executable list. The repo lines named here are quoted in two snippets: 2026-11-02-nine-remaining-issues-at-research-vault (search, stale, the manifest row, the taxonomy, capture's source branch, at a0f6c91) and 2026-11-02-lines-behind-issue-9-search-ranking (the search `run`, `listStale`, the argument parser, the `--now` convention, the REFERENCE row, the usage skill line, the command file, the coupling rows, the search tests, the `matchRows` callers, the top-level handler, capture's defaults, the volatility windows, `lastVerified`, the golden AGENTS.md `search` rows, the agent frontmatter, at c59648e). The search, stale, manifest, fsutil, capture, taxonomy, args, REFERENCE, usage skill, command and search test files have no commit between a0f6c91 and c59648e (2026-11-02-lines-behind-issue-9-search-ranking, round 1 additions, the `git log` count). Where a sentence says what a command does, it is read from the quoted code, not from a run.

## What exists

- `search` filters manifest rows by type, domain, series, topic through the aliases, and text over title, topics and summary in `matchRows`, drops superseded rows unless `includeSuperseded`, optionally filters by body, and `run` prints each row as `<id>  [<type>]  <title>` with a ` (superseded by <id>)` suffix when the row is superseded, or the rows as JSON with `--json` (2026-11-02-nine-remaining-issues-at-research-vault, `search.mjs` lines 1 to 45; 2026-11-02-lines-behind-issue-9-search-ranking, `search.mjs` lines 36 to 43). No line of `search.mjs` holds `sort`, `rank`, `authority` or `last_verified` (2026-11-02-nine-remaining-issues-at-research-vault, the grep count section).
- Under `bin` and `test`, `matchRows` is called by `searchVault`, by `pathCandidates` in `bin/lib/lesson.mjs` with `topic` and `text` queries over one manifest, and by the equivalence test in `test/search.test.mjs` (2026-11-02-lines-behind-issue-9-search-ranking, the `matchRows` grep, the `pathCandidates` header, `lesson.mjs` lines 600 to 610).
- Every manifest row carries `authority_tier`, `authority_basis` and `volatility`, each `null` when the entry has none, and `last_verified`, the latest date of a verification whose result is `confirmed` or `changed-trivially`, or `null` when there is none; the `captured` seed verification carries `confirmed`, so capture-time freshness counts (2026-11-02-nine-remaining-issues-at-research-vault, `manifest.mjs` lines 28 to 46; 2026-11-02-lines-behind-issue-9-search-ranking, `manifest.mjs` lines 14 to 22). `capture` sets `authority_tier` only in its source branch and only when `opts.authorityTier` is set (the CLI's `--authority-tier`) (2026-11-02-nine-remaining-issues-at-research-vault, `capture.mjs` lines 67 to 76), and defaults `volatility` to `slow` for every type (2026-11-02-lines-behind-issue-9-search-ranking, `capture.mjs` lines 58 to 66).
- The tier order is the taxonomy array `primary`, `secondary`, `tertiary` (2026-11-02-nine-remaining-issues-at-research-vault, `taxonomy.json` line 27).
- `staleness(entry, schema, now)` in `bin/lib/stale.mjs` returns `null` when the entry's volatility has no window, an object with `reason` for a zero window or no `last_verified`, an object with `ageDays` when the age exceeds the window, and `false` otherwise; `listStale` takes `opts.now` and defaults it to today's date (2026-11-02-lines-behind-issue-9-search-ranking, `stale.mjs` lines 8 to 28). The windows are 1095, 365, 90 and 0 days for `stable`, `slow`, `fast` and `volatile` (2026-11-02-lines-behind-issue-9-search-ranking, `taxonomy.json` lines 15 to 20).
- `parseArgs` treats a `--flag` as boolean only when its name is in the `BOOL` set; otherwise the next token is its value, or `undefined` when there is none or it starts with `--` (2026-11-02-lines-behind-issue-9-search-ranking, `args.mjs` lines 1 to 19). `check` reads `args.now` with today's date as the fallback (2026-11-02-lines-behind-issue-9-search-ranking, `check.mjs` line 109). An error thrown from a command's `run` is printed as `error: <message>` on stderr with exit code 2 (2026-11-02-lines-behind-issue-9-search-ranking, `research-vault.mjs` lines 29 to 36).
- The `search` row of `docs/REFERENCE.md` lists the flags and the superseded rule (2026-11-02-lines-behind-issue-9-search-ranking, REFERENCE line 180); line 10 of the usage skill tells the agent to read `authority` and `superseded_by` on the returned nodes before opening a body (2026-11-02-lines-behind-issue-9-search-ranking, usage skill line 10); `commands/research-search.md` carries an `argument-hint` of three flags (2026-11-02-lines-behind-issue-9-search-ranking, the command file). `COUPLINGS` rows in `scripts/deps.mjs` are `[from, to, why]` or `[from, to, why, literal]` (2026-11-02-lines-behind-issue-9-search-ranking, `deps.mjs` lines 22 to 31).
- `test/search.test.mjs` asserts the text line format through a `cli` helper that captures `process.stdout.write`, and that `matchRows` equals `searchVault` for three queries (2026-11-02-lines-behind-issue-9-search-ranking, `search.test.mjs` lines 73 to 108).

## Decisions

### D0. Contracts kept

1. The default order is unchanged: without `--sort`, rows come out in manifest order, as today (2026-11-02-nine-remaining-issues-at-research-vault, `search.mjs` lines 1 to 45).
2. `--json` rows keep their shape. The row already carries `authority_tier`, `volatility` and `last_verified`, so a JSON reader has the signals; `--sort` reorders the JSON array and adds no key.
3. `matchRows` is untouched, so `teach path candidates` is unchanged.
4. No manifest key, no frontmatter field, no schema change. The tier order is read from `schema.taxonomy.authority_tier`, not copied.

### D1. The option: `--sort authority|fresh`

`sort` is not added to `BOOL`, so `--sort authority` parses as the value `authority`. `searchVault` takes `q.sort` and `q.now`; `run` passes `args.sort` and `args.now` (the `check` convention, for tests); a bare `--sort` with no value parses as `undefined`, the same as no flag, so it sorts nothing. A `--sort` value other than `authority` or `fresh` throws `--sort must be authority or fresh`, which the top-level handler prints as `error: --sort must be authority or fresh` with exit code 2.

The sort runs after every filter, including `--body` and the superseded gate, as one exported pure function `sortRows(rows, by, schema, now)` in `search.mjs` that returns a new array and reads no file.

### D2. `authority`

Each row's key is the index of its `authority_tier` in `schema.taxonomy.authority_tier`; a row whose tier is `null` or not in the array gets the array's length, so it sorts after every tiered row. Rows with the same key keep their incoming order, which is manifest order; a test pins this. So `primary` sources come first, then `secondary`, then `tertiary`, then every untiered row (sources captured with no `authorityTier`, and every note, synthesis, snippet, experiment and question that `capture` wrote) in manifest order, which is what the issue's "What remains" paragraph asks (2026-11-02-lines-behind-issue-9-search-ranking, round 1 additions).

### D3. `fresh`

Each row's key is from `staleness(row, schema, now)`: `false` (fresh) is 0, an object (stale, whether by age or by reason) is 1, `null` (not assessable) is 2. Rows with the same key keep their incoming order; a test pins this. Stale rows are not ordered by `ageDays` among themselves: a `reason` row has no age, and the issue's "What remains" paragraph asks only that `fresh` order by `staleness()` with not-assessable rows last (2026-11-02-lines-behind-issue-9-search-ranking, round 1 additions). `now` is `q.now` parsed as a date, else today, as `listStale` does.

### D4. The annotation, text output only

Each printed row becomes `<id>  [<type>]  <title>  (<tier>, <freshness>)` followed by the superseded suffix when there is one, where `<tier>` is the row's `authority_tier` or `no tier`, and `, <freshness>` is `, fresh` when `staleness` returns `false`, `, stale` when it returns an object, and absent when it returns `null`. Examples:

```text
2026-01-01-k8s-docs  [source]  K8s docs  (primary, fresh)
2026-01-02-note  [note]  Note  (no tier, stale)
2026-01-02-old  [source]  Old  (secondary, fresh) (superseded by 2026-01-03-new)
```

The annotation is printed with or without `--sort`, so the choice is informed when the list is unsorted. Since `capture` defaults `volatility` to `slow`, an entry captured without `--volatility` is `fresh` or `stale`, never unannotated; the unannotated case is an entry whose volatility is absent or outside the taxonomy.

### D5. Documents that restate the command

- `docs/REFERENCE.md` line 180: add `--sort authority|fresh` (tier order from the taxonomy, untiered rows last; fresh, then stale, then not assessable) and the `(<tier or no tier>, fresh|stale)` annotation to the `search` row.
- `skills/research-vault-usage/SKILL.md` line 10: one sentence after "`search` hides superseded entries unless `--include-superseded`": `--sort authority` or `--sort fresh` orders the hits by the row's tier or its freshness, and each text line ends with the tier (or `no tier`) and `fresh` or `stale`.
- `commands/research-search.md`: `[--sort authority|fresh]` added to `argument-hint`.
- `scripts/deps.mjs`: one `COUPLINGS` row, `['bin/commands/search.mjs', 'docs/REFERENCE.md', 'the --sort values and the no tier / fresh / stale annotation words', 'no tier']`.
- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Added`.
- Not changed: the generated vault `AGENTS.md` and its §5.2 routing table. Its two `search` rows name `--text`, `--body`, `--json` and `--include-superseded`, which keep their meaning (2026-11-02-lines-behind-issue-9-search-ranking, the golden AGENTS.md `search` rows); a routing row for "which hit to cite" is added when a session shows an agent choosing a stale or tertiary hit despite the annotation.

### D6. Tests, in `test/search.test.mjs`

1. `sortRows` over synthetic rows: tiers `[tertiary, null, primary, secondary, null]` with `by = 'authority'` give `[primary, secondary, tertiary, null, null]` with the two nulls in their incoming order.
2. `sortRows` with `by = 'fresh'` over rows with volatility `stable` verified yesterday (fresh), `fast` verified 100 days ago (stale), `volatile` (stale by reason), no volatility (null) and `slow` verified yesterday (fresh), in that order, give fresh, fresh, stale, stale, null, each bucket in incoming order.
3. `sortRows` with another value throws the D1 message.
4. Through `searchVault` on a temporary vault: three sources captured with `--authority-tier` `tertiary`, none and `primary`, in that id order, come out `[primary, tertiary, none]` with `sort: 'authority'`, and in id order without `sort`.
5. Through the `cli` helper: the text line carries `(primary, fresh)` for a tiered source captured today and `(no tier, fresh)` for a note captured today, both fresh through the `captured` seed verification; with `--include-superseded` the superseded row's annotation precedes its suffix.

## Execution

One person, no sub-agents for the code: the change in `search.mjs` is one new function (`sortRows`), the `sort` and `now` query keys and the `--sort` check in `searchVault`, and `run`'s call and line format with the schema and date that `staleness` needs; plus five tests and five document lines. The one subagent is the fresh `research-vault:claims-reviewer` of the `research-claims-gate` skill (2026-11-02-lines-behind-issue-9-search-ranking, the agent frontmatter and the skill's dispatch line) this plan goes through before any code is written, and again for the CHANGELOG and REFERENCE lines if they are gated. The order: this plan gated; `search.mjs`; tests, run with `npm test`; the D5 lines; `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`; one commit on a branch, not pushed.

## Done when

The two sorts and the annotation exist and the default output is unchanged apart from the annotation, as the last sentence of the issue's "What remains" paragraph says (2026-11-02-lines-behind-issue-9-search-ranking, round 1 additions); `npm test` passes with the five tests; the four pre-commit checks pass; the issue gets a comment naming the commit.
