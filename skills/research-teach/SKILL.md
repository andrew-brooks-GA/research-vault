---
name: research-teach
description: Use when the user wants to learn a topic over multiple sessions in a vault-bound repo — "teach me X", "/research-teach", "I'm stuck on this passage", or a question about a lesson, reference doc or learning record in a teaching workspace. Owns the teaching workspace (mission, lessons, reference docs, learning records) and wires it to the vault — resources are vault sources, reference facts are vault notes, every behaviour claim is probed, kept as evidence and gated by a fresh claims reviewer before the learner sees it. For a research question with no learner, use research-orchestrate.
---
# Teaching from the vault

The pedagogy here is adapted from Matt Pocock's `teach` skill (mattpocock/skills, MIT). What this skill adds is a system of record: facts live in the vault with a review date, and nothing reaches the learner that the recorded evidence does not support. A lesson that is wrong gets memorised, because lessons are built for retention, so the truth check is not optional.

## 0. Resolve paths once

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now; subagents do not inherit it.
- The repo must be vault-bound (`.research-vault.json`). If it is not, run `init --project` first and set `defaults.topics` to the topic.
- Format files for the workspace documents live next to this file: `MISSION-FORMAT.md`, `LEARNING-RECORD-FORMAT.md`, `GLOSSARY-FORMAT.md`.

## 1. The workspace

The directory `/research-teach` was run in. One mission per workspace.

| File | Holds | Who owns it |
|---|---|---|
| `MISSION.md` | Why the learner wants this; grounds every decision | learner state |
| `GLOSSARY.md` | Terms the learner can already use correctly | learner state |
| `learning-records/NNNN-slug.md` | What the learner has demonstrated; sets the zone of proximal development | learner state |
| `NOTES.md` | Preferences, chapter progress, gate decisions | learner state |
| `lessons/NNNN-slug.html` | One tightly scoped win each; the unit of teaching | view |
| `reference/*.html` | Compressed essence, printable, revisited | view of vault notes |
| `assets/` | Shared stylesheet, quiz widget, other reusable components | view |
| `evidence/NNNN/` | Probe programs and `run.sh` for lesson NNNN; a working folder, not evidence until captured | scratch |

There is no `RESOURCES.md`. Trusted sources are vault `source` entries (communities too, as `source_type: community-report`); gaps are vault `question` entries; `search --topic <topic>` is the resource list. The facts a reference doc compresses live in a vault `note` so they carry a review date; the HTML is a rendering of that note.

## 2. Mission first

If `MISSION.md` is missing or vague, interview the learner before anything else and write it per the format file. Confirm with the learner before changing it later, and add a learning record when it changes.

## 3. Knowledge comes from the vault or the probe, never memory

1. Search the vault before the web: `search --topic`, `--text`, `--body`. Fresh entries answer; stale ones get re-verified (research-vault-usage §2) before they are taught.
   The vault is the source of truth. The web is where sources are found, not a source. A page you fetch is captured as a `source` entry before anything from it is taught or cited (`--store-body --ack-data-egress` when the quoted text matters); a page you did not capture does not exist as far as the lesson, the reference doc or the reviewer is concerned.
2. Capture every resource you rely on, with `summary` saying what to use it for, `subject` name and version, and the workspace's topic. Dedup is automatic.
3. Evidence is exactly three kinds of vault entry: `source`/`note` for what a document says, `snippet` for locally verifiable code, `experiment` for the log of a local run. Every claim about what a program prints, what a compiler or runtime says, what an API is named or what a version does is verified by running it, and the run is persisted: the probes under `evidence/NNNN/` are captured as one `snippet` (`--language`, `--tested true`), and `run.sh`'s output as one `experiment` (`--date-run`, `--outcome`, `--related <snippet id>`, Result verbatim, then `verify --method tool-probe`). A run that exists only on disk is not evidence; a web page is evidence only once captured as a `source`, so capture before you cite. Non-software topics keep the quoted passage or measurement in the entry body.

## 4. Build the lesson

Pedagogy, in brief. Read the full source skill if you want the reasoning.

- **Zone of proximal development.** Read the learning records and the mission; teach the most relevant next thing that is challenging but reachable. If the learner names the thing, teach that.
- **Short.** Working memory is small. One tangible win, completable fast, tied to the mission.
- **Knowledge first, then skill.** Difficulty is the enemy of acquisition and the tool of retention. Teach the fact plainly, then make the learner retrieve it: quizzes with immediate feedback, a real-world step with an observable result.
- **Storage over fluency.** Retrieval practice, spacing, interleaving (skills only). A learner who feels fluent after reading has not learned yet; the quiz is where learning happens.
- **Quiz hygiene.** Answers of equal length; correct position varies; no formatting tells.
- **Cite.** Every claim links its vault entry or primary source. Recommend one primary source to read.
- **Reuse components.** Read `assets/` before writing; the shared stylesheet is the first asset. Lessons link to each other and to reference docs by anchor.
- **Wisdom is delegated.** Questions about idiom or real-world practice get an answer and a pointer to a community (a captured `community-report` source). Respect an opt-out recorded in `NOTES.md`.
- **Reminder in every lesson** that the learner can ask follow-up questions in the terminal.

Number lessons `NNNN-slug.html`, next number after the highest present. If possible, open the lesson for the learner with a CLI command, after the gate.

## 5. Claims gate, before the learner sees it

1. Dispatch ONE `claims-reviewer` subagent (Agent tool, `subagent_type: claims-reviewer`, no `model`, not a fork). The prompt is only the inputs:

   ```
   Draft: <path>
   Vault: <absolute vault path>
   Evidence (read ONLY these vault entries):
   <entry ids, one per line: sources and notes cited, the lesson's snippet, its experiment>
   ```

   Do not summarise what you did; the summary is the bias.
2. `FAIL-as-sent`: narrow the claim to what the evidence shows, or add the missing probe, re-run `run.sh`, and re-capture the snippet and experiment (the old ones get `verify --result outdated --superseded-by <new id>`). Then re-run the gate. Never argue a finding down without changing the draft or the evidence. After the second round, decide each surviving finding on its merits, write the decision and reasoning in `NOTES.md`, and stop; a logged override beats a green verdict bought by re-rolling.
3. Mark the draft: `<!-- claims-gate: PASS <date> -->`, or `<!-- claims-gate: MERIT <date>, see NOTES.md -->`.
4. A citation or file with no vault entry is `unsupported` and fails the gate; capture it, add the id to the evidence list, re-run. `check <draft>` finds uncaptured URLs before the reviewer does.

Reference docs go through the same gate; they are revisited more than lessons.

## 6. After the lesson

- Write a learning record only on evidence of understanding, disclosed prior knowledge, a corrected misconception, or a mission shift (format file). Coverage is not learning.
- Promote a term to `GLOSSARY.md` only once the learner uses it correctly.
- Record preferences and progress in `NOTES.md`.
- Spacing: at the start of a session, learning records older than a few weeks are candidates for a retrieval-practice lesson; vault notes behind a reference doc that `verify --stale` lists are re-verified before the doc is trusted again. Same mechanism, two kinds of decay.
