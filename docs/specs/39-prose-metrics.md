# Spec 39: `teach lint --prose`, sentences per block, average and longest (issue #46)

Plan for issue #46, titled "`teach lint --prose`: sentences per block, average and longest" on GitHub, at db4572f on master with a clean working tree (2026-11-02-lines-behind-issue-46-prose-metrics, the status line and the log line). The issue body is the one gated on 2026-11-02 in `docs/specs/issues-2026-11-02-lesson-presentation.md` at 4e2dc2c; this plan turns its "What remains" paragraph into the executable list (2026-11-02-lines-behind-issue-46-prose-metrics, the GitHub title and body). Every repo line named here is quoted in that snippet at db4572f, its round 1 additions included. Where a sentence says what a command does, it is read from the quoted code, not from a run.

## What exists

- `teach lint`'s handler in `bin/commands/teach.mjs`: with `--fix` it fixes record frontmatter and prints `fixed <n> record(s)`; it resolves the vault from the workspace, returns 2 when the vault is missing, calls `lintWorkspace(ws, ctx)`, prints `lint: clean` when there is no violation or one line per violation, then `warning <code>  <file>: <message>` per warning, and returns 1 only on a violation; `out` at line 18 writes its argument and a newline to stdout (2026-11-02-lines-behind-issue-46-prose-metrics, `teach.mjs` lines 1 to 12 and 34 to 54, the `const out` grep). The file imports `parseLesson` among the `lesson.mjs` exports (2026-11-02-lines-behind-issue-46-prose-metrics, `teach.mjs` line 12).
- In `bin/lib/lesson.mjs`, `textOf` strips tags and collapses whitespace (line 39), `listDir(dir, ext)` lists a directory's files with an extension, sorted (line 42), `parseLesson(html)` returns `{ blocks, quiz, cites, links }` with `blocks` the map `parseBlocks` builds from each `data-block` element, keyed by block name, its values carrying the element's `html` (line 85), and `lintWorkspace` lints every `.html` under `lessons` and `reference` through `listDir` (line 676); the spec 37 loop reads each block's `<p>` elements, `sources` excepted, with `<pre>` and `<code>` removed and `textOf` applied (2026-11-02-lines-behind-issue-46-prose-metrics, the export grep, `lesson.mjs` lines 39 to 50, the `parseLesson` block, the `parseBlocks` block, the time-word loop, the `lintWorkspace` block). `BOOL` is the set of flags the parser sets to `true` without consuming a value; `fix` is one of them (2026-11-02-lines-behind-issue-46-prose-metrics, `args.mjs` lines 1 to 19).
- Two tests assert `teach lint`'s exact stdout, `lint: clean\n`, with exit 0 (2026-11-02-lines-behind-issue-46-prose-metrics, `teach.test.mjs` lines 24 to 44 and 113 to 131). The skill's step 6 says to lint "until it prints `lint: clean`" (2026-11-02-lines-behind-issue-46-prose-metrics, the `SKILL.md` grep, line 88). REFERENCE's `teach` row says `teach lint [--fix] [workspace]` prints `lint: clean` followed by any warnings, or the findings, exit 1 on any non-warning finding (2026-11-02-lines-behind-issue-46-prose-metrics, the REFERENCE line 192 block). The issue says the project has measured prose only with an ad hoc script, first on 2026-11-01, citing spec 22's measured growth of `fact` (2026-11-02-lines-behind-issue-46-prose-metrics, the spec 22 grep, the issue body).
- Fixture 0001's `mission` block holds one `<p>`, with two sentences, `model` two, `fact` two and `example` two (the first count block also matched `<pre`; the node count in the round 1 additions is the one to read); the fixture reference doc's `note` block holds two `<p>`, each one sentence ending in a full stop; `test/lesson.test.mjs` has `FIX`, the fixture workspace path, and `copyFixture` (2026-11-02-lines-behind-issue-46-prose-metrics, the node paragraph counts, `0001-good.html` lines 15 to 40, `reference/good.html`, `lesson.test.mjs` lines 14 to 28). `deps.mjs` rows 116, 117 and 119 tie `teach.mjs` to the path format, the skill and SECURITY (2026-11-02-lines-behind-issue-46-prose-metrics, the `deps.mjs` grep).

## Decisions

### D0. Contracts kept

1. Without `--prose`, stdout and the exit code are unchanged: the two exact-stdout tests and the skill's step 6 loop are untouched, as the issue decided.
2. No threshold, as the issue decided: the line is a number for the reader round and the GATE-LOG record to argue from. `--prose` changes no finding and no exit code.
3. The text measured is the same `<p>` text spec 37 scans: `<pre>` and `<code>` removed, then `textOf`.

### D1. The metric and the flag

`lesson.mjs` gains `export function proseMetrics(workspaceDir)`: for every `.html` under `lessons` and `reference` (through `listDir`, so in the same order `lintWorkspace` visits them), for each of the blocks `mission`, `model`, `fact`, `example` and `note` the page has, one row `{ file, block, paragraphs, sentences, avg, longest }` where `file` is `<dir>/<name>`, the paragraphs are the block's `<p>` elements, each paragraph's text is its html with `<pre>` and `<code>` removed through `textOf`, a sentence is a run of text ending at `.`, `!` or `?` followed by a space or the end of the paragraph (an empty paragraph has no sentence), a word is a whitespace-separated token holding a letter or a digit (so a lone full stop left by a stripped tag is not one), `avg` is the words of its sentences divided by the sentences rounded to one decimal (0 with no sentence), and `longest` the largest word count of one sentence. `prose` joins `BOOL`. In the lint handler, after the warning lines, `if (args.prose)` prints one line per row: `prose <file> <block>: <p> paragraphs, <s> sentences, avg <n> words, longest <m>`. The exit code is the one computed from the violations.

### D2. Documents that restate the behaviour

- `docs/REFERENCE.md`: the `teach` row's `teach lint [--fix] [workspace]` gains `[--prose]` and the sentence "`--prose` adds one line per prose block (`mission`, `model`, `fact`, `example`, a reference doc's `note`) of every page, `prose <file> <block>: <p> paragraphs, <s> sentences, avg <n> words, longest <m>`, a sentence ending at `.`, `!` or `?` before a space or the paragraph's end, a word a whitespace-separated token holding a letter or a digit, with no threshold".
- `skills/research-teach/SKILL.md` step 6 gains one sentence: `teach lint --prose` prints the sentence counts, average and longest per prose block, numbers for the reader round and the GATE-LOG record, not a rule.
- `scripts/deps.mjs`: one row tying `lesson.mjs` to REFERENCE for the printed line's shape (literal `longest`), and one tying `teach.mjs` to the skill for the flag (literal `--prose`).
- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Added`.
- Not changed: `LESSON-FORMAT.md` (no rule is added), the fixtures, the exact-stdout tests.

### D3. Tests

1. `test/lesson.test.mjs`: `proseMetrics(FIX)` includes a row for `lessons/0001-good.html` `mission` with 1 paragraph and 2 sentences and, for `reference/good.html` `note`, 2 paragraphs and 2 sentences; on a copy of 0001 whose `model` block is replaced by one paragraph "One two three. Four five! Six <code>skipped words here</code>seven eight nine? Ten<pre>not counted at all</pre>" the `model` row has 1 paragraph, 3 sentences (the trailing "Ten" has no terminator and is not a sentence, as the issue's rule says), longest 4 words and avg 3; `<code>` text and a `<pre>` inside a paragraph are not counted.
2. `test/teach.test.mjs`: `teach lint --prose` on the fixture workspace copy prints the same first line as without the flag, then lines starting `prose lessons/0001-good.html mission: 1 paragraphs, 2 sentences, avg ` and `prose reference/good.html note: 2 paragraphs, 2 sentences, avg `, and its exit code is the one without the flag.
3. The exact-stdout tests at lines 39 and 129 pass unchanged.

## Execution

One person, no sub-agents for the code: the function in `lesson.mjs`, the print loop in `teach.mjs`, one word in `args.mjs`, the tests, and the document lines. The one subagent is a fresh claims review through the `research-claims-gate` skill (`AGENTS.md`), for this plan before any code is written and for the REFERENCE unit after. The order: this plan gated; the code; the tests, run with `npm test`; the D2 lines; `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`; one commit on master, not pushed.

## Done when

`teach lint --prose` over `test/fixtures/teach` prints one line for each prose block of 0001-good.html, `teach lint` without the flag prints what it prints today, and `npm test` passes, which is what the issue's "Done when" sentence asks (2026-11-02-lines-behind-issue-46-prose-metrics, the GitHub body); the four other checks `AGENTS.md` lists pass.
