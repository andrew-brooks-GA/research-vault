# Spec 12: lesson building in research-teach

Round 4 (2026-10-26). Spec 11 made sure a wrong lesson cannot reach the learner unrecorded. This spec is about building a good one, and about keeping what the learner does in a store with the same shape as the vault. Today §4 of `research-teach` is a list of pedagogy bullets; the lesson has no format file, no shipped components, no mechanical check, no procedure for choosing what to teach next, and the retrieval-practice lessons §6 promises have no shape. Learner state is loose markdown with no frontmatter, no schema and no verbs, so it is edited by hand and read by re-reading every file.

Four lessons from the vcluster support lab carry over. A format file per document class (mission, glossary and learning records already have one). A mechanical gate that runs before the LLM gate, as the lab's prose engine runs before its claims reviewer. A plan written before the evidence is gathered, as the lab's investigation log is. Components shipped once rather than rewritten per lesson. And the vault's own rules: one file per entity, frontmatter the schema validates, the filename is the id, references are ids and never paths, derived fields are never stored, lint is the guarantee, and a wrong entry is superseded rather than rewritten.

This spec was reviewed once for conformance to the plugin's and the lab's practices (2026-10-26); the design below incorporates that review.

## Problems

1. No lesson format. Each lesson is improvised from eight bullets, so structure, length and citation style drift between lessons and between sessions.
2. Quiz hygiene is left to the model. "Answers of equal length; correct position varies; no formatting tells" is exactly what a model gets wrong, and nothing checks it.
3. No shared components exist. §4 says "read `assets/` before writing; the shared stylesheet is the first asset", but the plugin ships none.
4. Probing happens after drafting. §3 requires every behaviour claim to be probed, but nothing makes the probe target the claims the lesson will make.
5. "Teach the next thing in the zone of proximal development" has no procedure. The mission's success criteria and the learning records are never compared.
6. Retrieval-practice lessons are named in §6 and surfaced by the session brief, but their shape is undefined.
7. Reference docs are "a rendering of a vault note" with no stated shape, so the link to the note is optional in practice.
8. Nothing checks a lesson before the claims gate. Missing citations, dangling links, a two-item quiz or a lesson with no observable step all reach the reviewer, who is not built to catch them.
9. Quiz results never reach the workspace. A lesson is a file opened from disk; the browser cannot write, so the learner reports the score by hand, and nothing ties a score to the record it tested.
10. Learner state has no store. Learning records carry no frontmatter and no schema; there is no verb to add, supersede or list them; `teach next` and the session brief would have to walk and parse every file.

## Design

### Lesson format (1, 7)

- `skills/research-teach/LESSON-FORMAT.md`, in the same register as the three existing format files. A lesson is one HTML file `lessons/NNNN-slug.html` made of blocks, each marked by a `data-block` attribute so a machine can find them:
  - `mission`: one sentence tying the win to `MISSION.md`.
  - `fact`: the knowledge, at most `FACT_WORDS = 300` words, every claim followed by a citation anchor.
  - `example`: the probe's input and verbatim output, from the lesson's `snippet` and `experiment` entries.
  - `quiz`: the quiz data block below, at least `QUIZ_MIN_ITEMS = 3` items.
  - `step`: one real-world action with an observable result, and the command or action to take.
  - `sources`: the vault ids and primary source cited, one recommended read marked.
  - `followup`: the fixed sentence that the learner can ask follow-up questions in the terminal.
  - `prereq` (optional): links to earlier lessons and glossary anchors.
- The lesson id is the file name without extension, `NNNN-slug`; it is what records and attempts refer to. The id grammar `^\d{4}-[a-z][a-z0-9-]*$` (the slug starts with a letter, so no embedded date) does not match the vault's citation id pattern, so a lesson id in prose is never taken for a vault citation.
- A citation anchor is `<a data-cite="<vault id>">`, so `check` and `gate evidence` find the id (they extract date-prefixed ids from text) and the lint can tie each claim paragraph to one.
- The quiz is a `<script type="application/json" data-quiz>` block: `{ "items": [{ "q", "options": [3 or 4 strings], "correct": index, "why": [one string per option], "record": "<learning-record id>" (review lessons only) }] }`. Indexes refer to the authored order. Options are shuffled at render time by the widget, which maps a click back to the authored index, so position tells cannot exist; the lint checks answer length instead.
- Retrieval-practice lessons are `lessons/NNNN-review-slug.html`: `mission`, `quiz`, `followup` and `sources` only. Items are drawn from two or three learning records (interleaving), each item naming its record. A wrong answer on a record's item is a corrected-misconception candidate, which §6 already defines as a learning-record trigger.
- Reference docs are `reference/slug.html` with `data-block="note"` carrying `data-cite="<vault note id>"`, the rendered note body, and `sources`. No freshness date is stored in the doc: `last_verified` is derived (AGENTS.md §4), and a stale note already surfaces through the existing stale-citation check in the session brief and `check`.

### Shipped components (3)

- `skills/research-teach/assets/lesson.css` and `skills/research-teach/assets/quiz.js`, copied into the workspace's `assets/` by the skill before the first lesson (`cp -n`, never overwriting a workspace's edited copy). The CSS carries the block styles and a print stylesheet for reference docs.
- `quiz.js` is an ES module with three pure functions. `shuffleOptions(item, rand)` returns a new item with options and `why` permuted together, `correct` remapped, and `order` (the authored index of each displayed option) so a click maps back. `grade(items, answers)` takes authored-order answer indexes and returns `{ total, wrong: [item index] }`. `answerLengthSpread(item)` returns the longest option length divided by the shortest. The DOM code that renders the quiz, gives immediate per-option feedback from `why` and shows the score runs only when `document` exists, so the same file is importable from Node tests and the lint.
- When the page's origin is `http://127.0.0.1:<port>` (served by `teach serve`), the widget POSTs `{ "lesson": "<lesson id>", "answers": [authored indexes] }` to `/attempt` once every item is answered and shows the server's reply; otherwise it shows the score and the sentence asking the learner to report it in the terminal.

### Workspace store (9, 10)

- Two entity types, each one markdown file with YAML frontmatter, filename is the id:
  - `learning-record`, in `learning-records/NNNN-slug.md`: `title`, `type: learning-record`, `date` (YYYY-MM-DD, UTC), `status: active | superseded`, `superseded_by` (a record id, only when superseded), `lesson` (a lesson id, optional), `kind: understanding | prior-knowledge | misconception | mission-shift` (the four triggers in §6). Body as today: one to three sentences, optional Evidence and Implications sections.
  - `attempt`, in `attempts/a-<YYYYMMDD>-<HHMMSS>-<NNNN>.md` where `NNNN` is the lesson number: `type: attempt`, `date`, `lesson` (lesson id), `total` (item count at write time), `wrong` (authored item indexes), `records` (learning-record ids the wrong items tested, read from the lesson's quiz data at write time). `total` and `records` are snapshots, because a lesson may be revised later and the attempt must keep meaning what it meant. The score is derived (`total - wrong.length`) and never stored. The id grammar starts with `a-` and has no `YYYY-MM-DD-` prefix, so an attempt id never matches the citation pattern. Created with an exclusive `wx` write; on collision the second within one second gets `-2`, `-3` and so on.
- `schema/teach.schema.json`, in the same field-list form as `schema/frontmatter.schema.json` (`common`, `by_type`, `required_by_type`, `edge_fields`), with its controlled values in `schema/teach-taxonomy.json` in the form of `schema/taxonomy.json`. `bin/lib/schema.mjs` gains `loadTeachSchema(repoRoot)` beside `loadSchema`; nothing about the vault schema changes.
- Edges are named after the field that declares them and point from the declaring entry, as in the vault: `superseded_by` (record to record) and `records` (attempt to record). Which attempts evidence a record, and which lessons test it, are derived backlinks, never stored.
- Rules, the vault's: a record is superseded, not rewritten; an attempt is never edited. The lint cannot prove either rule; it checks what it can (supersession pairs resolve, no derived field is stored, the type matches the folder).
- No persisted manifest. `bin/lib/teach.mjs` exports `teachIndex(workspaceDir, { now })`, which walks `MISSION.md`, `lessons/`, `reference/`, `learning-records/` and `attempts/` and returns `{ criteria: [...], lessons: [{ id, number, class, title, cites, records }], records: [rows with derived evidence and lastAttempt], attempts: [rows], backlinks }` in memory. `teach next`, `teach lint` and the session brief call it; nothing is written and nothing can go stale.
- Verbs in `bin/commands/teach.mjs`, with the pure functions in `bin/lib/teach.mjs`. Every verb takes a workspace: the positional path, else the cwd when it holds `MISSION.md`, else usage on stderr and exit 2. Values are validated against the teach schema before any write (the vault's `assertControlledValues` discipline); an invalid value is an error and nothing is written.
  - `teach record add --title <t> --kind <k> [--lesson <id>] [--body-file <path>]`: next number, writes the file, prints the id.
  - `teach record supersede <id> --by <id> [--reason <text>]`: sets `status` and `superseded_by` on the old record and appends a `Superseded by <id>: <reason>` line to its body. The only in-place edit a record ever receives.
  - `teach attempt add --lesson <id> --answers <authored indexes, comma list>`: grades against the lesson's quiz data, writes the attempt, prints the id and the score. `teach serve` calls the same function.
  - `teach lint [--fix] [workspace]`: the checks below, in the vault lint's output form (`<code>  <file>: <message>`, `warning ` prefix for the `WARN_` class, `lint: clean` when nothing fires), exit 1 on any non-warning finding.
  - `teach next [workspace]`: see "Choosing the next lesson".
  - `teach serve [workspace]`: see "Serving and recording".
- Upgrade path, in `teach lint --fix`, idempotent (a second run changes nothing): a record with no frontmatter gets `title` from its first heading, `type`, `date` from the file's mtime (UTC), `kind: understanding`, and `status: active` unless its body carries the old `Status: superseded by LR-NNNN` line, which becomes `status: superseded` and `superseded_by: <the record whose number is NNNN>`; the old line is left in the body. `LEARNING-RECORD-FORMAT.md` is rewritten for the frontmatter template, `kind`, and ids of the form `NNNN-slug` instead of `LR-NNNN`. The CHANGELOG's upgrading section says to run `teach lint --fix` once per workspace and that `attempts/` is not gitignored; it is learner data, committed or not at the owner's choice.

### Lesson lint (2, 8)

- Codes reused from the vault lint for the store: `PARSE` (unparseable frontmatter), `MISSING_REQUIRED`, `ENUM_*` (a controlled value outside the taxonomy), `DANGLING_REF` (a `superseded_by`, `lesson` or `records` id with no file), `SUPERSEDE` (a superseded record without `superseded_by`, or `superseded_by` on an active one), `STORED_DERIVED` (a stored `score`, `evidence` or `last_verified`), `TYPE_FOLDER` (type does not match the folder). A record with no frontmatter at all is `WARN_RECORD_FRONTMATTER_MISSING`, fixable.
- Codes for lessons and reference docs: `LESSON_BLOCK_MISSING`, `LESSON_FACT_TOO_LONG` (over `FACT_WORDS`), `LESSON_CLAIM_UNCITED` (a `<p>` inside `fact` with no `data-cite` anchor), `LESSON_CITE_UNRESOLVED` (a `data-cite` id with no vault entry, via `checkCitations`; a stale or superseded entry still resolves, freshness is the claims gate's job), `LESSON_LINK_DANGLING` (an `href` to `lessons/`, `reference/` or `GLOSSARY.md#` that does not exist), `LESSON_FOLLOWUP_MISSING`; `QUIZ_TOO_FEW`, `QUIZ_OPTION_COUNT` (not 3 or 4), `QUIZ_CORRECT_RANGE` (`correct` outside the options), `QUIZ_ANSWER_SPREAD` (`answerLengthSpread` over `QUIZ_SPREAD_MAX = 1.6`), `QUIZ_WHY_MISSING`, `QUIZ_JSON_INVALID`, `QUIZ_RECORD_UNRESOLVED` (a review item's `record` names no learning record); `EVIDENCE_PLAN_MISSING` (an `evidence/NNNN/` folder exists for a lesson with a `fact` block and holds no `PLAN.md`). A lesson with a `fact` block and no `evidence/NNNN/` folder at all predates this spec and gets `WARN_EVIDENCE_FOLDER_MISSING`, advisory.
- The skill runs `teach lint` after writing a lesson and before the claims gate, and again after any revision.

### Plan before probe (4)

- `evidence/NNNN/PLAN.md` is written before any probe or draft. Five parts: the win in one sentence; the fact to teach; the claims the lesson will make, one per line, each the sentence the probe must support; the probe, meaning what to run and what output would support each claim; the step, meaning the real-world action and its observable result. The probe is then written against the plan's claim lines, and the lesson's `fact` block states only claims the plan listed. When a probe contradicts a claim line, the line is not edited: a `## Revisions` section is appended naming the line, the result and the replacement claim, the same append-never-edit rule the lab applies to investigation logs. The plan is the drafter's working note; the claims gate sees only the draft and the vault evidence, as spec 11 requires, and the lint's `LESSON_CLAIM_UNCITED` is what ties each stated claim to evidence.

### Choosing the next lesson (5)

- §4 gains a procedure. List the mission's "Success looks like" bullets. Read the active learning records and their last attempt. Records older than `SPACING_DAYS` with no attempt since, and records whose last attempt got their item wrong, come first as retrieval-practice candidates. Otherwise take the first criterion no record evidences whose prerequisites (glossary terms and earlier lessons) are covered. A learner's explicit request overrides the procedure. The chosen criterion goes in `PLAN.md`'s first line so every lesson traces to the mission.
- `teach next` prints the inputs to that judgment and nothing more: the criteria as a numbered list; a table of active records `| id | kind | date | lesson | last attempt |` where the last attempt reads `3/4 on 2026-10-20` or `none`; then `review-due: <ids>` and `review-failed: <ids>`. No text matching between criteria and records; the model does the matching by reading.
- `SPACING_DAYS = 21` moves to `bin/lib/teach.mjs`; `hooks/session-start.mjs` imports it from there.

### Serving and recording (9)

- `teach serve [workspace]` is a `node:http` server bound to `127.0.0.1` on a random free port. Every request, GET or POST, must carry `Host: 127.0.0.1:<port>`; anything else is 403 before any work, which closes DNS rebinding for reads as well as writes. It serves static files only from `lessons/`, `reference/`, `assets/` and `GLOSSARY.md`, resolving each path with `isInsideVault(workspaceDir, resolved)` from `bin/lib/containment.mjs` (already generic) and answering 404 for anything else, so `NOTES.md`, records and attempts are never readable over HTTP. It accepts exactly one write: `POST /attempt` with `Content-Type: application/json`, a body of at most `ATTEMPT_BODY_MAX = 4096` bytes, and `Origin` equal to the server's own `http://127.0.0.1:<port>`; anything else is 403 before the body is read. The body is `{ "lesson": "<lesson id>", "answers": [integers] }`; the lesson id must match the lesson id grammar and name an existing `lessons/<id>.html`, and `answers` must be one integer per quiz item in range, else 400 and nothing is written. The server grades from the lesson's quiz data (the client never reports a score), writes the attempt through the same function as `teach attempt add`, and replies `{ "id", "score", "total", "wrong" }`. It prints the URL, writes it to `.teach-serve.json` (`{ port, pid }`) in the workspace so the skill can find a running server, removes that file on exit, and keeps running until killed; it never writes anything else and never listens on another interface. `.teach-serve.json` is listed in the workspace's `.gitignore` by the skill's first-lesson setup step.
- `SECURITY.md` gains the server as the second local writer and the second network feature, with the limits above; `docs/specs/README.md`'s shared rules are amended twice: "no new runtime services" names this one exception and why (the browser cannot write to the workspace any other way), and "no schema fields that lint enforces" is scoped to the vault schema, since the teach schema is a separate file that governs the workspace, not the vault.

### Session brief

- `hooks/session-start.mjs` calls `teachIndex` and prints `research-teach <ws>: <n> record(s) review-due; <m> reference doc(s) with a stale citation; last attempt <score>/<total> on <lesson id>` (the last clause omitted when there is no attempt). The existing test strings change accordingly.

### Opening the lesson

- After the gate records PASS or MERIT, the skill reads `.teach-serve.json`; when it is absent or its `pid` is gone, it starts `teach serve` in the background. It then prints the lesson's URL, and opens it with `open` on macOS or `xdg-open` elsewhere. With no browser available, it prints the path.

### Tests

- Every isolation or containment claim has a paired positive and negative test with printed counts: a file inside the workspace is served and `../` outside is refused; a valid POST writes exactly one attempt file and a wrong method, a foreign `Origin`, a wrong `Host`, a wrong `Content-Type`, an oversized body, a malformed body, an unknown lesson and an out-of-range answer each write none. `--fix` is tested for idempotence (second run, no diff) and for the `LR-NNNN` migration. Every lint code has a fixture that fires it and a fixture that does not.

## Not in scope

- Registering `teach` in `bin/research-vault.mjs` and the round 4 row in `docs/specs/README.md` are build steps, not design.
- Changes to the pedagogy bullets, the mission or glossary formats.
- A browser test of the widget or the server's HTML; the pure functions and the HTTP endpoint are tested in Node, the DOM code is reviewed.
- Interleaving across workspaces.
- Any persisted index or manifest for the workspace.

## Deferred

- A `teach lint --fix` that renumbers lessons or rewrites citation anchors.
- `related`-style traversal over the store's edges; `teachIndex` exposes backlinks, nothing consumes them beyond `next` and the brief.
