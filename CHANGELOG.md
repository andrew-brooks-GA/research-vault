# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Open-question age in `advise` and `verify --answered-by` to close a question (spec 25; issue #12). `advise` gains `openQuestions`: every active question not yet `answered` whose id date is more than 60 days before today, with its state and age, printed as `open questions over 60 days (<n>)`. `verify --id <question> --answered-by <id> [--answer-summary <text>]` sets `state: answered`, writes the summary (the answering entry's `summary` when the flag is omitted), appends the id to `contributing`, sets `updated` and adds no verification row. The capture, orchestrate, verify and librarian skills name the call; REFERENCE's `verify` row now says `--succession` keeps the entry active and prints the sibling's `capture` line, which is what it did.

### Changed
- Issues #10, #12 and #13 rescoped (`docs/specs/issues-2026-11-02.md`): each body now says what the plugin already does at 568d61b (`capture --batch` and its validate-then-write pass, `--answer-summary` and `WARN_ANSWERED_NO_SUMMARY`, the five `topic_aliases` consumers including capture-time normalisation) and narrows the ask to what remains (a fetching URL-list and markdown input with continue-on-error under the `refresh` network contract; an `advise` open-question age and a command to close a question; a per-vault alias map that `advise` and `search` also load, and `lint --fix --topics`). Reviewed adversarially and claims-gated before posting; #27 closed as fixed by 8e8ec84.
- The nine other open issues rescoped and all twelve ordered (`docs/specs/issues-2026-11-02-remaining.md`): #5, #6, #7, #8, #9, #11, #14, #15 and #16 each say what exists at a0f6c91 (grep counts, the hooks manifest, `refresh`, `search`, `export`, the manifest row, `--store-body`) and what remains; the twelve are ranked by benefit against size and their titles carry the rank as a prefix. Same process: adversarial review, then the claims gate.
- Five lesson-presentation issues drafted from the 2026-11-02 wiki-quality research (`docs/specs/issues-2026-11-02-lesson-presentation.md`): a lead sentence in `mission` that states the idea; a served reading page explaining the lesson's conventions once; an advisory `WARN_LESSON_TIME_WORD` lint; a sentence-length readout in `teach lint`; and five text changes to the `lesson-reader` agent (frame reading order, a Lead check, words to avoid, a lead-in before every command, one level down). Adversarially reviewed (18 findings) and claims-gated (two rounds, MERIT) before posting as #43 to #47 under the `teach-2026-11-02` label.

## [0.9.0] - 2026-11-01

### Changed
- The research-teach skill states the reader rule in use (a third `REVISE` round splits the lesson only when its findings name scope, otherwise the round is recorded in `GATE-LOG.md` as the decision and the claims gate follows from it), passes `--topic <mission topic>` to `teach path candidates` when the binding's topics are broader than the mission, closes each group of path lines with a `Project:` line, chooses the lesson's shape and writes an Elements part in `PLAN.md` at step 2, pairs each model figure with its paragraph, and ends a `concept` lesson with a `connect` prompt (spec 21 P4 and P5, spec 22 D1 to D4; issue #30).
- Lesson page and figure lint (spec 22 D4 and D6.1 to D6.4; issue #31). `lesson.css` gives prose inside a block a `65ch` measure, adds the `.pair` element (a paragraph and its figure, two columns from 1100px; a figure outside a pair spans), sizes `figure svg` from its viewBox (`width: 100%; height: auto; min-width: 27.5rem`, `figure { overflow-x: auto }`, dropping `max-width: 100%`, with a print override), deletes the citation chip rule so an unserved `[n]` is a muted superscript with no link, and adds a `--mark` token for both themes. `teach lint` warns `WARN_FIGURE_FIXED_SIZE`, `WARN_FIGURE_VIEWBOX_WIDE` (over 440 units), `WARN_FIGURE_LABEL_SMALL` (under 14 units), `WARN_FIGURE_LABEL_LONG` (over 40 characters), `WARN_FIGURE_COLOR` and `WARN_FIGURE_NO_ALT` once per figure, and reports `LESSON_CITE_NUMBER` when an authored `[n]` is not its id's position in the `sources` list; `teach serve` numbers citations by that position instead of first appearance. LESSON-FORMAT states the figure, pair, citation and block `aria-label` rules, and its example and the `0001-good` fixture carry them. A `COUPLINGS` row pair ties the figure constants across LESSON-FORMAT, `bin/lib/lesson.mjs` and `lesson.css`.
- **Per-row gate units for Markdown tables (spec 21 P6; issue #33).** In a gated Markdown file, each data row of a table (the `|` lines after a `|---|` separator) is its own unit, `sec:<slug>/<first-cell slug>` (a repeated first cell gains `#`), and its section hashes without those rows, so an edit to one row of REFERENCE's command table reopens that row only and `gate evidence --changed` prints `unit sec:commands/<command> <file>:<line>-<line> prose` for it; the header row, the separator and prose outside the table stay in the section. A section without a table hashes as before; a file whose tables were gated under the section unit reopens each row once.
- **Lesson shapes (spec 22 D1 and D2; issue #34).** A lesson declares `<body data-shape="concept|tool|diagnose|project">`; `teach lint` reads its required blocks from one `SHAPES` table in `bin/lib/lesson.mjs` (the frame `mission`, `sources`, `followup` around each shape's middle), and a lesson with no `data-shape` keeps the block list it had, so existing lessons stay valid. `LESSON_BLOCK_MISSING` becomes `LESSON_SHAPE_BLOCK_MISSING`, beside `LESSON_SHAPE_UNKNOWN` and `LESSON_SHAPE_MISMATCH` (a declared `tool` lesson needs `data-teaches`, no other declared shape carries it). Four blocks: `complete` (the example's command with `<mark aria-label="withheld">____</mark>`; `LESSON_COMPLETE_NOT_WORKED` when no `example` command matches it), `predict` (a `<pre>` output and one quiz item, read by the term rule; `LESSON_PREDICT_INVALID` otherwise), `connect` and `scaffold`, each with a label and colour in `lesson.css` and spanning the two-column grid. The lint reads the lesson's quiz from its `quiz` block. `PLAN.md` gains a sixth part, Elements; a lesson that declares `data-shape` with a plan lacking it is `LESSON_PLAN_NO_ELEMENTS`, and a plan for an undeclared lesson predates the part and is not checked. LESSON-FORMAT carries the shape table and the rules, `test/fixtures/teach` gains a tool, a diagnose and a project lesson with plans and `PATH.md` lines 7 to 9, REFERENCE's `research-teach` and `teach` rows name the shapes and codes, `COUPLINGS` rows tie the shape table to LESSON-FORMAT and the fixtures and the block labels to `lesson.css`, and the research-teach skill's plan sentence names the six parts.
- **Quiz widget and served status (spec 22 D5, D6.5 and D6.6; issue #35).** The `predict` block's item joins the lesson's one attempt as item 0: `quiz.js` renders every `data-quiz` into one attempt (`mergeQuizzes`, one answers array, one POST, the score after the last item) and the server grades the same order (`lessonItems` in `bin/lib/lesson.mjs`, read by `readQuiz`), so the attempt's `total` counts it. A clicked option shows `Correct` or `Not this one` before its text, `.quiz-why` and `.quiz-result` carry `role="status"`, each item is a `role="group"` labelled by its question, and answered options are `aria-disabled` instead of `disabled` (`lesson.css` follows). `/lessons.json` gains `lines` (the `PATH.md` line count) and each lesson's `line`, `shape` and closing `Project:` line; the served nav shows `line N of M`, and the index at `/` groups lessons under the `Project:` line that closes their group and shows each shape. LESSON-FORMAT gains the lure rule, three options by default and the widget's texts and roles; SKILL.md states the nav and index and the reason the 21-day review gap stays; SECURITY.md describes what `/` and `/lessons.json` read; `COUPLINGS` rows follow.
- **Projects on the path (spec 22 D3; issue #36).** A `PATH.md` line whose title starts `Project:` is a project line: `teach lint` reports `PATH_PROJECT_AFTER` when its `after:` names fewer than two lines, `teach next` counts it as a review in the inner-fringe rule so a built project leaves the lines it names on the inner fringe, and `teach path edges` proposes nothing for it; `isProject` in `bin/lib/lesson.mjs` is the one test, also used by `lessonIndex` for the index grouping. `teach attempt add --lesson <id> --result pass|fail` records a project run beside the unchanged `--answers` form, as an attempt with `result:` (a new field in `schema/teach.schema.json`), `total: 1` and `wrong: []` or `[0]`; `teach progress` and `/progress` show `pass` or `fail` for it. `PATH-FORMAT.md` gains the project line and both exceptions, `LESSON-FORMAT.md` the `step` and `scaffold` rules of a project lesson, `SHAPES` requires only `step` of a `project` lesson (its `scaffold` is optional, carried by the mission's first project), `SKILL.md` §6 the `--result` form, and the fixture's line 9 is `Project: Predict, then run`.
- **Deps graph literals and directory reads (spec 21 P2 and P3; issue #39).** A `COUPLINGS` row in `scripts/deps.mjs` may carry a fourth element, a string or regex both files contain, and `test/deps.test.mjs` fails when either file stops containing it; 69 of the 105 rows carry one. A `reads` edge to a directory becomes one edge per file under it, a `reads` path may start with any top-level directory but `docs` when it is a call argument, and `npm test` yields `npm:test`, so the six entry skeletons, `schema/teach.schema.json` and `hooks/hooks.json` gain dependents and the files with no edge in or out drop from 39 to 11. `skills/research-teach/SKILL.md` links its five format files, `PATH-FORMAT.md` among them. The row tying the `related <id> --depth 2` query to `bin/commands/teach.mjs` now names `bin/lib/lesson.mjs`, which prints it. Spec 14 D1 is amended to match.

### Fixed
- The `COUPLINGS` rows in `scripts/deps.mjs` that tied `.teach-serve.json` and the `127.0.0.1` binding to `bin/lib/teach.mjs` now name `bin/commands/teach.mjs`, which writes the file and binds the port: the `SKILL.md` row of `bin/commands/teach.mjs` names `.teach-serve.json`, a new `bin/commands/teach.mjs` to `SECURITY.md` row carries the file, the binding and the serving line, and the two `bin/lib/teach.mjs` rows keep only the values that file holds (`SPACING_DAYS`, the `/lessons/` path, `ATTEMPT_BODY_MAX`, the allowlisted dirs and the `Host` check) (issue #29).

## [0.8.4] - 2026-11-01

### Added
- Spec 22 (`docs/specs/22-lesson-shapes.md`): lesson shapes, projects and a readable page for research-teach. A fixed page frame with a shape-specific middle (`concept`, `tool`, `diagnose`, `project`), an Elements part in `PLAN.md` as the split and merge rule, `Project:` path lines closing each group with support fading across the mission's projects, figures sized from a 440-unit viewBox with minimal labels and prose beside them, competitive quiz lures with three options, a 65ch measure, numbered citations in both renderings, block landmarks and the WCAG floors for the widget; every choice cites a stored source captured today. Reviewed adversarially (evidence and interface) and revised before the claims gate. Spec only.
- **Path edges (spec 19 D1-D4).** `teach path edges [workspace]` reads `PATH.md` and the built lessons and prints, under each line, one `after:` proposal per term or tool the line's lesson uses in its prose (`lessonUses`, the term rule's reading) or runs in its commands (`commandTools`), or its title names when the line is untaken, that an earlier line introduces or teaches and the line's `after:` does not reach transitively (`pathEdges`); each proposal names the lesson, the term and the introducing line, and the command writes nothing. The research-teach skill runs it after `lesson:` is added to the line; PATH-FORMAT and REFERENCE state the rule. `near:` waits for a stall signal (spec 19 D5).
- Spec 19 (`docs/specs/19-path-edges.md`): path edges. `teach path edges [workspace]` derives `after:` proposals from the workspace alone (the lines' `terms:` and `tool:` as introducers; a built lesson's prose and commands, or an untaken line's title, as uses) and prints each with the lesson and the term behind it, for the path author to accept; `near:` stays out until a stall has been observed. Today's behaviour on the vcluster workspace probed first. Spec only; the file is force-added, since `docs/specs/` is otherwise ignored.

## [0.8.3] - 2026-11-01

### Added
- **Path discovery (spec 20 D1-D5).** `teach path candidates [--topic a,b] [workspace]` pools the vault's non-superseded entries on the given topics (default: the binding's `defaults.topics`) and on every mission term whose slug is a vocabulary topic, runs `search`'s own topic, text and body filters for every mission and path term plus a depth-2 `related` walk from every cited id, and prints each uncited or linked entry once under the `PATH.md` line it would follow (terms: before a mission term in the title before tool:, --text hits only, highest line among equals) with the queries behind it, then every mission term no line covers; it writes nothing. `teach lint` warns `WARN_PATH_TERM_UNPLANNED` for a `New to me` term on no line's `terms:`. The research-teach skill runs the command after writing the path and before each lesson's plan; PATH-FORMAT names the warning. `searchVault`'s in-memory filters are now the exported `matchRows`.
- Spec 20 (`docs/specs/20-path-discovery.md`): path discovery. `teach path candidates [--topic a,b] [workspace]` runs the vault's own topic, text and body searches over the mission's terms and a depth-2 `related` walk from every cited entry, and prints candidate entries grouped by the `PATH.md` line they would follow with the query behind each, for the path author to accept; `teach lint` gains `WARN_PATH_TERM_UNPLANNED` for a `New to me` term on no line; the skill runs it at the path and before each plan. Spec 19's edge pass is renamed `teach path edges`. Spec only; the file is force-added, since `docs/specs/` is otherwise ignored.

## [0.8.2] - 2026-11-01

### Added
- **Hygiene bundle (spec 18 D1-D5).** `writeManifest` refuses to drop an entry the current manifest lists while its type folder is missing or its file is still there (`manifest not written: ...`; delete the manifest to accept the shrink); `manifest --rebuild` reports every edge to a missing entry on stderr before writing; each claims-ledger row carries `reviewer`, the sha256 of `agents/claims-reviewer.md`, and a row counts only while that hash is absent or current (`gate status` says `none (reviewer changed)` otherwise); `manifest --topics` lists the topic vocabulary with counts, and the research-vault-usage skill tells the agent to choose search terms from it.
- Spec 18 (`docs/specs/18-hygiene-bundle.md`): the hygiene bundle, evaluation 16's item 3, with today's behaviour probed first. Spec only; the file is force-added, since `docs/specs/` is otherwise ignored.
- **`examples/blast-radius.mjs`.** Given the manifest, one entry id and one or more `check --json` outputs, walks `sources` and `contributing_ids` inward and lists the entries that rest on the id and every code symbol or document citing one of them (evaluation 16's item 4); run by the contract test, named in REFERENCE and ADOPTING. No new CLI surface.

## [0.8.1] - 2026-11-01

### Added
- **Teach fringe (spec 17 D0-D4).** `teach next` prints one `fringe:` line per `PATH.md` line whose `after:` lines are all built (file order, the first the default) and one `inner:` line per built non-review line nothing depends on yet (most recent first), in place of the single `path:` line; `fringe: none (...)` and `fringe: complete` name the empty states. `teach lint` reports `PATH_AFTER_FORWARD` for an `after:` value naming a later, missing or own line and `PATH_AFTER_CYCLE` once per loop. The research-teach skill picks the next lesson from the fringe and draws review items from review-due and review-failed records, then the inner fringe; PATH-FORMAT states the rules; the fixture path branches and joins.
- Spec 17 (`docs/specs/17-teach-fringe.md`): the teach fringe. `teach next` offers every `PATH.md` line whose `after:` lines are all built (one `fringe:` line each, the first the default) and the inner fringe (`inner:` lines, the most recently built lessons nothing depends on yet) for review lessons; `teach lint` gains `PATH_AFTER_FORWARD` and `PATH_AFTER_CYCLE`; the skill picks from the fringe and reviews from the inner fringe. Evaluation 16's item 1, with today's behaviour probed first. Spec only; the file is force-added, since `docs/specs/` is otherwise ignored.
- Evaluation 16 (`docs/specs/16-graphify-evaluation.md`): Graphify-Labs/graphify read at 0.9.100 and judged concept by concept against the plugin's code links, the vault and the teach workflow, with the education literature on prerequisite graphs, knowledge spaces and concept maps captured into the vault (synthesis 2026-11-01-graph-helps-learner-by-exposing-ready). Outcome: enforce and walk `after:` in PATH.md so `teach next` offers the ready-to-learn fringe, propose term prerequisites for the path author to accept, and take graphify's shrink guard and weakest-hop honesty rules; do not take its extraction, clustering or hub analytics. Planning only; the file is force-added, since `docs/specs/` is otherwise ignored.

- **`gate staged [--check]`.** Lists every gated file staged in git with its claims verdict and, with `--check`, exits 1 while any has none, so a pre-commit hook can refuse a commit that would land an ungated spec, plan, lesson or linked code file. The repo ships `.githooks/pre-commit` (enable with `git config core.hooksPath .githooks`), its own binding now gates `docs/**/*.md`, and AGENTS.md lists the check under "Before you commit".

- **Per-section gate units for Markdown.** A gated Markdown file without `data-block` markup is hashed one unit per heading section (`sec:<slug>`, `sec:preamble` before the first heading; headings inside fences are text), so an edit reopens only the sections it touched instead of the whole file; `gate evidence --changed` prints `unit sec:<slug> <file>:<start>-<end> prose` for each changed section, and the claims-reviewer reads only those ranges. A document with no heading is still one unit, `all`.

### Fixed
- **`check` reports a superseded entry as `stale` for prose citations too.** `checkCitations` returned `ok` for a prose citation of an entry with `status: superseded` whenever its verification window had not lapsed (spec 15 fixed code rows only); the row is now `stale` with `(superseded by <id>)` as its reason, in `check`, the claims gate's step 0, the post-edit hook, the session brief and `gate evidence`.
- **REFERENCE's no-language example named `.py`, which ships a row since 0.8.0.** It now names `.kt`; the Stop-hook sentence says a verdict for the current content can be a row for those bytes or every unit covered, which is what `gateStatus` does.
- **The Stop gate no longer fires on files git says are clean.** `missingGates` took any gated file with an mtime after the session start as changed, so a worktree, a fresh clone or a checkout tripped it on every unchanged fixture and lesson. A tracked file with no working-tree change is now skipped; outside git, or on any git error, the mtime rule stands.

## [0.8.0] - 2026-10-27

### Added
- **Adoption guide and worked join.** `docs/ADOPTING.md` is the ordered path for a code project (vault in the repo, versions key, first link, `check`, CI, gate, Obsidian, your own graph); `examples/graph-dot.mjs` joins the manifest and `check --json` into Graphviz DOT and is run by the contract test. The README install paragraph lists the shipped languages instead of Lua alone.
- **The graph as an integration contract.** REFERENCE "Reading the graph from outside" lists the keys of `.vault-manifest.json` and `check --json` that an outside graph joins on, and `test/contract.test.mjs` pins them; a change to either is a breaking change from now on. A project keeps its own code graph and reads these two outputs, so the plugin stays with research.
- **Shipped language rows for code links.** `LANGS` now covers the JavaScript and TypeScript family (`.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`), `.py`, `.go`, `.rs`, `.zig`, `.rb`, `.sh`/`.bash` and C/C++ (`.c`, `.h`, `.cpp`, `.hpp`, `.cc`, `.hh`) beside `.lua`, so a project opts in with a glob and no regex. Column-0 declarations only, as before; a project row still overrides a shipped one.
- **`obsidian` draws the code links.** When the vault lives inside a bound repo with a `code` block, the view gains one derived note per linked code file under `_obsidian/code/`, a heading per declaration and a `[[wikilink]]` per link with its pin as text, plus a `## code` section in the MOC; Obsidian then shows code → entry edges and each entry's code backlinks. Unbound vaults are unchanged.
- **`obsidian` seeds the graph settings.** A view with no `_obsidian/.obsidian/graph.json` gets one: the MOC filtered out (it links every note and collapsed the graph into one star), a colour group per type tag with stale on top, labels at a lower zoom and wider spacing. Written once; an existing file is never touched.

### Fixed
- **`check` no longer reads a markdown image URL as a citation.** A badge or figure (`![alt](url)`) was reported `uncovered` and failed `check --check`; an image is now dropped before extraction.

### Changed
- **README** describes binding a repo with `init --project` and code links: the bullet, a code vignette, the install line and a "Day to day" row.

## [0.7.0] - 2026-10-27

### Added
- **Code links** (spec 15 D0-D7). A vault entry id on a comment line above a column-0 declaration is a citation of that symbol in a repo bound with `init --project --vault <relative dir> --code-links '<glob>'`, which writes a `code` block (`globs`, `languages`, `versions`) that `parseProjectConfig` accepts only on a relative vault inside the repo. A language is data, `{ comment, decl }`: `bin/lib/codelinks.mjs` ships the Lua row in `LANGS`, a project supplies or overrides rows in `code.languages`, and `langFor` is the one lookup; every regex in the binding goes through `compilePattern`; `LINK_RE` is built from the exported `ID_RE`. `check` reports code rows (`ok`, `stale` with its reason, `uncovered`, `unattached`) with a `versions:` footer, always loads the binding, and keeps code files out of the prose extractor; a pin (`<id>@<key>=<version>`) re-checks on a change of the version `code.versions` reads from the project, not on elapsed time, and a superseded entry is stale for code. The gate hashes one `sym:<name>` unit per linked declaration (pin values stripped), `gate evidence --changed` prints a `unit` line per changed unit, linked code files are gated, the post-edit hook reports code rows and the links a versions-file edit unpins, and the Stop hook blocks on a pin that differs from the declared version. The `research-authoring` skill gains a "Code" section and `claims-reviewer` a `sym:` paragraph. Nothing is written into existing vaults; without a `code` block every surface runs today's path.
- Spec 15 (`docs/specs/15-code-links.md`): code links, a vault entry id in a comment above the declaration it justifies in a consumer project bound to a project-specific vault; Lua in wow_forever first; `check` rows per linked symbol, a pin (`<id>@<key>=<version>`) that re-checks on a change of the declared dependency version instead of on elapsed time, symbol-level gate units, an `init --project --code-links` opt-in, per-project language rows in `code.languages` on the `taxonomy_extensions` model so any language works without a plugin release, and nothing written into existing vaults. Spec only; the file is force-added, since `docs/specs/` is otherwise ignored.
- Spec 14 (`docs/specs/14-deps-graph.md`): a derived dependency graph for the repo, computed from the working tree on every run, with a hand-declared coupling table, a test that fails CI on a broken reference, an AGENTS.md rule and a project-scope PostToolUse hook; plus the drift fixes the 2026-10-27 inventory found. The file is force-added, since `docs/specs/` is otherwise ignored.
- **Dependency graph** (spec 14 D1-D4). `scripts/deps.mjs` derives the repo's import, read, test, documentation, invocation and declared-coupling edges from the working tree on every run; `node scripts/deps.mjs` prints every broken reference, `node scripts/deps.mjs <path>` (or `cli:<command>`, `npm:<script>`) the dependents of one thing, and `test/deps.test.mjs` fails `npm test` on a reference to something that no longer exists. A committed `.claude/settings.json` PostToolUse hook names the dependents of a file after an `Edit` or `Write`. `AGENTS.md` gains the rename rule and the `COUPLINGS` rule, and its other lines are narrowed to what the evidence shows after a claims gate; `.gitignore` gains `ci-vault/`.

### Changed
- **CI runs on Linux and macOS only.** The Windows jobs are removed from the matrix: `node --test` had failed there since 2026-10-26 and its failure cancelled the jobs still running.

### Fixed
- **`capture` refuses an id already used in another folder.** A title that slugged to the id of an existing entry of another type was written as a second entry with the same id; the id check now covers every entry folder and names the folder.
- **Inventory drift** (spec 14 D6). `skills/research-capture/SKILL.md` lists `tool-output` among the authority bases; step 1 of `vault-template/meta/prompt-templates/verify-entry.md` computes `last_verified` from `confirmed` and `changed-trivially` verifications only, as `freshness-policy.md` and the code do; `agents/claims-reviewer.md` keys on the lowercase `changed units:` line the gate prints and names `all` as the unit of a draft without data-blocks; `freshness-policy.md` §3 gives `stable` its 1095-day window instead of "trust unless cued", matching `refresh_after_days`, and verify-entry step 2 reads `stable >1095d`; `research-capture` calls `--batch` validate-then-write, not atomic, since a write failure mid-plan keeps the entries already written; `schema/project-config.schema.json`, which nothing read, is gone; CI runs `npm run lint:self`. Each fix has a test.

- **`verify --stale`** printed `Infinityd` (and `null` under `--json`) for an entry with no confirming verification; it now reports `never verified`.

### Upgrading an existing vault

**Spec 14 D6**
- `init --refresh-docs` rewrites `AGENTS.md` and `taxonomy.json` only, so hand-replace step 1 of `meta/prompt-templates/verify-entry.md` with: Compute `last_verified` := the latest `verifications[].date` whose `result` is `confirmed` or `changed-trivially`; check `volatility`.
- Likewise replace item 4 of `meta/freshness-policy.md` §3 with: `stable` and `last_verified` >1095 days, or a specific cue → re-check; otherwise trust.

## [0.6.0] - 2026-10-27

### Added
- **Teaching workspace.** The `research-teach` skill and the `teach` command (`lint [--fix]`, `next`, `serve`, `record add`, `attempt add`, `supersede`) run a multi-session course from a `MISSION.md`: a Floor of known tools and terms, a `PATH.md` plan, lessons as HTML pages with `model`, `fact`, `example` and `quiz` blocks (`LESSON-FORMAT.md`), at most three new terms and one new tool per lesson, parked lessons that keep their history, a progress view, numbered footnote citations, a quiz module and stylesheet copied into the workspace, and a learning-record store.
- **Claims gate.** `gate evidence <draft> [--extra <ids>]` derives a draft's evidence list from the vault; `gate record`, `gate status [--check]` and `gate changed` keep per-unit verdicts in `.research-vault-ledger.jsonl` at the repo root, keyed to content hashes so an edit reopens only what it touched. `gates.globs` in `.research-vault.json` names further gated files. The `research-claims-gate` skill drives it with the `claims-reviewer` agent (model pinned to opus); the `lesson-reader` agent reads a lesson as the learner would before the claims gate.
- **Hooks.** A Stop hook blocks the end of a turn that leaves a changed gated file without a `PASS` or `MERIT` row. A pre-web hook hands matching vault entries to the model before `WebFetch` or `WebSearch`. The post-edit hook reports uncovered or stale citations after an `Edit` or `Write` in a bound repo. The session-start hook prints one line per teach workspace that needs attention. Every handler sets a timeout.
- **Graph.** `.vault-manifest.json` gains typed `edges` and node metadata; `related` traversal is bounded (`--depth`, `--direction`, `--rel`, `--format mermaid`); `advise` gains a stale-evidence section; `search` hides superseded entries unless `--include-superseded`; Obsidian stubs carry `tags:`; the generated `AGENTS.md` gains the graph playbook (§5.2) and the supersession recipe.
- **`WARN_QUOTE_ARTIFACT`** lint warning for frontmatter scalars with a baked-in `\"`, repaired by `lint --fix`.

### Changed
- **Commands folded into skills.** `research-capture`, `research-claims-gate`, `research-teach` and `research-verify` are skills only; the `/research-vault:<name>` form still works. `research-init` is user-invoked only.
- **Plugin manifest.** `.claude-plugin/plugin.json` carries `version`, `homepage`, `repository`, `license` and `keywords`; marketplace installs follow that version. `bin/research-vault` is a shim so skills can call the bare command.
- **Vault instructions.** `vault-template/CLAUDE.md` is the single line `@AGENTS.md`. The repo root gains `AGENTS.md` for contributors.
- **Frontmatter fidelity.** `verify` re-emits unchanged keys byte-identical. `capture`, `verify` and `lint --fix` say where they wrote when the vault resolved through the config pointer or the OS default.
- **Code is not a citation.** `check`, `gate evidence` and the hooks ignore URLs and ids inside fenced blocks, inline spans and HTML `<pre>` or `<code>`; `check` lists them as `skipped (in code)`.
- **Comma lists are trimmed** in every list flag. One manifest writer and one block parser replace the inline copies.
- **In-draft claims-gate marker retired.** The verdict lives in the ledger; old `<!-- claims-gate -->` comments are ignored.

### Fixed
- **YAML parsing.** Single-quoted scalars, quotes inside flow sequences, inline comments and block scalars are read per YAML.
- **Scalar edge fields** (`source_id`, `prompt_id`, `superseded_by`) were iterated as strings. **`last_verified`** in the docs now matches the code. **Piped CLI output** was truncated at 64 KB. **`check`** takes an absolute path.
- **Docs.** `REFERENCE.md` counted three hooks (four). `AGENTS.md` and `REFERENCE.md` narrowed to what the code says after a claims gate.

### Removed
- **Maintainer-only files left the repo.** `docs/specs/` (the numbered design rounds, now gitignored), `docs/EVALUATION.md` with `evaluation-template.json`, the `docs/img/` placeholder, and the Codex manifest nothing documented installing.
- **Duplicates.** `commands/research-advise.md` restated the `research-librarian` skill. Five unreferenced vault-template files (`meta/obsidian-view.md`, `meta/refresh-queue.md`, the `promote-to-synthesis`, `summarize-source` and `verify-audit` prompt templates) restated the reference or the skills; the kubectl probe manifest is now the example inside `meta/probe-manifests/README.md`. Existing vaults keep their copies.

### Upgrading an existing vault

**Spec 13 (review round 5)**
- Replace the one-line `CLAUDE.md` in an existing vault with `@AGENTS.md`; `--refresh-docs` does not touch it.
- `/research-vault:research-capture`, `research-claims-gate`, `research-teach` and `research-verify` are now the skills of the same name; the slash form still works.
- Marketplace installs follow `version` in `.claude-plugin/plugin.json` from now on and update only when it is bumped.
- A topic, source or scope list with spaces after the commas is now trimmed. An entry captured before this keeps its leading-space value (a source reference shows as `DANGLING_REF` under `lint`); `lint --fix` is not changed to rewrite it.

**Spec 12 (lesson building)**
- No manifest, AGENTS.md or `meta/` change; `init --refresh-docs` is not needed.
- Run `teach lint --fix` once per teach workspace. A learning record with no frontmatter gets `title` from its first `# ` heading (else the file name's slug), `date` from the file's modification time, `kind: understanding` and `status: active`, or `status: superseded` with `superseded_by` when its body carries the old `Status: superseded by LR-NNNN` line (the line stays in the body). Frontmatter that holds only the old `Status:` line (no `type`) is migrated too: any `title` is kept and the rest is derived the same way. In both cases `superseded_by` is set only when the record numbered `LR-NNNN` exists; otherwise the record stays `active`. A record whose frontmatter carries `type` is untouched. A second run changes nothing.
- `attempts/` is not gitignored: it is learner data, committed or not at the owner's choice.
- `.teach-serve.json` is added to the workspace's `.gitignore` by the skill's first-lesson step. A workspace that already has lessons does not run that step; add the line by hand.

**Spec 11 (claims gate enforcement)**
- No manifest, AGENTS.md or `meta/` change; `init --refresh-docs` is not needed.
- Gate verdicts are written to `.research-vault-ledger.jsonl` at the bound repo's root. Add it to that repo's `.gitignore` if verdicts should stay local; commit it to share them.
- To gate documents beyond teach workspaces, add `"gates": { "globs": ["docs/**/*.md"] }` (your globs) to `.research-vault.json`.
- An old `<!-- claims-gate: ... -->` marker in a lesson can be deleted; the gate does not read it. After upgrading, the Stop hook flags every gated file edited in the session (or in the last twelve hours when the transcript has no birth time) until a PASS or MERIT verdict is recorded for its current content.

**Round 2 graph specs**
- Run `init --refresh-docs` (AGENTS.md gains §5.2 and the supersession recipe).
- Run `lint` once; until then `lint --check` reports `MANIFEST_STALE` because rows gained fields.

**Frontmatter YAML fidelity**
- Run `research-vault lint` and look for `WARN_QUOTE_ARTIFACT`; `lint --fix` repairs those values. Review the diff: `lint --fix` also normalizes formatting across the vault, as before.
- A plain value that contained ` #` (space then hash) is now read as ending at the `#`, per YAML. Search hand-written frontmatter for ` #` before upgrading if that matters to you.

**Specs 01 + 02 (scalar edge fix, typed edges)**
- Run `research-vault lint` once; until then `lint --check` reports `MANIFEST_STALE` (the manifest gained `edges`, and vaults with a populated `source_id`/`prompt_id` get corrected `backlinks`).
- Run `research-vault init --refresh-docs` to pick up the AGENTS.md §9 wording (`edges` list). No `meta/` file changed.
- Re-run `research-vault obsidian` to regenerate `_obsidian/` with the per-relation Links layout.
- Consumers of `related` output: `forward` membership grows and is now sorted rather than in field order; the default traversal additionally reaches entries that name the id in `superseded_by`.

**Specs 03 + 04 (traversal, stale evidence)**
- No manifest change. `advise` text output gains a `stale evidence (N)` section; `--json` output gains the `staleEvidence` key.
- Run `research-vault init --refresh-docs` to pick up the AGENTS.md §7 sentence on evidence freshness. `init --refresh-docs` never touches `meta/`, so hand-add the same sentence to `meta/freshness-policy.md` §3 (after item 5):

  > A note or synthesis is only as fresh as its evidence: before citing one, check that its `sources`/`contributing_ids` chain is within window (`advise` lists violations as `staleEvidence`).

**Spec 05 (Obsidian tags)**
- No manifest or AGENTS.md change. Re-run `research-vault obsidian` to get the `tags:` block.
- No command refreshes `meta/`, so hand-add this section to `meta/obsidian-view.md` (before "## Rules"):

  ```
  ## Graph groups

  Every stub carries frontmatter `tags:` (`type/<type>`, `status/<status>`, `domain/<d>`,
  `volatility/<v>`, `freshness/<fresh|stale|unassessed>`, `topic/<t>`), so the graph view
  can colour and filter by them.

  Open the graph view's settings (the cog) → Groups → New group. Suggested:
    tag:#freshness/stale        red
    tag:#type/synthesis         blue
    tag:#type/question          yellow
  Filter the whole graph with the same syntax, e.g. tag:#domain/security.
  Freshness tags are a snapshot from the last `research-vault obsidian` run.
  Obsidian can draw link arrows, but each stub also lists its backlinks as
  wikilinks, so every backlink-forming relation appears as a link in both
  directions (only `superseded_by` stays one-way). The arrows therefore do not
  reflect stored-reference direction or relation type. For that use
  `research-vault related --format mermaid`.
  ```

**Spec 06 (edge model docs, `last_verified` fix)**
- No manifest change. Run `research-vault init --refresh-docs` to pick up AGENTS.md §5.1 (reference-field table) and the corrected §4 `last_verified` definition. `init --refresh-docs` rewrites AGENTS.md and taxonomy.json only; it never touches `meta/`, so hand-replace the first sentence of `meta/freshness-policy.md` §3 with:

  > Before citing any entry, compute `last_verified` ← the latest `verifications[].date` whose `result` is `confirmed` or `changed-trivially`; `outdated`, `unreachable`, and `inconclusive` do not reset the clock, and an entry with no confirming verification has no `last_verified` (null). It is NOT stored.

## [0.5.0] - 2026-08-18

### Changed
- **BREAKING: Node ≥22 required** (was ≥18; Node 18 is end-of-life). `check` now uses the stdlib `fs.globSync` instead of a hand-rolled glob matcher; CI matrix is Node {22, 24}.
- **SSRF guard rewritten on `net.BlockList`.** Same allowlist posture (IPv4 RFC 6890 denylist; IPv6 global-unicast 2000::/3 minus 2001::/23, 2001:db8::/32, 2002::/16), ~100 fewer hand-rolled parsing lines; test suite unchanged.
- Internal dedup from a repo-wide over-engineering audit: canonical type↔folder map in `fsutil.mjs`, shared staleness/`allowedValues`/`normalizeUrlSafe` helpers, `basename(path, '.md')` for id extraction, session-start summary inlined into the hook. No behavior change.

## [0.4.0] - 2026-07-16

- feat: tool-probe cross-validation — treat a tool's own CLI/help/schema output as a re-derivable primary source. New taxonomy values `tool-probe` (verification_method, offline-valid, same-version-gated) and `tool-output` (authority_basis); probe-manifest convention (`meta/probe-manifests/<tool>.md`, read-only commands only) with shared procedure `meta/prompt-templates/probe-tool.md`; lint `TOOL_OUTPUT_VERSION` requires `subject.version` on tool-output sources; capture/verify/orchestrate skills and AGENTS.md updated.

## [0.3.0] - 2026-07-07

### Changed
- **Manifest rows now carry `summary`.** Existing on-disk manifests will report `MANIFEST_STALE` once after upgrading; run `research-vault lint` to rebuild.
- **README rewritten audience-first.** The `refresh` and `export` sections now lead with when and why you'd use the feature instead of its internal mechanics; the exhaustive threat model (double-gating, hash-only, SSRF hardening) moved to a new `SECURITY.md`, linked from a short `Security & privacy` summary.
- **`research-orchestrate` Plan phase requires bodies.** The batch plan prompt now demands per-entry body prose and a one-sentence `summary`.

### Added
- **Extensible taxonomy per vault (`taxonomy_extensions`).** A repo's `.research-vault.json` may additively extend the controlled vocabularies (`domain`, `confidence`, `outcome`, `question_state`, `verification_method`, `verification_result`) so a vault can carry its own terminology without forking the plugin. Extension is additive only: a vault adds values, never removes or redefines built-ins, so a built-in value means the same thing in every vault and entries stay portable. Discovery is keyed on the bound vault (not the working directory), so the vocabulary is the same wherever a command runs. Map-valued taxonomy (`volatility`, `stage_by_folder`, `topic_aliases`) and the open `topics:` tag space are not extensible. Honored by `lint`, `capture`, and `verify`.
- **Body prose for authored entries.** `capture --body-file <path>` and a `body` key on `--batch` specs write real bodies for note/synthesis/snippet/question/experiment entries; a `body` on a source is rejected (source text stays behind `--store-body` + `--ack-data-egress`). Closes the live dry-run defect where batched entries landed as empty scaffolds.
- **`advise` stub-bodies signal.** Authored entries whose body is scaffold-only or empty are surfaced for curation.
- **`summary` field on notes and synthesis.** Optional one-line load-bearing claim in frontmatter (`capture --summary`): indexed in the manifest, scanned by `search --text`, exported as `{input: title, output: summary}` without the body gate, and nudged by a new advisory `WARN_MISSING_SUMMARY` lint warning plus an `advise` signal (`missingSummaries`). Existing vaults stay `lint --check`-clean.
- **Verification tenet — fetch before you assert.** A `source` whose only provenance is `captured` (never an independent check) is not authoritative: it now trips a new `WARN_SOURCE_UNVERIFIED` lint warning and is surfaced by `advise` (`unverifiedSources`). The rule is documented in the generated `AGENTS.md` §7, the `research-review` and `research-authoring` skills, and `docs/ORCHESTRATOR-INTEGRATION.md`. Model recall is not verification — for version currency it is reliably wrong because training lags the present; what cannot be fetched is a `question`, never a `source` stated as fact.
- **`SECURITY.md`** — the full security contract for the two outward-facing features (`refresh`, `export`), plus a vulnerability-reporting contact.
- **`capture --batch <plan.json>`.** Atomic multi-entry capture: every entry is validated (enums, required note `sources` / synthesis `contributingIds`, unresolved references) before anything is written. Later entries may reference earlier ones by deterministic id; duplicates come back as `skipped`, the content-changed tripwire as an error; one manifest rebuild per batch; JSON result on stdout.
- **`research-orchestrate` skill + `/research` command.** The reference implementation of `docs/ORCHESTRATOR-INTEGRATION.md`: vault-first lookup, multi-agent workflow (Recon → Sweep → Fetch+Seed → Verify → Plan → Persist+Gate) with eager source capture, the §2.6 capture plan batched through `capture --batch`, and a lint-gated synthesis. Degrades to an inline sequential lifecycle without the Workflow tool. Supersedes generic deep-research skills in vault-bound contexts.
- **`capture --answer-summary`** (and a batch `answer-summary` key) writes the question `answer_summary` field, making the default `export` reachable via tooling; a new `WARN_ANSWERED_NO_SUMMARY` lint warning nudges answered questions that would export nothing.
- **`init --refresh-docs`** regenerates an existing vault's `AGENTS.md` + `taxonomy.json` after a plugin upgrade — never touching entries, `meta/`, or `.gitignore`.
- **`advise` quote-residue signal** flags frontmatter scalars carrying baked-in `\"` from the pre-0.3.0 serializer.
- **Golden `AGENTS.md` snapshot** (`schema/AGENTS.golden.md`) makes the drift CI check real (generator vs. committed golden, not generator vs. itself).
- **`.research-vault.json` `defaults` + `references.globs` are now consumed** by `capture`/`check` (previously validated but inert).

### Fixed
- **Docs narrowed after a claims gate.** `AGENTS.md` and `docs/REFERENCE.md` say what the code says: the config pointer is written on the first `init` or `--set-default`, the Linux default honours `$XDG_DATA_HOME`, `research-teach` names the reader gate, `advise` lists quote residue, and two slash-command forms that no longer exist are gone. The orchestrate skill calls `--batch` validate-then-write, not atomic.
- **Frontmatter serializer is now lossless.** `parseScalar` un-escapes `\"` (the emit side already escaped it), ending the compounding quote-corruption every parse→serialize cycle used to add — automated by the PostToolUse hook. `[`-leading and comma-containing scalars are now quoted on emit so titles no longer round-trip into arrays.
- **Body bytes are preserved.** Trailing-whitespace normalization now applies to frontmatter lines only, not the body — Markdown hard breaks and trailing-space-significant snippet code survive capture/verify/fix/hook writes.
- **Freshness derives from confirming verifications only.** `unreachable`/`inconclusive` no longer reset the freshness clock; `last_verified` is computed from `confirmed`/`changed-trivially` results in one shared helper.
- **Lint no longer crashes on a malformed `source_url`** — it reports `URL_INVALID` instead of dying (exit 2) and discarding all other diagnostics. Scalar `domain:` is shape-checked (`FIELD_SHAPE`) before enum iteration. `MISSING_REQUIRED` now rejects empty strings/arrays.
- **Intra-batch dedup normalizes the pending side**, so normalization-equivalent URLs in one batch no longer create duplicate entries.

### Upgrading an existing vault

A vault created under 0.2.x is validated by the **current** plugin's schema (the tool never reads a vault's own `taxonomy.json`), so this release's lint tightening applies retroactively. Expect the following on first use after upgrading:

- **New hard-fail lint codes.** `MISSING_REQUIRED` now rejects *empty* values (not just absent ones), and `required_by_type` demands `source_url` (source), `sources` (note), `contributing_ids` (synthesis). Entries the **old tooling itself wrote** — an empty `source_url` when `--url` was omitted, or empty-array note/synthesis — now fail `lint --check` (exit 2). `URL_INVALID` and `FIELD_SHAPE` (scalar `domain:`) are likewise new. None are `lint --fix`-able; each needs a human edit (supply the missing URL/sources/contributors, or supersede the entry). This breaks the team-vault CI gate until fixed — audit with `research-vault lint` before upgrading CI.
- **Widened dangling-ref sweep.** Question `contributing` links are now dangling-checked; previously-invisible broken refs may surface.
- **One-time `MANIFEST_STALE`.** `last_verified` is now derived from *confirming* verifications only, so the on-disk manifest recomputes once — run any `lint`/`capture`/`verify` to rebuild. Side effect: entries whose latest verification was `unreachable`/`inconclusive` correctly **reappear** in `verify --stale`.
- **Quote-residue sweep (run BEFORE any post-upgrade write).** The pre-0.3.0 serializer escaped `"` on emit but never un-escaped on read, so repeatedly-rewritten scalars accumulated `\"`. The 0.3.0 parser strips exactly one level per read; the new lossless serializer then preserves whatever remains as genuine content — permanently — on the first `lint --fix`, `capture`, `verify`, or PostToolUse-hook write. Detect residue first:

  ```bash
  grep -rnF '\"' sources notes synthesis snippets experiments questions
  ```

  `research-vault advise` also lists affected entries under **quote residue**. Fix by hand before the first write.
- **Refresh docs.** Run `research-vault init --refresh-docs` to regenerate this vault's `AGENTS.md` + `taxonomy.json` so agents see the new `--answer-summary` flag, corrected export semantics, and `WARN_ANSWERED_NO_SUMMARY`.
- **Body trailing whitespace already stripped by an older write is unrecoverable** — the 0.3.0 serializer preserves bodies going forward, but cannot restore hard breaks a prior write destroyed.

## [0.2.1] - 2026-06-01

A bug-fix release closing gaps an adversarial review surfaced: documented behavior
that did not hold, plus two paths that could mutate canonical vault data.

### Fixed
- **Docs narrowed after a claims gate.** `AGENTS.md` and `docs/REFERENCE.md` say what the code says: the config pointer is written on the first `init` or `--set-default`, the Linux default honours `$XDG_DATA_HOME`, `research-teach` names the reader gate, `advise` lists quote residue, and two slash-command forms that no longer exist are gone. The orchestrate skill calls `--batch` validate-then-write, not atomic.
- **`lint --fix` now normalizes via the CLI.** It was imported but never invoked, so `--fix` only rebuilt the manifest; it never stripped BOM/CRLF or re-serialized frontmatter.
- **`obsidian --out` can no longer overwrite canonical entries.** A `--out` that escapes the vault, is the vault root, or targets an entry folder (e.g. `--out sources`) is refused.
- **`export --out` can no longer write inside the vault**, preserving the read-only-on-the-vault guarantee.
- **`capture` refuses to overwrite an existing id** (same date + title) instead of silently clobbering; supersede via `verify` instead.
- **Integer `subject.version` now dedups correctly** (the URL + version comparison no longer fails on a string-vs-number mismatch).
- **`capture --content-file` hashes the file's raw bytes**, matching what `refresh` computes (previously it hashed a UTF-8 decode).
- **`init` refuses to overwrite a non-empty or customized vault**, not just one that already has entries.

### Changed
- **`capture` seeds a `captured` verification** at creation time instead of a fake `existence-check: confirmed`; `verify` rejects `captured` as a verification method.

### Added
- **`captured` verification method** in the taxonomy (capture-time provenance; not a verification).

## [0.2.0] - 2026-05-31

Completes the lint "detective floor", then adds five new commands plus richer
ingest and two derived-view exporters — all additive and preserving the
zero-dependency, hand-editable core. `lint --check` remains the only correctness
guarantee; every new artifact is a regenerable cache, never a source of truth.

### Added
- **`compile`** — regenerate a human-readable index into a git-ignored `_index/` directory (grouped by type); a derived cache, never authoritative.
- **`advise`** — read-only curation report (stale entries, orphans, sources lacking a distilling note, aliasable topics), plus a `research-librarian` skill. Never mutates the vault.
- **`obsidian`** — derived, non-mutating Obsidian view: one `[[wikilink]]` stub per entry (forward links + backlinks) plus a Map-of-Content, written to a git-ignored `_obsidian/` directory.
- **`refresh`** — opt-in web freshness re-check: fetch a source URL, recompute its `content_hash`, and report `confirmed` / `changed` / `unreachable` without mutating any entry. Off by default and double-gated (`RESEARCH_VAULT_ALLOW_NETWORK=1` **and** the subcommand).
- **`export`** — read-only JSONL export for external finetuning/eval; emits answered-question summaries + per-entry metadata by default.
- **`capture --scaffold`** — opt-in per-type body skeletons (`vault-template/meta/entry-skeletons/<type>.md`).
- **`capture --content-file` / `--captured-via` / `--store-body`** — hash content from a local file, record provenance, and (with `--ack-data-egress`) store source text in the body. No network.
- Non-blocking **`SessionStart`** Claude Code hook that prints a one-line vault summary (entries + stale count).
- **`search --body`** — opt-in substring scan of entry bodies.
- **`vault-template/.gitignore`** so initialized vaults ignore derived caches (`.vault-manifest.json`, `_index/`, `_obsidian/`).
- New slash commands: `/research-advise`, `/research-compile`, `/research-obsidian`.

### Changed
- **Detective floor completed.** `lint` now validates every controlled enum (`confidence`, `outcome`, `question_state`, verification `by_type`), and `lint --check` compares the **full** manifest — including `backlinks` — for staleness; the manifest is canonicalized (sorted entries + backlinks) for determinism.
- **Fail-fast mutators.** `capture` and `verify` reject unknown controlled values up front via a shared `bin/lib/validate.mjs`, writing nothing on a bad value.
- `verify` now validates `result` against the taxonomy and refuses `outdated` without `--superseded-by`.
- `listStale` moved to `bin/lib/stale.mjs` (removes a `lib → commands` import).
- Spec aligned with the implementation: retired `INDEX.md`, `taxonomy.yaml` → `taxonomy.json`, documented `search --body`, corrected the generated-`AGENTS.md` framing.
- README: command surface synced (all 12 commands), added "Two ways to use it" (prose vs. command) and "Team use" sections, renamed Security → "Security & privacy".

### Fixed
- **Docs narrowed after a claims gate.** `AGENTS.md` and `docs/REFERENCE.md` say what the code says: the config pointer is written on the first `init` or `--set-default`, the Linux default honours `$XDG_DATA_HOME`, `research-teach` names the reader gate, `advise` lists quote residue, and two slash-command forms that no longer exist are gone. The orchestrate skill calls `--batch` validate-then-write, not atomic.
- **Hook path containment.** Replaced the unsafe `startsWith` vault-containment check with a resolved-path, separator-aware `isInsideVault` (rejects siblings like `<vault>-evil` and cross-drive paths); switched the hook to exec-form invocation.

### Security
- **`refresh` SSRF guard (allowlist posture).** Only global-unicast addresses are accepted; all RFC 6890 private / loopback / link-local / CGNAT / ULA / documentation / multicast / reserved ranges are rejected — including IPv4-mapped/translated/compatible IPv6 forms, 6to4, NAT64, the cloud-metadata address `169.254.169.254`, and alternate numeric host encodings. The socket is pinned to the pre-validated IP (no re-resolution, no pooling), every redirect hop is re-validated, scheme downgrades are forbidden, and body-size + timeout caps bound each request; no cookies or auth headers are sent.
- **Data-egress gating.** `export` emits entry bodies only with **both** `--include-bodies` and `--ack-data-egress` (metadata-only by default); `capture --store-body` likewise requires `--ack-data-egress`.

## [0.1.0]

Initial release.

### Added
- Zero-dependency Node ≥18 ESM CLI: `init`, `lint`, `capture`, `verify`, `search`, `related`, `manifest`.
- Schema-driven taxonomy (`schema/taxonomy.json` + `schema/frontmatter.schema.json`) as the single source of truth for vocabulary and field rules.
- Six entry types (sources, notes, synthesis, snippets, experiments, questions) with a deliberate `sources → notes → synthesis` distillation flow.
- Freshness governance: per-entry `volatility` tiers + a verification log; URL + version dedup; a computed backlink manifest.
- `lint` / `lint --check` correctness floor; generated `AGENTS.md`; encoding/drift CI gates across {Linux, macOS, Windows} × Node {18, 20, 22}.
- Claude Code plugin: skills (`research-vault-usage`, `research-capture`, `research-verify`) and an optional `PostToolUse` lint-fix hook.
