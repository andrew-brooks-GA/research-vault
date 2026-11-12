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
| `scaffold` | do it yourself | the mission's first project (not lint-checked) | A completion task in the `complete` form over the reference solution |
| `step` | do it yourself | tool, project | One real-world action and its observable result, with the command to run when the action is one; a step with no command states its expected result, and what a mismatch means, in prose, never in a `<pre>` |
| `connect` | say it back | concept | The terminal prompt, opening with exactly `Type your answer to Claude Code in the terminal, in a few sentences:`: say how the new term relates to two terms you already hold; the page names the terms and nothing of how they relate |
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
- `connect` is a prompt answered in the terminal, not a quiz item: the skill judges the answer in conversation, against the plan's Fact, and records an understanding record when it holds. The page states the prompt and nothing else: no model answer, no "it holds if" sentence, no restatement of the relation, since the learner constructing the link is the point; a check the learner can read before answering is a quiz item that has lost its options. The block opens with the sentence `Type your answer to Claude Code in the terminal, in a few sentences:` (`CONNECT_LEAD` in `bin/lib/lesson.mjs`); `teach lint` warns `WARN_CONNECT_LEAD` when its text opens otherwise. `teach export` replaces that sentence with `Write your answer down, or send it to your instructor, in a few sentences:` and the `followup` sentence with `You can ask your instructor follow-up questions.`, and refuses a page whose text still says `in the terminal`, `in your terminal`, `teach serve` or `Claude Code` (a `mention` line), so a lesson meant for an exported copy keeps both fixed sentences as written.
- A `project` lesson's `mission` states the goal as the mission criterion it serves and the observable result that proves it; `prereq` names the lessons it assumes and nothing else; `step` is the check that proves the goal: a command and its output, stated exactly as the reference run's Result quotes it, or the answer or artefact the learner shows, stated in prose; `sources` links the reference solution's snippet, when there is one, instead of printing it. `scaffold` belongs on the mission's first project; a later project carries one only when its plan says why. The learner's run is the attempt, recorded with `teach attempt add --lesson <id> --result pass|fail`.

### Checked task

A checked task is a `project` lesson graded by a script: `evidence/NNNN/` holds `setup.sh`, `check.sh` and `solution.sh` (SKILL.md section 3). `mission` states the task as the goal and `PASS` as the observable result. `step` holds the task statement in prose, every name and value the checker asserts, then two bare `<pre>` lines, `evidence/NNNN/setup.sh` and `evidence/NNNN/check.sh`, with no prompt and no output line: the command is bare because `step` states it exactly as the experiment's Result quotes it (Blocks), and `PASS` is not a line because every non-empty, non-comment `<pre>` line in `step` is a command (Commands and tools). Then, in prose, the step says the second prints `PASS`, as the experiment's Result quotes it, and carries one sentence cited to the experiment: "This check fails on a fresh setup and passes after the reference solution." `sources` lists the snippet (the reference solution) and the experiment. `teach lint` reports `LESSON_TASK_INCOMPLETE` for a `project` lesson whose `evidence/NNNN/` holds any of the three scripts, or whose `step` names `check.sh`, once for each missing part: a script, the step line ending `evidence/NNNN/check.sh`, or the experiment in `sources`.

Three safety rules bound the scripts; the first and third are plan rules, stated in the plan, not lint findings.

1. Everything `setup.sh` and `solution.sh` create, change or delete lives inside the scope named `teach-NNNN`, in the environment the `Task environment:` bullet of `MISSION.md` names. That bullet decides what the learner runs: a checked task's `setup.sh` and `solution.sh` and any learner lab file. The lab-tooling rule of the skill decides the author's probes: the `run.sh` and the probe programs that are not a checked task's scripts.
2. `check.sh` changes nothing. A `kubectl`, `docker` or `kind` verb comes from a read-only allowlist (judgment, this format's reading of each tool): kubectl `get`, `describe`, `wait`, `logs`, `top`, `events`, `explain`, `diff`, `version`, `api-resources`, `api-versions`, `cluster-info`, `auth can-i`, `config view`, `config current-context`, `config get-contexts`, `rollout status`, `rollout history`, `kustomize`; docker `ps`, `inspect`, `logs`, `images`, `version`, `info`, `port`, `top`, `diff`, `stats`, `network ls`, `network inspect`, `volume ls`, `volume inspect`; kind `get`, `version`. No command's first word is `rm`, `mv`, `cp`, `tee`, `sed`, `mkdir`, `touch`, `chmod` or `chown`. Outside quoted strings, no `>` or `>>` redirects to a file: a redirect to a file descriptor (`>&2`) or to `/dev/null` is the exception. `teach lint` reports the advisory `WARN_TASK_CHECK_MUTATES`, `check.sh line N: <word>`, once for each `check.sh` line breaking one of these lists: an author reminder when the skill writes `check.sh`, not an enforcement. It reads quoted strings as empty, splits the line at each `|`, `||`, `&&` or `;` with or without spaces around it, and reads each segment's first word, after `VAR=` tokens and `sudo`, `timeout` with its flags and duration, `time`, `if`, `!`, `then`, `do` and `else`, and a tool's verb after its flags and the values of `-n`, `--namespace`, `--context`, `--kubeconfig`, `--host`, `-o` and `--output`. It does not see `$(...)`, `[[ a > b ]]`, a heredoc or any script invoked from the checker.
3. A check may wait, with a bound: a wait is a bounded poll of a read-only query, never a change.

Judgment, not measured: for a Kubernetes environment, `run.sh` and the skill run `check.sh` under a read-only credential (a ServiceAccount with only read verbs), so a checker that mutates fails in the validation run rather than passing the lists.

## Labs

A lesson may carry one lab section, optional in any shape: an element whose `data-block` is `lab`, normally a `<section>`, with `aria-label="lab"` and `data-lab="<id>"`. It holds `<data class="lab-pin" value="<pin>"></data>`, a cited sentence or two on what the lab builds, and at least one `<pre>` of output from the author's run, cited to the experiment whose log holds that run.

The id names an entry of the workspace's `labs/labs.json`, which holds exactly `"version": 1` and `labs`, a map from id to entry; a workspace with no `labs/labs.json` has no labs.

- An id matches `^[a-z][a-z0-9-]{0,39}$`.
- An entry has exactly `cost` (1 to 200 characters, none of them a control, line-separator or bidi character), `timeout` (whole seconds, 1 to 7200), `up` and `down`, and may have `env` (distinct names matching `^[A-Z_][A-Z0-9_]*$`), `checks` (at most 10, each exactly `script`, `sha256` and a `message` held to the rule of `cost`) and `verify`. `up`, `down` and `verify` are each exactly `{ "script", "sha256" }`.
- A script path matches `^[A-Za-z0-9._/-]+$`, has no empty segment and none starting with `.`, and starts with `labs/`, `evidence/` or `lessons/files/`. That root must resolve inside the workspace, and the script inside its root, as a regular file that is not a symlink. `sha256` is the file's SHA-256 in 64 lowercase hex characters.

The lab's pin, the value the section stores, is the SHA-256 hex of `JSON.stringify([id, entry])`, the entry's keys in the order `cost`, `timeout`, `env`, `checks`, `up`, `down`, `verify`, so it changes when any of them changes. The author writes the hashes and the pin by hand, from the values `teach lint` prints.

`teach serve` adds to a served lesson, after the section's opening tag, when `labs/labs.json` is valid and names the id: a `<p class="lab-cost">` with the cost line, `<p>The author ran:</p>`, and one `<pre>` each for the `up` path, the `verify` path when there is one, and the `down` path. Under `teach serve --labs`, on a request without the lab cookie, it adds after them `<p class="lab-open">To run this lab from the page, open the lab address teach serve printed when it started.</p>`. On a request with the cookie, the opening tag gains `data-lab-live`, and `data-lab-verify` when the lab has `verify`, in place of that line, and quiz.js appends to the section Run, Stop and Reset buttons, a Check my work button when the tag has `data-lab-verify`, an output `<pre>` and a status line (`role="status"`). Run runs the lab's checks and then `up`, Reset runs `down`, Check my work runs `verify`, and Stop stops a running Run or Check my work; the reply's lines are written into the output as text (docs/REFERENCE.md, `teach serve`). An exported copy shows the cost line, the step paths and the captured output, with no buttons.

`teach lint` reads `labs/labs.json` and the scripts it names, and runs none of them:

- `LAB_MANIFEST_INVALID` (`labs/labs.json`): one per problem with the manifest, the path and symlink rules included.
- `LAB_SCRIPT_NOT_RUNNABLE` (`labs/labs.json`): a script without the owner executable bit, or whose first two bytes are not `#!`.
- `LAB_HASH_MISMATCH` (`labs/labs.json`): `<path> changed: read the change, then copy sha256 <actual> into labs.json`, or `<path> cannot be read`.
- `LAB_UNKNOWN` (the lesson): `lab section has no data-lab`, or `data-lab <id> is not in labs/labs.json`.
- `LAB_PIN_STALE` (the lesson): `lab section has no lab-pin element; the lab's pin is <pin>`, or `the stored pin is <old>; the lab's pin is <new>`.
- `LAB_SECTION_DUPLICATE` (the lesson): more than one opening tag whose `data-block` is `lab`, or one inside an HTML comment, since only the first is read, by the server and the claims gate alike, even inside a comment.
- `LAB_OUTPUT_MISSING` (the lesson): no `<pre>` in the section, or no `experiment` entry cited in it.
- `LAB_VERIFY_MISSING` (the lesson): a `project` lesson whose lab has no `verify`.

`LAB_UNKNOWN`, `LAB_PIN_STALE` and `LAB_VERIFY_MISSING` are checked only while the manifest is valid.

## Replays

A replay plays a recorded terminal session (an asciicast v2 or v3 file) in the lesson, normally in the `example` block, with its transcript beside it. It is an empty element, normally a `<div>`, whose `data-cast` names the cast under the workspace's `assets/` by a relative path, followed after whitespace only by the transcript in a `<pre>`:

```
<div data-cast="../assets/fxctl.cast"></div>
<pre>$ fxctl run 7
42
</pre>
```

`teach cast transcript <file>` prints the cast's output events as text for that `<pre>`: CSI, OSC and charset escape sequences removed, CRLF a line break, other C0 control characters but tab and line feed, and DEL, dropped, and `&`, `<`, `>` and `"` escaped. Before a cast is kept, `teach cast check <file> [--needle <value>]...` scans it (docs/REFERENCE.md, `teach`).

The transcript is always in the page; the player is added beside it only when the lesson loads it. The repo ships no player. The author downloads the two assets of the asciinema-player v3.18.0 release on GitHub (`https://github.com/asciinema/asciinema-player/releases/tag/v3.18.0`) into the workspace's `assets/`, checks their SHA-256 against these values, which `bin/lib/cast.mjs` pins in `PLAYER_FILES`, and loads them in the lesson's `<head>`:

| File | SHA-256 |
|---|---|
| `asciinema-player.min.js` | `752c9b528b664f5b16f27c68ba22fc7973d1d6063a1c3e4795a4c8015943acf6` |
| `asciinema-player.css` | `981fe7bc6042048b2a373b6da297f747e324e90a8b6264e833e3a92cec22dfb9` |

```
<link rel="stylesheet" href="../assets/asciinema-player.css">
<script src="../assets/asciinema-player.min.js"></script>
```

quiz.js then starts a player in each element that has `data-cast`; without the files, the page shows the transcript only. `teach serve` returns the cast and the player files as it returns any file under `assets/`. `teach export` copies them, and gives each such element whose cast `teach serve` returns a `data-cast-text` attribute holding the cast's text, which quiz.js hands the player in place of the path, since headless Chrome 157 refused a `file://` page's fetch of the cast file. In headless Chrome 157 the player mounted and played the cast on a lesson `teach serve` returned and on an exported lesson opened from `file://`. With the player files absent, each showed the transcript only. Safari and Firefox were not opened.

`teach lint` reads each element that has `data-cast` and the player files:

- `LESSON_CAST_MISSING` (the lesson): `data-cast` names no file under `assets/` that `teach serve` returns.
- `LESSON_CAST_INVALID` (the lesson): the file is not an asciicast v2 or v3 file.
- `LESSON_CAST_SECRET` (the lesson): the cast matches a token shape of `TOKEN_SHAPES` in `bin/lib/cast.mjs`. The line names the kind and the event, or the header, never the value; record the session again with the value masked. The kinds are `aws-access-key` (`AKIA` or `ASIA` and 16 more), `github-token` (`ghp_`, `gho_`, `ghu_`, `ghs_` or `ghr_` and 36 or more, or `github_pat_` and 22 or more), `slack-token` (`xoxa-`, `xoxb-`, `xoxp-`, `xoxo-`, `xoxr-` or `xoxs-` and 10 or more), `jwt` (two `eyJ` segments and a third) or `private-key` (a `-----BEGIN ... PRIVATE KEY-----` line).
- `LESSON_CAST_TRANSCRIPT_MISSING` (the lesson): the element is not followed, after whitespace only, by a `<pre>`.
- `LESSON_CAST_PLAYER_HASH` (`assets/<file>`): `assets/asciinema-player.min.js` or `assets/asciinema-player.css` exists and its SHA-256 is not the pinned value.

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
- Every `<text>` has a `fill`, on itself or on an ancestor inside its `<svg>` (`WARN_FIGURE_TEXT_NO_FILL`, one warning per figure); use `currentColor`.
- The `<svg>` carries `role="img"` and its own `aria-label` describing what it shows (`WARN_FIGURE_NO_ALT`).

## Screenshots

A screenshot is evidence: it goes in a `fact` or `example` block, never `model`, with one image to a `<figure>` and a `<figcaption>`. The `alt` describes what is visible, and the captured page text that supports the caption goes in the cited experiment. `teach lint` reports `LESSON_IMG_NO_ALT` for an `<img>` with an empty or missing `alt`, `LESSON_IMG_NO_CAPTION` for one with no `<figcaption>` in its `<figure>` (or in no `<figure>`), and `LESSON_IMG_MISSING` for a `src` that `teach serve` would not return as a file under `lessons/`, `reference/` or `assets/`: a relative `src` resolves from the lesson file's directory, a leading `/` from the workspace root, the path is percent-decoded, and a path segment starting with `.` or an undecodable path is missing. It warns `WARN_IMG_UNCITED` for an `<img>` in a block with no `data-cite`, and for one in no block.

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

Lessons are opened through `teach serve`: a module script loaded from a `file://` page fails on CORS, as MDN's modules guide says, so by that guide quiz.js, a module script, would not load from a `file://` page, and a workspace lesson opened from disk would show no quiz widget. A copy written by `teach export` is the exception: its lessons load quiz.js as `<script defer src="../assets/quiz.js">`, a classic script, and in headless Chrome 157 such a lesson opened from `file://` rendered its quiz, saved the attempt in the browser and showed `Saved in this browser.` after the score, where a served page whose origin is refused shows "Tell me your score in the terminal." Served, the widget posts the answers after the last item and shows `recorded <id>: <score>/<total>`. It posts only when the page origin matches `http://127.0.0.1:<port>`; otherwise, or when the POST fails or returns an error, it shows the score and "Tell me your score in the terminal."; record it with `teach attempt add --lesson <id> --answers <comma list>` (the `predict` answer first when the lesson has one).

Each item is a `role="group"` labelled by its question. A clicked option shows `Correct` or `Not this one` before its text, so colour is not the only signal; the `why` line (`.quiz-why`) and the score line (`.quiz-result`) are `role="status"`; after an answer the item's options are `aria-disabled`, not `disabled`, so they stay reachable from the keyboard.

## Review lessons

A review lesson is retrieval practice for records already written. Blocks: `mission`, `quiz`, `sources`, `followup` (`prereq` optional). Draw items from two or three learning records once the workspace has at least two, and from the one record before that, interleaved, and give every item `"record": "<learning-record id>"`. The record must exist. A wrong answer on an item is a corrected-misconception candidate for that record.

## Reference docs

A reference doc renders one vault note. The note body goes in `<div data-block="note" data-cite="<vault note id>">`, then a `sources` block. Store no freshness date in the page. The vault derives the note's `last_verified` from its verifications, and the vault schema lists `last_verified` under `derived_forbidden` (`schema/frontmatter.schema.json`); a stale note surfaces through the session brief and `check`.

## Plan before probe

Before any probe or draft, write `evidence/NNNN/PLAN.md` for lesson NNNN, in six parts:

1. The win, one sentence. The first line names the mission criterion it serves.
2. The fact to teach.
3. The claims, one per line, each the sentence the probe must support.
4. The probe: what to run and what output would support each claim, or `none: document claims` and, per claim, the entry and the passage that supports it. When the probe needs an environment, this part names where it comes from: the repo's lab tooling, an environment an earlier lesson built, or another environment with an `own environment: <reason>` line. When the binding has a `lab` block, `teach lint` reports the advisory `WARN_LAB_BYPASSED`, `line N: <string>; the binding's lab is <first docs path>`, once for each `.sh` file under the workspace's `labs/`, `evidence/` and `lessons/` trees that holds no non-comment, non-`echo` line containing a `uses` string and whose first non-comment line containing a `bypass` string, quoted strings read as empty, is line N. An `own environment: <reason>` line at the start of a line anywhere in `evidence/NNNN/PLAN.md` silences it for the files under `evidence/NNNN/` and `lessons/files/NNNN-`. It reads each line as written: a `bypass` string inside quotes is not seen, an unquoted `$(...)` and a heredoc body line are read like any other line, and a script a script calls is seen only when it is itself a `.sh` file under those three trees.
5. The step: the real-world action and its observable result.
6. Elements, under an `## Elements` heading: the parts the learner must hold at once to understand this win, one per line, each marked `held` (a Floor term, an earlier lesson's term or tool, a learning record) or `new`. A lesson adds one `new` structure.

Write the probe, or choose the passages, against the claim lines. The `fact` block states only claims the plan lists. When a probe contradicts a claim line, or the claims gate narrows one, never edit the line: append a `## Revisions` section naming the line, the result or finding, and the replacement claim. For a lesson NNNN that has a `fact` block or declares `data-shape` (not a review lesson), an `evidence/NNNN/` folder with no `PLAN.md` is a lint finding. The `fact` block states claims about `new` elements; a `held` element gets a link to the lesson that taught it instead of a restatement. A lesson that declares `data-shape` needs the Elements part in its plan (`LESSON_PLAN_NO_ELEMENTS`). A plan for a lesson with no `data-shape` predates the part and is not checked for it.

## Example

A complete minimal lesson. It is `test/fixtures/teach/lessons/0001-good.html`, which draws no `teach lint` finding in the fixture workspace `test/fixtures/teach`; its citations are entries of the test suite's fixture vault (`fixtureVault` in `test/helpers.mjs`), not of a real vault:

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
<figure><svg viewBox="0 0 200 60" role="img" aria-label="n goes into fx and 6n comes out"><rect x="70" y="15" width="60" height="30" fill="none" stroke="currentColor"/><text fill="currentColor" x="100" y="35" text-anchor="middle" font-size="14">fx</text><text fill="currentColor" x="30" y="35" text-anchor="middle" font-size="14">n</text><text fill="currentColor" x="170" y="35" text-anchor="middle" font-size="14">6n</text><line x1="45" y1="30" x2="70" y2="30" stroke="currentColor"/><line x1="130" y1="30" x2="155" y2="30" stroke="currentColor"/></svg><figcaption>fx maps n to 6n.</figcaption></figure>
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
