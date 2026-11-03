# Lesson Format

A lesson is one HTML page the learner opens in a browser. It is built from blocks, each marked with a `data-block` attribute, so `teach lint` can check it before the claims gate does. Run `teach lint` after writing a lesson and after every revision.

## Files and ids

- Lessons: `lessons/NNNN-slug.html`, next number after the highest present. The id is the file name without `.html` (`0001-what-fx-returns`). The slug starts with a letter, so the id does not begin with the `YYYY-MM-DD-` prefix of a vault id; do not embed a date in the slug.
- Review lessons: `lessons/NNNN-review-slug.html`, numbered in the same sequence.
- Reference docs: `reference/<slug>.html`.
- The body declares the terms the lesson introduces: `data-introduces="Envoy,data plane"`, at most three, each defined in a `<dfn>` element where it is first explained. See Terms.
- The body declares the lesson's shape: `<body data-lesson="<id>" data-shape="tool">`, one of `concept`, `tool`, `diagnose` or `project` (see Shapes). A lesson with no `data-shape` is a `concept` lesson with the block list it had before shapes.
- The body may declare the tools the lesson teaches: `<body data-lesson="<id>" data-teaches="istioctl">` (comma-separated). A later lesson may then run that tool; see Commands and tools.
- The page loads the shared components with `<link rel="stylesheet" href="../assets/lesson.css">` in the head and `<script type="module" src="../assets/quiz.js"></script>` before `</body>`, and the body carries the lesson id: `<body data-lesson="<id>">`, where `data-lesson` equals the file name without `.html`. The widget takes the id from the served path `/lessons/<id>.html` first and falls back to `data-lesson`.
- Links the lint resolves: `../GLOSSARY.md#<heading-slug>`, `<id>.html` for another lesson (`../lessons/<id>.html` from a reference doc), `../reference/<slug>.html` for a reference doc. A link to any of these that does not exist is a finding.

## Blocks

Each block is an element with `data-block="<name>"`, normally a `<section>`. Order them as the lesson's shape lists them (Shapes). Each block carries `aria-label` equal to the label the stylesheet shows above it (the label column below), so a screen reader gets the structure the labels show.

| Block | Label | Required for | Holds |
|---|---|---|---|
| `prereq` | before you start | optional in a lesson or review | Links to earlier lessons and glossary anchors |
| `mission` | why this lesson | lesson, review | One sentence tying the win to `MISSION.md`; in a `concept`, `tool` or `diagnose` lesson one stating the idea, what is true about the subject, in terms allowed before this lesson's `data-introduces` and without naming the new term; then in a shaped lesson one naming the activity ("you will complete the command yourself"). Review and `project` lessons carry no idea sentence. |
| `predict` | first look | diagnose | One `<pre>` output and a `data-quiz` with one item, asked before the explanation |
| `model` | the model | concept, tool, diagnose | The mental model: a bridge from a Floor term, at least one `<figure>` diagram, and how the parts relate, with at least one citation anchor in the block (a `source` or `note`, since a model is what the docs say) |
| `fact` | what the evidence shows | concept, diagnose | What the evidence established, by the probe or by the passages the plan lists, one cited claim per `<p>`, two to five `<p>` of one or two sentences each, every `<p>` ending in a citation anchor. Beside an `example` block it is the summary read first; the example is the walkthrough of the same run, so the fact block does not retell it and the model block does not narrate it |
| `example` | the output, read with me | tool | The probe's input and verbatim output, cited to its `snippet` and `experiment` |
| `quiz` | check yourself | concept, diagnose, review | The quiz data block (below) |
| `complete` | do it yourself | tool | The example's command with one part withheld: one `<pre>` command with `<mark aria-label="withheld">____</mark>` over that part, then one `<pre>` expected output |
| `scaffold` | do it yourself | project | A completion task in the `complete` form over the reference solution |
| `step` | do it yourself | tool, project | One real-world action and its observable result, with the command to run when the action is one; a step with no command states its expected result, and what a mismatch means, in prose, never in a `<pre>` |
| `connect` | say it back | concept | The terminal prompt: say how the new term relates to two terms you already hold; the page names the terms and nothing of how they relate |
| `sources` | sources | lesson, review, reference | The vault ids cited, with one marked `(recommended read)`; source anchors carry `href` (Citation anchors) |
| `followup` | follow up | lesson, review | Exactly the sentence `You can ask follow-up questions in the terminal.`, after one sentence stating the win now held |
| `note` | reference | reference | The rendered vault note body, with `data-cite` on the block element |

A lesson with no `data-shape` needs `mission`, `model`, `fact`, `example`, `quiz`, `step`, `sources` and `followup`. A missing required block is `LESSON_SHAPE_BLOCK_MISSING`.

In `step`, state the command exactly as the experiment's Result quotes it, so the claims gate can match it. When the step names the probe's path, keep that path in the captured snippet.

## Shapes

A lesson declares its shape with `data-shape` on the `<body>`. The frame is the same on every page: `prereq` (optional), `mission`, the shape's middle, `sources`, `followup`. Only the middle varies, and `bin/lib/lesson.mjs` reads it from one table, `SHAPES`:

| Shape | The win | Middle blocks, in order | The retrieval it must contain |
|---|---|---|---|
| `concept` | a term set and the model behind it | `model`, `fact`, `quiz`, `connect`; `example` and `step` optional | a quiz whose wrong options are nameable misreadings, then `connect` |
| `tool` | one tool: what it is, one command, how to read its output | `model`, `example`, `complete`, `step`; `quiz` optional | `complete`, the worked command with one part withheld, then the unaided `step` |
| `diagnose` | reading output and deciding what it means | `predict`, `model`, `fact`, `quiz`; `step` optional | `predict`, one question on the output before the explanation; quiz lures are the misreadings |
| `project` | a whole task that needs several earlier lessons at once | `scaffold` on the mission's first project, then `step` | the task itself; `step` is the check that proves the goal, a command and its expected output or the answer or artefact the learner shows, and the learner's run is the attempt |

The idea sentence in `mission` is the page's lead: what the reader can say the page teaches after the mission block, distinct from the win (what they can do afterwards) and the activity (what they do on the page).

Review lessons keep their own list (Review lessons) and ignore `data-shape`.

- A `data-shape` outside the table is `LESSON_SHAPE_UNKNOWN`.
- A `tool` lesson declares the tool it teaches with `data-teaches`, and no other shape carries `data-teaches`; either break is `LESSON_SHAPE_MISMATCH`. A lesson with no `data-shape` is not checked against this rule.
- In `complete`, the command with the withheld part filled must be a command the `example` block ran (a `$ ` line there); the lint reads the mark as any text. A `complete` block whose command does not match, or that has no `<pre>` holding the mark, is `LESSON_COMPLETE_NOT_WORKED`.
- `predict` holds a `<pre>` output and a `<script type="application/json" data-quiz>` with exactly one item; anything else is `LESSON_PREDICT_INVALID`. The item's question, options and whys are prose for the term rule (Terms), so they use only terms allowed before this lesson's `data-introduces`. The widget merges the item into the lesson's one attempt as item 0, before the quiz items: one answers list, one POST, one score on `/progress`.
- `connect` is a prompt answered in the terminal, not a quiz item: the skill judges the answer in conversation, against the plan's Fact, and records an understanding record when it holds. The page states the prompt and nothing else: no model answer, no "it holds if" sentence, no restatement of the relation, since the learner constructing the link is the point; a check the learner can read before answering is a quiz item that has lost its options.
- A `project` lesson's `mission` states the goal as the mission criterion it serves and the observable result that proves it; `prereq` names the lessons it assumes and nothing else; `step` is the check that proves the goal: a command and its output, stated exactly as the reference run's Result quotes it, or the answer or artefact the learner shows, stated in prose; `sources` links the reference solution's snippet, when there is one, instead of printing it. `scaffold` belongs on the mission's first project; a later project carries one only when its plan says why. The learner's run is the attempt, recorded with `teach attempt add --lesson <id> --result pass|fail`.

### Checked task

A checked task is a `project` lesson graded by a script: `evidence/NNNN/` holds `setup.sh`, `check.sh` and `solution.sh` (SKILL.md section 3). `mission` states the task as the goal and `PASS` as the observable result. `step` holds the task statement in prose, every name and value the checker asserts, then two bare `<pre>` lines, `evidence/NNNN/setup.sh` and `evidence/NNNN/check.sh`, with no prompt and no output line: the command is bare because `step` states it exactly as the experiment's Result quotes it (Blocks), and `PASS` is not a line because every non-empty, non-comment `<pre>` line in `step` is a command (Commands and tools). Then, in prose, the step says the second prints `PASS`, as the experiment's Result quotes it, and carries one sentence cited to the experiment: "This check fails on a fresh setup and passes after the reference solution." `sources` lists the snippet (the reference solution) and the experiment.

Three safety rules bound the scripts; the first and third are plan rules, stated in the plan, not lint findings.

1. Everything `setup.sh` and `solution.sh` create, change or delete lives inside the scope named `teach-NNNN`, in the environment the `Task environment:` bullet of `MISSION.md` names.
2. `check.sh` changes nothing. A `kubectl`, `docker` or `kind` verb comes from a read-only allowlist (judgment, this format's reading of each tool): kubectl `get`, `describe`, `wait`, `logs`, `top`, `events`, `explain`, `diff`, `version`, `api-resources`, `api-versions`, `cluster-info`, `auth can-i`, `config view`, `config current-context`, `config get-contexts`, `rollout status`, `rollout history`, `kustomize`; docker `ps`, `inspect`, `logs`, `images`, `version`, `info`, `port`, `top`, `diff`, `stats`, `network ls`, `network inspect`, `volume ls`, `volume inspect`; kind `get`, `version`. No command's first word is `rm`, `mv`, `cp`, `tee`, `sed`, `mkdir`, `touch`, `chmod` or `chown`. Outside quoted strings, no `>` or `>>` redirects to a file: a redirect to a file descriptor (`>&2`) or to `/dev/null` is the exception.
3. A check may wait, with a bound: a wait is a bounded poll of a read-only query, never a change.

Judgment, not measured: for a Kubernetes environment, `run.sh` and the skill run `check.sh` under a read-only credential (a ServiceAccount with only read verbs), so a checker that mutates fails in the validation run rather than passing the lists.

## Terms

A lesson uses only terms the learner already has. The workspace tracks every term under `## Floor` / `### New to me` in `MISSION.md` plus every lesson's `data-introduces`. For a lesson, the allowed terms are the Floor's `### Known terms` plus the `data-introduces` of this and every earlier lesson. `teach lint` reports `LESSON_TERM_NOT_INTRODUCED` when a tracked term appears in the lesson's prose (every block but `sources` and `followup`, with `<pre>` output excluded and the `predict` and `quiz` items included) before it is allowed. A lesson introduces at most three terms (`LESSON_INTRODUCES_TOO_MANY`), each in a `<dfn>` (`LESSON_DFN_MISSING`). There is no word cap: the cap is on new ideas.

## The model block

`model` comes before `fact`. It opens with a bridge from something in the Floor ("an Ingress split into three objects with three owners"), draws the parts in a `<figure>` (inline SVG, with a `<figcaption>`), and says, in a paragraph or two you would say aloud at a whiteboard, how they relate and why each exists. Citations go at the end of the block, not on every paragraph; at least one must be a `source` or `note`, or `teach lint` warns `WARN_MODEL_LAB_ONLY`. A model with no figure is `LESSON_MODEL_NO_FIGURE` unless the block carries `data-no-figure` and `PLAN.md` says why.

One figure per idea. Parts the prose uses separately get their own small figure; parts the learner must compare stay in one figure. Put each figure with the paragraph it illustrates in a pair, the figure first, `<div class="pair"><figure>…</figure><p>…</p></div>`, which the stylesheet floats right on a wide screen so the paragraph wraps around it, and stacks above the paragraph on a narrow one (a pair with the paragraph first is `WARN_PAIR_FIGURE_LAST`: the float wraps only what follows it). A figure outside a pair spans the block.

Draw every figure to these rules. `teach lint` warns on each one it can see; the warnings are advisory.

- The `<svg>` carries `viewBox` and no `width` or `height` attribute (`WARN_FIGURE_FIXED_SIZE`): the stylesheet sizes the figure to its column, and a figure narrower than its minimum width scrolls sideways instead of shrinking.
- The viewBox is at most 440 units wide (`WARN_FIGURE_VIEWBOX_WIDE`), so one unit draws at about one pixel at the figure's minimum width.
- Every label is at least 14 units (`WARN_FIGURE_LABEL_SMALL`). The lint reads the nearest `font-size` attribute on the `<text>` or an ancestor; a size set only by `style` or a class is unknown and warns.
- A label names a part; the paragraph beside the figure explains it. A label is at most 40 characters, counting its `<tspan>`s (`WARN_FIGURE_LABEL_LONG`), and fits the shape it sits in: a label whose estimated width (characters times font size times 0.5, placed by `text-anchor`) passes the edge of the `<rect>` holding it, or the viewBox with no such rect, is `WARN_FIGURE_TEXT_OVERFLOW`; widen the box, shorten the label or break the line.
- Every `fill` and `stroke` is `currentColor`, `none` or `var(--muted)` (`WARN_FIGURE_COLOR`), so the figure follows the theme and keeps its contrast.
- The `<svg>` carries `role="img"` and its own `aria-label` describing what it shows (`WARN_FIGURE_NO_ALT`).

## Prose

`fact` comes before `example` in source order and `lesson.css` spans both from 1100px, so the two are stacked at every width and "below" and "above" between them hold.

`teach lint` warns `WARN_LESSON_TIME_WORD` on a paragraph, in any block but `sources` and in a reference doc's `note`, that says `currently`, `recently`, `nowadays`, `at the moment`, `as of now` or `as of today` outside `<pre>` and `<code>`: the page's currency is the vault's `last_verified`, not a word in the prose. The fix is a version or date taken from the cited entry; for a reference doc it lands in the vault note, which is then re-rendered. Advisory, since a quoted source sentence may hold the word.

## The path

`PATH.md` (see `PATH-FORMAT.md`) plans the lessons. A built lesson's line carries `lesson: <id>`; `teach lint` reports `LESSON_PATH_MISMATCH` when that lesson's `data-introduces` or `data-teaches` differs from the line's `terms:` and `tool:`.

## Commands and tools

A lesson runs only tools the learner already has. `teach lint` reads every command the lesson runs and reports `LESSON_TOOL_NOT_INTRODUCED` for a tool that is neither listed under `## Known tools` in `MISSION.md` nor declared by `data-teaches` on this or an earlier lesson. A tool is the first word of a command, or of each `|`, `&&` or `;` segment, after any `VAR=value` prefixes.

- In `example`, a command is a `<pre>` line starting with `$ `; the lines after it are its output. Put one command and its output in each `<pre>`, with a one-sentence `<p>` before it saying what to look at.
- In `step`, every non-empty, non-comment `<pre>` line is a command, so a step with no command keeps its expected result out of `<pre>`, or its first words are read as tools.
- A lesson that introduces a tool declares it with `data-teaches` and spends its win on that tool (what it is, one command, how to read the output). The next lesson may use it as evidence.
- With no `## Known tools` section the rule cannot run and `teach lint` warns `WARN_MISSION_KNOWN_TOOLS_MISSING`.

## Citation anchors

A claim is cited with `<a data-cite="<vault id>">[n]</a>`, placed at the end of the paragraph that makes the claim, where `n` is the position of that id in the `sources` list, counting from 1. `teach lint` reports `LESSON_CITE_NUMBER` when an authored `[n]` does not match. `teach serve` numbers every citation the same way and links it to its source; opened from disk, the page shows the same `[n]`, muted, with no link. Every `<p>` in `fact` needs at least one. The id must resolve to a vault entry; a stale entry still resolves, because freshness is the claims gate's job.

In the `sources` block, an anchor whose vault entry is a `source` with a `source_url` also carries `href="<that URL>"`, so the learner can open it from the lesson. The recommended read is such a source: put `href="<source_url>"` on its anchor so the learner can open it. The lint does not check URL hrefs. Anchors in `fact` and `example` keep `data-cite` only.

## Quiz data

The `quiz` block holds one `<script type="application/json" data-quiz>` element:

```json
{ "items": [
  { "q": "Question text", "options": ["first", "second", "third"], "correct": 0,
    "why": ["Why first is right.", "Why second is wrong.", "Why third is wrong."] }
] }
```

- A quiz has at least 3 items.
- Each item has 3 non-empty options by default; 4 are allowed.
- Each wrong option is an answer a learner with a nameable misreading would give, and its `why` names that misreading. No lint checks this; it is the author's rule, beside the hygiene rules here.
- `correct` is an index into `options` in authored order. The widget shuffles options when it renders, so never arrange positions by hand.
- `why` holds one non-empty string per option, in the same order; the learner sees it after clicking that option.
- Answer length spread, the longest option divided by the shortest, is at most 1.6. Pad the short options or cut the long one.
- No formatting tells: format every option alike.

Lessons are opened through `teach serve`: Chrome blocks `<script type="module">` on `file://`, so a lesson opened from disk there renders no quiz. Served, the widget posts the answers after the last item and shows `recorded <id>: <score>/<total>`. It posts only when the page origin matches `http://127.0.0.1:<port>`; otherwise, or when the POST fails or returns an error, it shows the score and "Tell me your score in the terminal."; record it with `teach attempt add --lesson <id> --answers <comma list>` (the `predict` answer first when the lesson has one).

Each item is a `role="group"` labelled by its question. A clicked option shows `Correct` or `Not this one` before its text, so colour is not the only signal; the `why` line (`.quiz-why`) and the score line (`.quiz-result`) are `role="status"`; after an answer the item's options are `aria-disabled`, not `disabled`, so they stay reachable from the keyboard.

## Review lessons

A review lesson is retrieval practice for records already written. Blocks: `mission`, `quiz`, `sources`, `followup` (`prereq` optional). Draw items from two or three learning records once the workspace has at least two, and from the one record before that, interleaved, and give every item `"record": "<learning-record id>"`. The record must exist. A wrong answer on an item is a corrected-misconception candidate for that record.

## Reference docs

A reference doc renders one vault note. The note body goes in `<div data-block="note" data-cite="<vault note id>">`, then a `sources` block. Store no freshness date in the page; the note's `last_verified` is in the vault schema's `derived_forbidden` list (`schema/frontmatter.schema.json`), so the doc stores no freshness date, and a stale note surfaces through the session brief and `check`.

## Plan before probe

Before any probe or draft, write `evidence/NNNN/PLAN.md` for lesson NNNN, in six parts:

1. The win, one sentence. The first line names the mission criterion it serves.
2. The fact to teach.
3. The claims, one per line, each the sentence the probe must support.
4. The probe: what to run and what output would support each claim, or `none: document claims` and, per claim, the entry and the passage that supports it.
5. The step: the real-world action and its observable result.
6. Elements, under an `## Elements` heading: the parts the learner must hold at once to understand this win, one per line, each marked `held` (a Floor term, an earlier lesson's term or tool, a learning record) or `new`. A lesson adds one `new` structure.

Write the probe, or choose the passages, against the claim lines. The `fact` block states only claims the plan lists. When a probe contradicts a claim line, or the claims gate narrows one, never edit the line: append a `## Revisions` section naming the line, the result or finding, and the replacement claim. For a lesson NNNN that has a `fact` block or declares `data-shape` (not a review lesson), an `evidence/NNNN/` folder with no `PLAN.md` is a lint finding. The `fact` block states claims about `new` elements; a `held` element gets a link to the lesson that taught it instead of a restatement. A lesson that declares `data-shape` needs the Elements part in its plan (`LESSON_PLAN_NO_ELEMENTS`). A plan for a lesson with no `data-shape` predates the part and is not checked for it.

## Example

A complete minimal lesson that passes `teach lint`:

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>What fx returns</title>
<link rel="stylesheet" href="../assets/lesson.css">
</head>
<body data-lesson="0001-good" data-introduces="fx">
<h1>What fx returns</h1>

<section data-block="prereq" aria-label="before you start">
<p>Read <a href="../GLOSSARY.md#term">Term</a> first. The reference page is <a href="../reference/good.html">the fixture note</a>.</p>
</section>

<section data-block="mission" aria-label="why this lesson">
<p>This lesson gets you to predict what fx prints for a given input. A function here scales the number it is given by one fixed factor, so its output can be predicted from its input.</p>
</section>

<section data-block="model" aria-label="the model">
<p>A function takes an input and gives back an output. <dfn>fx</dfn> is the fixture function: it takes one number and returns that number scaled by a fixed factor, so every call is a straight line through the origin.</p>
<figure><svg viewBox="0 0 200 60" role="img" aria-label="n goes into fx and 6n comes out"><rect x="70" y="15" width="60" height="30" fill="none" stroke="currentColor"/><text x="100" y="35" text-anchor="middle" font-size="14">fx</text><text x="30" y="35" text-anchor="middle" font-size="14">n</text><text x="170" y="35" text-anchor="middle" font-size="14">6n</text><line x1="45" y1="30" x2="70" y2="30" stroke="currentColor"/><line x1="130" y1="30" x2="155" y2="30" stroke="currentColor"/></svg><figcaption>fx maps n to 6n.</figcaption></figure>
<p>The factor is six, so fx(7) is 42. <a data-cite="2026-01-01-fx-doc">[1]</a></p>
</section>

<section data-block="fact" aria-label="what the evidence shows">
<p>The body of fx is <code>return n * 6;</code>. <a data-cite="2026-01-01-fx-snippet">[2]</a></p>
<p>Called with 7, fx returns 42. <a data-cite="2026-01-01-fx-experiment">[3]</a></p>
</section>

<section data-block="example" aria-label="the output, read with me">
<p>The source of fx, from the snippet <a data-cite="2026-01-01-fx-snippet">[2]</a>:</p>
<pre><code>export function fx(n) { return n * 6; }</code></pre>
<pre><code>$ node -e "console.log(fx(7))"
42</code></pre>
<p>Input <code>7</code>, output <code>42</code>, from the experiment <a data-cite="2026-01-01-fx-experiment">[3]</a>.</p>
</section>

<section data-block="quiz" aria-label="check yourself">
<script type="application/json" data-quiz>
{ "items": [
  { "q": "What does fx(7) return?", "options": ["42", "13", "49"], "correct": 0,
    "why": ["Seven times six is 42.", "That adds six, fx multiplies.", "That squares seven."] },
  { "q": "What does fx do to its input?", "options": ["adds six to the value", "multiplies it by six", "squares the number"], "correct": 1,
    "why": ["Adding six would give 13 for 7.", "Right: n * 6.", "Squaring would give 49 for 7."] },
  { "q": "What does fx(3) return?", "options": ["12", "36", "24", "18"], "correct": 3,
    "why": ["That is three times four.", "That is six squared.", "That is three times eight.", "Three times six is 18."] }
] }
</script>
</section>

<section data-block="step" aria-label="do it yourself">
<p>Run <code>fx(3)</code> in a Node shell. You should see <code>18</code> printed.</p>
</section>

<section data-block="sources" aria-label="sources">
<ul>
<li><a data-cite="2026-01-01-fx-doc" href="https://example.org/fx">2026-01-01-fx-doc</a> (recommended read)</li>
<li><a data-cite="2026-01-01-fx-snippet">2026-01-01-fx-snippet</a></li>
<li><a data-cite="2026-01-01-fx-experiment">2026-01-01-fx-experiment</a></li>
</ul>
</section>

<section data-block="followup" aria-label="follow up">
<p>You can ask follow-up questions in the terminal.</p>
</section>

<script type="module" src="../assets/quiz.js"></script>
</body>
</html>
```
