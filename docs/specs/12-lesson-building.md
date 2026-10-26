# Spec 12: lesson building in research-teach

Round 4 (2026-10-26). Spec 11 made sure a wrong lesson cannot reach the learner unrecorded. This spec is about building a good one. Today §4 of `research-teach` is a list of pedagogy bullets and the lesson has no format file, no shipped components, no mechanical check, and no procedure for choosing what to teach next or for the retrieval-practice lessons §6 promises. Four lessons from the vcluster support lab carry over. A format file per document class (mission, glossary and learning records already have one). A mechanical gate that runs before the LLM gate, as the lab's prose engine runs before its claims reviewer. A plan written before the evidence is gathered, as the lab's investigation log is. Components shipped once rather than rewritten per lesson.

## Problems

1. No lesson format. Each lesson is improvised from eight bullets, so structure, length and citation style drift between lessons and between sessions.
2. Quiz hygiene is left to the model. "Answers of equal length; correct position varies; no formatting tells" is exactly what a model gets wrong, and nothing checks it.
3. No shared components exist. §4 says "read `assets/` before writing; the shared stylesheet is the first asset", but the plugin ships none, so the first lesson invents them and later lessons inherit whatever it invented.
4. Probing happens after drafting. §3 requires every behaviour claim to be probed, but nothing makes the probe target the claims the lesson will make; the probe is written to match the draft, not the other way round.
5. "Teach the next thing in the zone of proximal development" has no procedure. The mission's success criteria and the learning records are never compared.
6. Retrieval-practice lessons are named in §6 and surfaced by the session brief, but their shape is undefined: what they contain, where the result goes, how a failure feeds back.
7. Reference docs are "a rendering of a vault note" with no stated shape, so their freshness line and their link to the note are optional in practice.
8. Nothing checks a lesson before the claims gate. Missing citations, dangling links to other lessons, a quiz with two items, or a lesson with no observable step all reach the reviewer, who is not built to catch them.

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
- A citation anchor is `<a data-cite="<vault id>">` so `check` and `gate evidence` find the id (they already extract date-prefixed ids from text) and the lint can tie each claim paragraph to one.
- The quiz is a `<script type="application/json" data-quiz>` block: `{ "items": [{ "q", "options": [string, 3 or 4], "correct": index, "why": [string per option] }] }`. Options are shuffled at render time by the widget, so position tells cannot exist; the lint checks answer length instead.
- Retrieval-practice lessons are `lessons/NNNN-review-slug.html`: `mission`, `quiz`, `followup` and `sources` only, no `fact`, no `example`, no `step`. Items are drawn from two or three learning records (interleaving), each item naming its record in `data-record`. The lesson ends by asking the learner to report the score in the terminal; a wrong answer on a record's item is a corrected-misconception candidate, which §6 already defines as a learning-record trigger.
- Reference docs are `reference/slug.html` with `data-block="note"` naming the vault note id, a `Last verified <date>` line copied from the note's `last_verified`, the rendered note body, and `sources`. The lint reads the note and fails when the date in the doc is older than the note's, which is the "re-verified before trusted" rule from §6 made checkable.

### Shipped components (3)

- `skills/research-teach/assets/lesson.css` and `skills/research-teach/assets/quiz.js`, copied into the workspace's `assets/` by the skill before the first lesson (`cp -n`, never overwriting a workspace's edited copy). The CSS carries the block styles and a print stylesheet for reference docs. `quiz.js` is an ES module with three pure functions. `shuffleOptions(item, rand)` returns a new item with options and `why` permuted together and `correct` remapped. `grade(items, answers)` returns `{ score, total, wrong: [index] }`. `answerLengthSpread(item)` returns the longest option length divided by the shortest. The DOM code that renders the quiz, gives immediate per-option feedback from `why` and shows the score runs only when `document` exists, so the same file is importable from Node tests and the lint.

### Lesson lint (2, 8)

- `research-vault teach lint <lesson.html | reference.html | workspace dir>`, in `bin/commands/teach.mjs` with the pure checks in `bin/lib/lesson.mjs`. Output one line per finding `<CODE> <file>  <detail>` and a summary; exit 1 on any finding, 0 otherwise. Codes:
  - `LESSON_BLOCK_MISSING` (a required block for the lesson class is absent), `LESSON_FACT_TOO_LONG` (over `FACT_WORDS`), `LESSON_CLAIM_UNCITED` (a `<p>` inside `fact` with no `data-cite` anchor), `LESSON_CITE_UNRESOLVED` (a `data-cite` id with no vault entry; uses `checkCitations`), `LESSON_LINK_DANGLING` (an `href` to `lessons/`, `reference/` or `GLOSSARY.md#` that does not exist), `LESSON_FOLLOWUP_MISSING`.
  - `QUIZ_TOO_FEW` (under `QUIZ_MIN_ITEMS`), `QUIZ_OPTION_COUNT` (not 3 or 4), `QUIZ_ANSWER_SPREAD` (`answerLengthSpread` over `QUIZ_SPREAD_MAX = 1.6`), `QUIZ_WHY_MISSING` (fewer `why` strings than options), `QUIZ_JSON_INVALID`.
  - `REVIEW_RECORD_MISSING` (a review item's `data-record` names no file under `learning-records/`), `REFERENCE_NOTE_STALE` (doc date older than the note's `last_verified`), `REFERENCE_NOTE_UNRESOLVED`.
  - `EVIDENCE_PLAN_MISSING` (no `evidence/NNNN/PLAN.md` for a lesson that has a `fact` block).
- The skill runs `teach lint` after writing a lesson and before the claims gate, and again after any revision, the same sequencing the lab uses for its prose gate.

### Plan before probe (4)

- `evidence/NNNN/PLAN.md` is written before any probe or draft. It holds five parts: the win in one sentence; the fact to teach; the claims the lesson will make, one per line, each the sentence the probe must support; the probe, meaning what to run and what output would support each claim; the step, meaning the real-world action and its observable result. The probe is then written against the plan's claim lines, and the lesson's `fact` block states only claims the plan listed. The lint's `EVIDENCE_PLAN_MISSING` enforces existence; the claims gate enforces the rest.

### Choosing the next lesson (5)

- §4 gains a procedure. List the mission's "Success looks like" bullets and, for each, the learning record that evidences it, if any. Stale records (older than `SPACING_DAYS`) and failed review items come first, as retrieval-practice candidates. Otherwise take the first unevidenced bullet whose prerequisites (glossary terms and earlier lessons) are covered. A learner's explicit request overrides the procedure. The chosen bullet goes in `PLAN.md`'s first line so every lesson traces to the mission.
- `research-vault teach next <workspace>` prints that table (bullet, evidencing record or none, stale candidates) so the model does not re-derive it by reading every record. Read-only.

### Opening the lesson

- After the gate records PASS or MERIT, open the file with `open` on macOS and `xdg-open` elsewhere, and print the path. One line in the skill; no CLI support.

## Not in scope

- Scoring persistence. Quiz results reach the workspace only through the learner's report in the terminal and the learning record it produces.
- Changes to the pedagogy bullets themselves, the mission, glossary or learning-record formats.
- A browser test of the widget; the pure functions are tested in Node, the DOM code is reviewed.

## Deferred

- A `teach lint --fix` that renumbers lessons or rewrites citation anchors.
- Interleaving across workspaces.
