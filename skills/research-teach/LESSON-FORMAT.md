# Lesson Format

A lesson is one HTML page the learner opens in a browser. It is built from blocks, each marked with a `data-block` attribute, so `teach lint` can check it before the claims gate does. Run `teach lint` after writing a lesson and after every revision.

## Files and ids

- Lessons: `lessons/NNNN-slug.html`, next number after the highest present. The id is the file name without `.html` (`0001-what-fx-returns`). The slug starts with a letter, so the id does not begin with the `YYYY-MM-DD-` prefix of a vault id; do not embed a date in the slug.
- Review lessons: `lessons/NNNN-review-slug.html`, numbered in the same sequence.
- Reference docs: `reference/<slug>.html`.
- The body declares the terms the lesson introduces: `data-introduces="Envoy,data plane"`, at most three, each defined in a `<dfn>` element where it is first explained. See Terms.
- The body may declare the tools the lesson teaches: `<body data-lesson="<id>" data-teaches="istioctl">` (comma-separated). A later lesson may then run that tool; see Commands and tools.
- The page loads the shared components with `<link rel="stylesheet" href="../assets/lesson.css">` in the head and `<script type="module" src="../assets/quiz.js"></script>` before `</body>`, and the body carries the lesson id: `<body data-lesson="<id>">`, where `data-lesson` equals the file name without `.html`. The widget takes the id from the served path `/lessons/<id>.html` first and falls back to `data-lesson`.
- Links the lint resolves: `../GLOSSARY.md#<heading-slug>`, `<id>.html` for another lesson (`../lessons/<id>.html` from a reference doc), `../reference/<slug>.html` for a reference doc. A link to any of these that does not exist is a finding.

## Blocks

Each block is an element with `data-block="<name>"`, normally a `<section>`. Order them as listed.

| Block | Required for | Holds |
|---|---|---|
| `prereq` | optional in a lesson or review | Links to earlier lessons and glossary anchors |
| `mission` | lesson, review | One sentence tying the win to `MISSION.md` |
| `model` | lesson | The mental model: a bridge from a Floor term, one `<figure>` diagram, and how the parts relate, with at least one citation anchor in the block (a `source` or `note`, since a model is what the docs say) |
| `fact` | lesson | What the probe showed, every `<p>` ending in a citation anchor |
| `example` | lesson | The probe's input and verbatim output, cited to its `snippet` and `experiment` |
| `quiz` | lesson, review | The quiz data block (below) |
| `step` | lesson | One real-world action, the command to run, and the observable result |
| `sources` | lesson, review, reference | The vault ids cited, with one marked `(recommended read)`; source anchors carry `href` (Citation anchors) |
| `followup` | lesson, review | Exactly the sentence `You can ask follow-up questions in the terminal.` |
| `note` | reference | The rendered vault note body, with `data-cite` on the block element |

In `step`, state the command exactly as the experiment's Result quotes it, so the claims gate can match it. When the step names the probe's path, keep that path in the captured snippet.

## Terms

A lesson uses only terms the learner already has. The workspace tracks every term under `## Floor` / `### New to me` in `MISSION.md` plus every lesson's `data-introduces`. For a lesson, the allowed terms are the Floor's `### Known terms` plus the `data-introduces` of this and every earlier lesson. `teach lint` reports `LESSON_TERM_NOT_INTRODUCED` when a tracked term appears in the lesson's prose (every block but `sources` and `followup`, with `<pre>` output excluded and the quiz included) before it is allowed. A lesson introduces at most three terms (`LESSON_INTRODUCES_TOO_MANY`), each in a `<dfn>` (`LESSON_DFN_MISSING`). There is no word cap: the cap is on new ideas.

## The model block

`model` comes before `fact`. It opens with a bridge from something in the Floor ("an Ingress split into three objects with three owners"), draws the parts once in a `<figure>` (inline SVG, with a `<figcaption>`), and says, in a paragraph or two you would say aloud at a whiteboard, how they relate and why each exists. Citations go at the end of the block, not on every paragraph; at least one must be a `source` or `note`, or `teach lint` warns `WARN_MODEL_LAB_ONLY`. A model with no figure is `LESSON_MODEL_NO_FIGURE` unless the block carries `data-no-figure` and `PLAN.md` says why.

## The path

`PATH.md` (see `PATH-FORMAT.md`) plans the lessons. A built lesson's line carries `lesson: <id>`; `teach lint` reports `LESSON_PATH_MISMATCH` when that lesson's `data-introduces` or `data-teaches` differs from the line's `terms:` and `tool:`.

## Commands and tools

A lesson runs only tools the learner already has. `teach lint` reads every command the lesson runs and reports `LESSON_TOOL_NOT_INTRODUCED` for a tool that is neither listed under `## Known tools` in `MISSION.md` nor declared by `data-teaches` on this or an earlier lesson. A tool is the first word of a command, or of each `|`, `&&` or `;` segment, after any `VAR=value` prefixes.

- In `example`, a command is a `<pre>` line starting with `$ `; the lines after it are its output. Put one command and its output in each `<pre>`, with a one-sentence `<p>` before it saying what to look at.
- In `step`, every non-empty, non-comment `<pre>` line is a command.
- A lesson that introduces a tool declares it with `data-teaches` and spends its win on that tool (what it is, one command, how to read the output). The next lesson may use it as evidence.
- With no `## Known tools` section the rule cannot run and `teach lint` warns `WARN_MISSION_KNOWN_TOOLS_MISSING`.

## Citation anchors

A claim is cited with `<a data-cite="<vault id>">`, placed at the end of the paragraph that makes the claim. Every `<p>` in `fact` needs at least one. The id must resolve to a vault entry; a stale entry still resolves, because freshness is the claims gate's job.

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
- Each item has 3 or 4 non-empty options.
- `correct` is an index into `options` in authored order. The widget shuffles options when it renders, so never arrange positions by hand.
- `why` holds one non-empty string per option, in the same order; the learner sees it after clicking that option.
- Answer length spread, the longest option divided by the shortest, is at most 1.6. Pad the short options or cut the long one.
- No formatting tells: format every option alike.

Lessons are opened through `teach serve`: Chrome blocks `<script type="module">` on `file://`, so a lesson opened from disk there renders no quiz. Served, the widget posts the answers after the last item and shows `recorded <id>: <score>/<total>`. It posts only when the page origin matches `http://127.0.0.1:<port>`; otherwise, or when the POST fails or returns an error, it shows the score and "Tell me your score in the terminal."; record it with `teach attempt add --lesson <id> --answers <comma list>`.

## Review lessons

A review lesson is retrieval practice for records already written. Blocks: `mission`, `quiz`, `sources`, `followup` (`prereq` optional). Draw items from two or three learning records once the workspace has at least two, and from the one record before that, interleaved, and give every item `"record": "<learning-record id>"`. The record must exist. A wrong answer on an item is a corrected-misconception candidate for that record.

## Reference docs

A reference doc renders one vault note. The note body goes in `<div data-block="note" data-cite="<vault note id>">`, then a `sources` block. Store no freshness date in the page; the note's `last_verified` is in the vault schema's `derived_forbidden` list (`schema/frontmatter.schema.json`), so the doc stores no freshness date, and a stale note surfaces through the session brief and `check`.

## Plan before probe

Before any probe or draft, write `evidence/NNNN/PLAN.md` for lesson NNNN, in five parts:

1. The win, one sentence. The first line names the mission criterion it serves.
2. The fact to teach.
3. The claims, one per line, each the sentence the probe must support.
4. The probe: what to run and what output would support each claim.
5. The step: the real-world action and its observable result.

Write the probe against the claim lines. The `fact` block states only claims the plan lists. When a probe contradicts a claim line, or the claims gate narrows one, never edit the line: append a `## Revisions` section naming the line, the result or finding, and the replacement claim. For a lesson NNNN that has a `fact` block (not a review lesson), an `evidence/NNNN/` folder with no `PLAN.md` is a lint finding.

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

<section data-block="prereq">
<p>Read <a href="../GLOSSARY.md#term">Term</a> first. The reference page is <a href="../reference/good.html">the fixture note</a>.</p>
</section>

<section data-block="mission">
<p>This lesson gets you to predict what fx prints for a given input.</p>
</section>

<section data-block="model">
<p>A function takes an input and gives back an output. <dfn>fx</dfn> is the fixture function: it takes one number and returns that number scaled by a fixed factor, so every call is a straight line through the origin.</p>
<figure><svg viewBox="0 0 200 60" width="200" height="60" role="img" aria-label="n goes into fx and 6n comes out"><rect x="70" y="15" width="60" height="30" fill="none" stroke="currentColor"/><text x="100" y="35" text-anchor="middle" font-size="14">fx</text><text x="30" y="35" text-anchor="middle" font-size="14">n</text><text x="170" y="35" text-anchor="middle" font-size="14">6n</text><line x1="45" y1="30" x2="70" y2="30" stroke="currentColor"/><line x1="130" y1="30" x2="155" y2="30" stroke="currentColor"/></svg><figcaption>fx maps n to 6n.</figcaption></figure>
<p>The factor is six, so fx(7) is 42. <a data-cite="2026-01-01-fx-doc">2026-01-01-fx-doc</a></p>
</section>

<section data-block="fact">
<p>The body of fx is <code>return n * 6;</code>. <a data-cite="2026-01-01-fx-snippet">2026-01-01-fx-snippet</a></p>
<p>Called with 7, fx returns 42. <a data-cite="2026-01-01-fx-experiment">2026-01-01-fx-experiment</a></p>
</section>

<section data-block="example">
<p>The source of fx, from <a data-cite="2026-01-01-fx-snippet">2026-01-01-fx-snippet</a>:</p>
<pre><code>export function fx(n) { return n * 6; }</code></pre>
<pre><code>$ node -e "console.log(fx(7))"
42</code></pre>
<p>Input <code>7</code>, output <code>42</code>, from <a data-cite="2026-01-01-fx-experiment">2026-01-01-fx-experiment</a>.</p>
</section>

<section data-block="quiz">
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

<section data-block="step">
<p>Run <code>fx(3)</code> in a Node shell. You should see <code>18</code> printed.</p>
</section>

<section data-block="sources">
<ul>
<li><a data-cite="2026-01-01-fx-doc" href="https://example.org/fx">2026-01-01-fx-doc</a> (recommended read)</li>
<li><a data-cite="2026-01-01-fx-snippet">2026-01-01-fx-snippet</a></li>
<li><a data-cite="2026-01-01-fx-experiment">2026-01-01-fx-experiment</a></li>
</ul>
</section>

<section data-block="followup">
<p>You can ask follow-up questions in the terminal.</p>
</section>

<script type="module" src="../assets/quiz.js"></script>
</body>
</html>
```
