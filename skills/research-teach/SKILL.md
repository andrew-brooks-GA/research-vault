---
name: research-teach
description: Use when the user wants to learn a topic over multiple sessions in a vault-bound repo — "teach me X", "/research-teach", "I'm stuck on this passage", or a question about a lesson, reference doc or learning record in a teaching workspace. Owns the teaching workspace (mission, lessons, reference docs, learning records) and wires it to the vault — resources are vault sources, reference facts are vault notes, every behaviour claim is probed, kept as evidence and gated by a fresh research-vault:claims-reviewer before the learner sees it. For a research question with no learner, use research-orchestrate.
argument-hint: "[what would you like to learn, or the passage you are stuck on]"
---
# Teaching from the vault

The pedagogy here is adapted from Matt Pocock's `teach` skill (mattpocock/skills, MIT). What this skill adds is a system of record: facts live in the vault with a review date, and nothing reaches the learner that the recorded evidence does not support. A lesson that is wrong gets memorised, because lessons are built for retention, so the truth check is not optional.

## 0. Resolve paths once

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now; subagents do not inherit it.
- The repo must be vault-bound (`.research-vault.json`). If it is not, run `init --project` first and set `defaults.topics` to the topic.
- Format files for the workspace documents live next to this file: [MISSION-FORMAT.md](MISSION-FORMAT.md), [PATH-FORMAT.md](PATH-FORMAT.md), [LEARNING-RECORD-FORMAT.md](LEARNING-RECORD-FORMAT.md), [GLOSSARY-FORMAT.md](GLOSSARY-FORMAT.md), [LESSON-FORMAT.md](LESSON-FORMAT.md). The shared lesson components are in `assets/` next to this file.

## 1. The workspace

The directory `/research-teach` was run in. One mission per workspace.

| File | Holds | Who owns it |
|---|---|---|
| `MISSION.md` | Why the learner wants this; grounds every decision | learner state |
| `GLOSSARY.md` | Terms the learner can already use correctly | learner state |
| `learning-records/NNNN-slug.md` | What the learner has demonstrated; sets the zone of proximal development. Frontmatter the teach schema validates; written by `teach record add` | learner state |
| `attempts/` | What the learner scored; written by `teach serve` or `teach attempt add`, never edited | learner state |
| `NOTES.md` | Preferences, chapter progress | learner state |
| `GATE-LOG.md` | Reader verdicts and the third-round decision, claims-gate decisions, and the path-edges record of what was proposed and taken; append-only | gate record |
| `lessons/NNNN-slug.html` | One tightly scoped win each; the unit of teaching | view |
| `reference/*.html` | Compressed essence, printable, revisited | view of vault notes |
| `assets/` | `lesson.css`, `quiz.js` (copied from the skill), other reusable components | view |
| `evidence/NNNN/` | Probe programs and `run.sh` for lesson NNNN; a working folder, not evidence until captured | scratch |
| `evidence/NNNN/PLAN.md` | The plan written before the probe | scratch |
| `.teach-serve.json` | The running server's port and pid; gitignored | scratch |

There is no `RESOURCES.md`. Trusted sources are vault `source` entries (communities too, as `source_type: community-report`); gaps are vault `question` entries; `search --topic <topic>` is the resource list. The facts a reference doc compresses live in a vault `note` so they carry a review date; the HTML is a rendering of that note.

## 2. Mission first: the interview, the Floor, the path

If `MISSION.md` is missing or vague, interview the learner before anything else and write it per the format file. Ask in this order, and ask the learner to show or say, never to rate themselves:

1. Why: what they want to be able to do or explain, and for whom. A ticket, a design, a talk, or the model for its own sake.
2. Scope: what the sessions should include, and what is adjacent but not for now. Only the tools and terms this scope needs are asked about next; a tool the learner uses daily but no lesson needs stays out.
3. Depth: explain with a diagram, diagnose from output, or configure from scratch.
4. Terms: for each term the scope needs, one sentence or "pass". A correct sentence goes to `### Known terms`, anything else to `### New to me`.
5. Tools: for each tool a lesson will run, daily, have run it, or never. Daily goes to `### Known tools`; never gets a `PATH.md` line.
6. Session length and how they learn best (diagram first, YAML first, run and predict, read).

Then write `PATH.md` (`PATH-FORMAT.md`): one line per planned lesson, in order, each with at most one new term set or tool and its prerequisites, every "New to me" term on a line before any line that needs it, a review every six or seven lessons. End each group of two to five lines that together build one capability with a `Project:` line, a title starting `Project:` whose `after:` names at least two lines; later projects integrate more lines than earlier ones, so the projects run simple to complex across the mission. Then run `teach path candidates`: it pools the vault's entries on the workspace's topics (and on any mission or path term whose slug, or that slug plus `s`, is a vault topic), runs `search`'s text filter over that pool for every mission and path term and matches each term against each pooled entry's file, and prints the entries no lesson or reference doc cites, plus the notes and syntheses within two `related` hops of a cited entry, under the line they would follow, with the query behind each; its `no line` group and its `term "...": no path line covers it` lines are what the interview did not reach, so add a line for each the mission needs and say in `NOTES.md` why the rest wait. When the binding's `defaults.topics` is broader than the mission, pass `--topic <mission topic>` so the pool is drawn from the mission's topic rather than every topic the binding lists. Read the Floor, the goal and the first four lines back to the learner and ask whether it starts too low or too high. Write a `prior-knowledge` learning record for the Floor. Confirm with the learner before changing the mission or the path later, and add a learning record when it changes.

## 3. Knowledge comes from the vault or the probe, never memory

Plan before you probe. Write `evidence/NNNN/PLAN.md` first, in the six parts `LESSON-FORMAT.md` names: the win, the fact, the claims (one per line), the probe, the step, the Elements. Write the probe against the claim lines. Never edit a claim line; when a probe contradicts one, or the claims gate narrows one, append a `## Revisions` section naming the line, the result or finding, and the replacement claim.

0. Capture the concept sources up front, once per path: for every `New to me` term, the primary page that defines it (the project's own concepts or architecture page, the API reference), as a `source` with `--store-body --ack-data-egress`. A lesson's `model` block is a "the docs say" claim cited to these; the probe then confirms the instance. Without them every explanation gets cut back to "in the lab it was".
1. Search the vault before the web: `search --topic`, `--text`, `--body` (`teach path candidates` builds a pool with `search`'s topic filter, runs its text filter over the pool for every mission and path term and matches each term against each pooled entry's file, at once). Fresh entries answer; stale ones get re-verified (research-vault-usage §2) before they are taught.
   The vault is the source of truth. The web is where sources are found, not a source. A page you fetch is captured as a `source` entry before anything from it is taught or cited (`--store-body --ack-data-egress` when the quoted text matters); a page you did not capture does not exist as far as the lesson, the reference doc or the reviewer is concerned.
2. Capture every resource you rely on, with `summary` saying what to use it for, `subject` name and version, and the workspace's topic. Dedup is automatic.
3. Evidence is exactly three kinds of vault entry: `source`/`note` for what a document says, `snippet` for locally verifiable code, `experiment` for the log of a local run. Every claim about what a program prints, what a compiler or runtime says, what an API is named or what a version does is verified by running it, and the run is persisted: the probes under `evidence/NNNN/` are captured as one `snippet` (`--language`, `--tested true`, `--body-file <file holding the probes as fenced code>`), and `run.sh`'s output as one `experiment` (`--date-run`, `--outcome`, `--related <snippet id>`, `--provider local --model-id none` for a local tool run, `--body-file <file holding a Result section with the run log verbatim>`), then `verify --id <experiment id> --method tool-probe --result confirmed --by-id <your agent id>`. `--body-file` is how the code and the log reach the entry; `--content-file` is for sources. `--by-id` records the row as `by_type: agent`. A `run.sh` that fails gets one line in `evidence/NNNN/RERUNS.md` before any rerun: `harness-infra` or `hypothesis-relevant`, and the fix. A run that exists only on disk is not evidence; a web page is evidence only once captured as a `source`, so capture before you cite. Non-software topics keep the quoted passage or measurement in the entry body.

## 4. Build the lesson

Pedagogy, in brief. Read the full source skill if you want the reasoning.

- **Zone of proximal development.** Read the learning records and the mission; teach the most relevant next thing that is challenging but reachable. If the learner names the thing, teach that.
- **Talk to the learner.** Write the model, fact and example blocks to the learner MISSION.md describes, the way you would explain them in person. The lesson-reader gate never sees MISSION.md; it reads the page as someone who knows only what the page says they know, so name the Floor terms and tools the page relies on.
- **Short in scope.** Working memory is small. One tangible win, completable fast, tied to the mission, explained in full sentences.
- **One new tool per lesson.** The probe and the step run only tools in the mission's `## Known tools` or taught by an earlier lesson (`data-teaches`); `teach lint` enforces it. A tool the mission needs (istioctl, a debugger, a profiler) gets its own lesson before its output is used as evidence. The same holds for vocabulary: a term the learner has not met is defined in the sentence that first uses it, and a lesson introduces one such set, not several.
- **Knowledge first, then skill.** Difficulty is the enemy of acquisition and the tool of retention. Teach the fact plainly, then make the learner retrieve it: quizzes with immediate feedback, a real-world step with an observable result.
- **Storage over fluency.** Retrieval practice, spacing, interleaving (skills only). A learner who feels fluent after reading has not learned yet; the quiz is where learning happens.
- **Quiz hygiene.** Answers of equal length; correct position varies; no formatting tells.
- **Cite.** Every claim links its vault entry or primary source. Recommend one primary source to read.
- **Reuse components.** Read `assets/` before writing; the shared stylesheet is the first asset. It follows the OS light or dark scheme (`<html data-theme="light|dark">` forces one), labels every block, numbers the fact paragraphs, and lays fact beside example and quiz beside step from 1100px wide. Lessons link to each other and to reference docs by anchor.
- **Wisdom is delegated.** Questions about idiom or real-world practice get an answer and a pointer to a community (a captured `community-report` source). Respect an opt-out recorded in `NOTES.md`.
- **Reminder in every lesson** that the learner can ask follow-up questions in the terminal.

Procedure, in order:

1. Run `teach next` and read its output: the mission criteria, the active records with their last attempt, the `review-due:` and `review-failed:` lines, the `fringe:` lines (one per untaken `PATH.md` line whose `after:` values are all `floor` or built lines; the first is the default) and the `inner:` lines (every built non-review line that no other built non-review line names in `after:`, highest lesson number first). Records in `review-due` or `review-failed` come first, as a review lesson (§6). Otherwise build a line from the fringe: the first, unless the learner or the records say otherwise (a fringe line whose terms the records show the learner already uses can wait; one the learner asks for comes first). `fringe: none (every untaken line waits ...)` means `PATH.md` needs fixing before anything is built; `teach lint` names a bad `after:` value (`PATH_AFTER_FORWARD`, `PATH_AFTER_CYCLE`). The learner's explicit request overrides this; a lesson the path did not plan gets a line added first.
2. Run `teach path candidates` (with `--topic <mission topic>` when the binding's `defaults.topics` is broader than the mission) and read the group of the line being built: every entry there is a candidate the vault already holds for this lesson, so cite it in the plan's claims or say in the plan why not, and an entry that contradicts a claim changes the claim before the probe runs. Then write `evidence/NNNN/PLAN.md` (§3), with the chosen criterion on its first line. Choose the lesson's shape here, `concept`, `tool`, `diagnose` or `project`, and write a sixth part in the plan, **Elements**: the parts the learner must hold at once to understand the win, each marked `held` (a Floor term, an earlier lesson's term or tool, a record) or `new`; a lesson adds one `new` structure, so when parts would have to be introduced together with their interaction, the parts come first in their own lesson. The probe uses only known or taught tools; if the win needs a new tool, this lesson teaches that tool and the win moves to the next lesson. NNNN is the next lesson number after the highest present.
3. Probe and capture per §3.
4. First lesson in a workspace only: copy the components and ignore the server file, from the workspace root.
   ```sh
   mkdir -p assets && cp -n "${CLAUDE_PLUGIN_ROOT}/skills/research-teach/assets/lesson.css" "${CLAUDE_PLUGIN_ROOT}/skills/research-teach/assets/quiz.js" assets/
   grep -qxF .teach-serve.json .gitignore 2>/dev/null || echo .teach-serve.json >> .gitignore
   ```
   `cp -n` never overwrites a copy the workspace has edited. `teach serve` renders an index of every lesson at `/`, and each served lesson shows a navigation bar (all lessons, previous, next) from `/lessons.json`, which carries the path's line count and each lesson's line, shape and closing `Project:` line, from which the widget builds `line N of M`; the index groups lessons under the `Project:` line that closes their group and shows each lesson's shape, so the learner can go back to earlier lessons. `/progress` (and `teach progress`) shows every attempt per lesson with first, latest and best scores, the active records, and what is due for review; point the learner at it when they ask how they are doing.
5. Write `lessons/NNNN-slug.html` per `LESSON-FORMAT.md`: the `mission` block's sentences (the win; the idea in a `concept`, `tool` or `diagnose` lesson; the activity in a shaped lesson), the `model` block first in a `concept` or `tool` lesson, after `predict` in a `diagnose` lesson, and none in a `project` lesson (a bridge from a Floor term, how the parts relate and why, each figure in a pair with the paragraph it illustrates: `<div class="pair"><p>…</p><figure>…</figure></div>`), `data-introduces` for at most three terms each in a `<dfn>`, `data-teaches` for a tool, then the facts the probe showed. A `concept` lesson ends with a `connect` prompt in the terminal, not in the widget: the learner says how the new term relates to two terms they hold, and when it holds you record it with `teach record add --kind understanding` (§6). Add `lesson: <id>` to the lesson's `PATH.md` line. Then run `teach path edges` and read the proposals under this lesson's line: each names a term this lesson uses, or a tool it runs, that an earlier line introduces or teaches and the line's `after:` does not reach (proposals under other lines, including untaken lines' titles, are for those lines), so add the `after:` value or say in `NOTES.md` why not, and record in `GATE-LOG.md` what it proposed and what was taken.
6. Run `teach lint`. Fix every finding and lint again until it prints `lint: clean`. Warnings are advisory.

## 5. Reader gate, then claims gate, before the learner sees it

`teach lint` must be clean first. Then the reader gate: dispatch ONE `research-vault:lesson-reader` agent (Agent tool, `subagent_type: research-vault:lesson-reader`, no `model`, not a fork) with a prompt that is exactly the lesson's absolute path and nothing else. It has no mission, evidence or session context on purpose: it reads the page as the learner will and returns `VERDICT: READS` or `VERDICT: REVISE` with findings. On `REVISE`, fix the lesson, run `teach lint`, and dispatch a fresh reader. When a third reader round still returns `REVISE`, split the lesson only if the findings name scope (too much in the page, a second lesson inside it); otherwise apply the findings, record that round as the decision in `GATE-LOG.md`, and go to the claims gate from that record as from `READS`. Record each reader verdict in `GATE-LOG.md` under the lesson's heading.

After `READS`, run the `research-claims-gate` skill on the lesson (extra ids: its snippet and experiment). Reference docs go through the same lint and gate. After any revision, lint and gate again.

After the gate records `PASS` or `MERIT`, open the lesson:

1. Read `.teach-serve.json` in the workspace. When it is absent, or its `pid` is not alive (`kill -0 <pid>` fails), start `teach serve <workspace>` in the background (`&`, or the Bash tool's background mode). It prints `serving <workspace> at http://127.0.0.1:<port>/` and writes `.teach-serve.json`; read the port from either.
2. Print the lesson URL, `http://127.0.0.1:<port>/lessons/<id>.html`.
3. Open it with `open` on macOS or `xdg-open` elsewhere. With no browser available, print the lesson's path instead.

Always open lessons through `teach serve`: Chrome blocks module scripts on `file://`, so a lesson opened from disk there shows no quiz. Served this way, the quiz records the attempt itself. The widget posts only when the page origin matches `http://127.0.0.1:<port>`; otherwise, or when the POST fails or returns an error, it shows the score and "Tell me your score in the terminal."; record that score with `teach attempt add --lesson <id> --answers <comma list>`.

## 6. After the lesson

- Write a learning record only on evidence of understanding, disclosed prior knowledge, a corrected misconception, or a mission shift (format file). Coverage is not learning. Use `teach record add --title <t> --kind <kind>` with `kind` `understanding`, `prior-knowledge`, `misconception` or `mission-shift`, plus `--lesson <id>` when a lesson produced the evidence.
- A record that turns out wrong is superseded, never edited: write the new record, then `teach record supersede <old id> --by <new id> --reason <text>`.
- Promote a term to `GLOSSARY.md` only once the learner uses it correctly.
- Record preferences and progress in `NOTES.md`.
- Spacing: the session brief counts `review-due` records (older than 21 days and not attempted in the last 21); `teach next` lists `review-due` and `review-failed` (records whose last attempt got their item wrong), derived from the records and attempts. These are candidates for a review lesson. The 21-day gap stays because, for retention intervals up to ten weeks, 21 days is longer than Cepeda et al.'s interpolated optimal gaps (3, 8 and 12 days for recall at 7, 35 and 70 days), and a gap longer than the optimum costs far less recall than one shorter; for a one-year horizon it is short of the 27-day optimum. Vault notes behind a reference doc that `verify --stale` lists are re-verified before the doc is trusted again. Same mechanism, two kinds of decay.
- A review lesson is `lessons/NNNN-review-slug.html`: items drawn from two or three records, each item naming its record (`LESSON-FORMAT.md`). Draw first from `review-due` and `review-failed` records, then from the records of the lessons the `inner:` lines of `teach next` name (the built non-review lines no other such line names in `after:`; a `Project:` line counts as a review here, so the lessons a built project names stay on it), highest lesson number first: no lesson other than a review or project has built on them yet, which this skill takes as the sign their records are the ones to retrieve. A wrong answer is a corrected-misconception candidate for that record.
- A project lesson's run is its attempt: `teach attempt add --lesson <id> --result pass|fail`. A `fail` is a corrected-misconception candidate for the records the project draws on.
