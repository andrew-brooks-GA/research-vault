# Spec 37: the advisory `WARN_LESSON_TIME_WORD` in `teach lint` (issue #45)

Plan for issue #45, titled "Lint: advisory `WARN_LESSON_TIME_WORD` for time-relative words in lesson and reference prose" on GitHub, at b50432a on master with a clean working tree (2026-11-02-lines-behind-issue-45-time-word, the status line and the log line). The issue body is the one gated on 2026-11-02 in `docs/specs/issues-2026-11-02-lesson-presentation.md` at 4e2dc2c; this plan turns its "What remains" paragraph into the executable list (2026-11-02-lines-behind-issue-45-time-word, the GitHub title and body). Every repo line named here is quoted in that snippet at b50432a, its round 1 additions included. Where a sentence says what a command does, it is read from the quoted code, not from a run.

## What exists

- `lintLesson(filePath, ctx)` in `bin/lib/lesson.mjs` defines `add(code, message)`, which pushes `{ code, file, message, warning }` with `warning` true when the code starts with `WARN_`, reads the file and parses it into `blocks`, `quiz`, `cites` and `links` (2026-11-02-lines-behind-issue-45-time-word, `lesson.mjs` lines 343 to 352). The `fact` check loops over the block's `<p>` elements with `/<p\b[^>]*>([\s\S]*?)<\/p>/gi`, numbering them from 0, and quotes `textOf(m[1]).slice(0, 60)` in its message; the reference doc's `note` block is checked for `data-cite` on its element (2026-11-02-lines-behind-issue-45-time-word, `lesson.mjs` lines 366 to 380). `textOf` strips tags and collapses whitespace (line 39); `proseOf` concatenates every block except `sources` and `followup` with `<pre>` and `<script>` removed (2026-11-02-lines-behind-issue-45-time-word, the `textOf` grep, `lesson.mjs` lines 224 to 240). The `add('LESSON_...')` and `add('WARN_...')` calls in the file run from `LESSON_COMPLETE_NOT_WORKED` at line 300 to `WARN_RECORD_FRONTMATTER_MISSING` at line 464, the figure warnings among them (2026-11-02-lines-behind-issue-45-time-word, the rule-name grep).
- `teach lint` prints `lint: clean` or one line per violation, then `warning <code>  <file>: <message>` per warning, and returns 1 only on a violation (2026-11-02-lines-behind-issue-45-time-word, `teach.mjs` lines 36 to 54). `LESSON-FORMAT.md` documents the figure warnings as a bulleted list under "The model block", each bullet naming its code, and says "`teach lint` warns on each one it can see; the warnings are advisory"; its Reference docs section, line 130, says a reference doc stores no freshness date because the note's `last_verified` is derived and a stale note surfaces through the session brief and `check` (2026-11-02-lines-behind-issue-45-time-word, `LESSON-FORMAT.md` lines 62 to 83 and 128 to 131). REFERENCE's `teach` row names some lint codes "among its codes" (2026-11-02-lines-behind-issue-45-time-word, the REFERENCE line 192).
- The figure-warning test edits a copy of 0001 and asserts each warning fires once per figure and not on the good lesson (2026-11-02-lines-behind-issue-45-time-word, `lesson.test.mjs` lines 381 to 410). The fixture workspace, `LESSON-FORMAT.md` and the two built workspaces outside the repo (`kubernetes_learning/vcluster`, one lesson; `zig_book/hello_world`, four lessons and one reference doc) hold none of the six words; fixture 0001's `model` block opens with the paragraph "A function takes an input and gives back an output. <dfn>fx</dfn> is the fixture function ...", and the fixture reference doc's `note` block holds two `<p>` elements; the test "a good lesson lints clean" at lines 61 to 69 asserts an empty finding list over the six fixture pages (2026-11-02-lines-behind-issue-45-time-word, the fixture grep, the workspaces block, `reference/good.html`, `0001-good.html` lines 19 to 24, `lesson.test.mjs` lines 61 to 69). `deps.mjs` rows 101 and 108 tie `lesson.mjs` to `LESSON-FORMAT.md` for the block names and the figure constants (2026-11-02-lines-behind-issue-45-time-word, the `deps.mjs` grep).

## Decisions

### D0. Contracts kept

1. A warning, not a violation, as the issue decided: `teach lint`'s exit code and its `lint: clean` line are unchanged, and the fixtures stay clean, since none holds a time word.
2. No sentence splitting: the paragraph is the unit, as the issue decided.
3. Text inside `<pre>` and `<code>` is excluded, so a quoted command or output never trips it; a quoted source sentence in prose can, which is why it is advisory.

### D1. The rule

`lesson.mjs` gains `TIME_WORDS`, the six phrases `currently`, `recently`, `nowadays`, `at the moment`, `as of now`, `as of today`. After the `fact` check, for every block except `sources` (the reference doc's `note` block included, since it is a block), each `<p>` in the block's html, numbered from 0 as the `fact` check numbers them, has its `<pre>` and `<code>` elements removed and is passed through `textOf`; for the first phrase found in it, matched case-insensitively at word boundaries, `add('WARN_LESSON_TIME_WORD', `${name} paragraph ${i} says "${phrase}": ${text.slice(0, 60)}; take a version or date from the cited entry instead`)`. One warning per paragraph.

### D2. Documents that restate the behaviour

- `skills/research-teach/LESSON-FORMAT.md`: a section `## Prose` after the figure rules: `teach lint` warns `WARN_LESSON_TIME_WORD` on a paragraph, in any block but `sources` and in a reference doc's `note`, that says `currently`, `recently`, `nowadays`, `at the moment`, `as of now` or `as of today` outside `<pre>` and `<code>`, because the page's currency is the vault's `last_verified`, not a word in the prose; the fix is a version or date taken from the cited entry, and for a reference doc it lands in the vault note, which is then re-rendered.
- `scripts/deps.mjs`: one row tying `lesson.mjs` to `LESSON-FORMAT.md` for the copied word list, with the literal `nowadays`.
- `CHANGELOG.md`: one line under `## [Unreleased]`, `### Added`.
- Not changed: `docs/REFERENCE.md` (its `teach` row names codes "among its codes" and stays true), `bin/commands/teach.mjs`, the fixtures, the built workspaces (none holds a time word).

### D3. Tests

In `test/lesson.test.mjs`, on a copy of the fixture workspace: a copy of 0001 whose first `model` paragraph (the one opening "A function takes an input") gains "This is currently true." at its start gets one `WARN_LESSON_TIME_WORD` finding with `warning` true, whose message names `model paragraph 0` and the word `currently`; the same word inside `<code>` in that paragraph gets none; "As of today" at a paragraph's start matches case-insensitively; a `sources` block `<p>` with `recently` gets none; the reference doc `good.html` with "nowadays" in its first `note` paragraph gets one naming `note paragraph 0`; the unedited fixtures stay clean, which the existing "a good lesson lints clean" test at lines 61 to 69 asserts.

## Execution

One person, no sub-agents for the code: the constant and the loop in `lesson.mjs`, the format section, the deps row, the CHANGELOG line, the test. The one subagent is a fresh claims review through the `research-claims-gate` skill (`AGENTS.md`), for this plan before any code is written. The order: this plan gated; the code; the tests, run with `npm test`; the D2 lines; `teach lint` over `test/fixtures/teach` and over the two built workspaces, each passed as the positional workspace (the command resolves the binding from the workspace path); `npm run lint:self`, `node scripts/check-agentsmd-drift.mjs`, `node scripts/check-encoding.mjs`, `node bin/research-vault.mjs gate staged --check`; one commit on master, not pushed.

## Done when

The rule exists in `bin/lib/lesson.mjs`, is documented beside the other lint rules, the fixture lessons and the built lessons are clean, and `npm test` passes, which is what the issue's "Done when" sentence asks (2026-11-02-lines-behind-issue-45-time-word, the GitHub body); the four other checks `AGENTS.md` lists pass.
