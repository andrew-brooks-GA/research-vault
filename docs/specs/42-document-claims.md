# Spec 42: document claims in a teach lesson, the probe conditional (issue #51)

Round 1 (2026-11-02), on master at 2547556. The repo lines this spec names are quoted in snippet 2026-11-03-lines-behind-2026-11-02-all, at fb2a227 for the lines it changes and at 2547556 for the issues file, the fixture and the tests; the tree at 2547556 differs from fb2a227 only in `CHANGELOG.md` and the all-learners issues file, as the `git diff --stat` quoted in the snippet shows, so every quoted line stands. The issue body (Issue A of the all-learners issues file in `docs/specs/`, claims-gated with the verdict MERIT and posted as #51 per the quoted `CHANGELOG.md` line) says what exists; this spec decides the wording and the one check, and is judgment where it says so.

## What exists, in one paragraph

Evidence is three kinds of vault entry, and every claim about what a program prints, what a runtime says, what an API is named or what a version does is verified by running it and persisted as one `snippet` and one `experiment`; the one quoted line about any other topic is "Non-software topics keep the quoted passage or measurement in the entry body." (SKILL.md line 58). The section's opening paragraph says "Plan before you probe" and "Write the probe against the claim lines." (line 52), `evidence/NNNN/` is "Probe programs and `run.sh`" (line 31), the build procedure says "Probe and capture per §3" (line 80) and "then the facts the probe showed" (line 87), and the gate step passes "extra ids: its snippet and experiment" (line 94). The plan's part 4 is "The probe: what to run and what output would support each claim." (LESSON-FORMAT.md line 145) and the paragraph after the list opens "Write the probe against the claim lines." (line 149); the `fact` row is "What the probe established, one cited claim per `<p>`" (line 26) and the `example` row "The probe's input and verbatim output, cited to its `snippet` and `experiment`" (line 27). The claims reviewer already supports the other kind: `source` and `note` entries "support claims about what a document, API reference or author says" and a `no-body` entry "supports only the claim that the document exists" (agents/claims-reviewer.md lines 14 and 18); the gate skill's step 1 omits `--extra` when there are no snippet or experiment ids (research-claims-gate SKILL.md line 21). The quoted lint rules read none of this (bin/lib/lesson.mjs lines 453 to 456 check that `PLAN.md` exists and has an Elements part). The REFERENCE row says "probed evidence" (docs/REFERENCE.md line 32).

## Design

### D1. Two claim kinds, named in the plan

A claim is a program claim or a document claim, and the plan's probe part says which. A program claim (what a program prints, what a runtime says, what an API is named, what a version does, and any claim a one-line run can show, such as a payment schedule or a confidence interval) is probed and persisted exactly as now. A document claim (what a document says, a figure in a table, a date, a rule) is read, not run: it cites the `source` whose stored body holds the passage and the `note` that distils it, and the plan's probe part says `none: document claims` and lists, per claim, the entry and the passage. The fact block then cites those entries where a probed lesson cites its snippet and experiment. The last sentence of line 58 is replaced by this, since it covered the same case in fewer words and said nothing about what the fact block cites.

Why the plan decides, judgment: the quoted lint rules do not tell a program claim from a document claim, and the reviewer already judges each claim against the kind of entry it cites (claims-reviewer.md lines 14 and 18). Recording the kind in the plan gives the next author and the gate log the author's call.

### D2. The example block stays a run

The `example` block keeps line 27 as it is: a probe's input and verbatim output. A quoted passage belongs in the fact block's `<p>`, as a quotation ending in its citation anchor, not in an example block. This settles the open question in Issue C of the same batch (its What remains, quoted in the snippet, leaves the example label undecided): the example label "the output, read with me" stays, and only the fact label changes there. Judgment: one block per evidence kind keeps the reader's Example check ("how to look at the output", agents/lesson-reader.md line 20) true of every example block.

### D3. The lines, with their replacement text

| File | Line | Now | After |
|---|---|---|---|
| SKILL.md | 31 | "Probe programs and `run.sh` for lesson NNNN; a working folder, not evidence until captured" | "The plan for lesson NNNN, with the probe programs and `run.sh` when it has a probe; a working folder, not evidence until captured" |
| SKILL.md | 52 | "Plan before you probe. ... Write the probe against the claim lines." | "Plan before you probe or quote. ... Write the probe, or choose the passages, against the claim lines." |
| SKILL.md | 58 | "Every claim about what a program prints, ..." and the last sentence "Non-software topics keep the quoted passage or measurement in the entry body." | The D1 paragraph: the second sentence ("Every claim about ...") becomes "A claim is a program claim or a document claim, and the plan's probe part says which. A program claim, ..., is verified by running it", the existing persistence text follows unchanged, and the last sentence becomes the document-claim sentence of D1 |
| SKILL.md | 80 | "Probe and capture per §3." | "Probe, or choose the passages, and capture per §3." |
| SKILL.md | 87 | "then the facts the probe showed" | "then the facts the probe or the passages showed" |
| SKILL.md | 94 | "(extra ids: its snippet and experiment)" | "(extra ids: its snippet and experiment, when it has them)" |
| LESSON-FORMAT.md | 26 | "What the probe established, one cited claim per `<p>`" | "What the evidence established, by the probe or by the passages the plan lists, one cited claim per `<p>`" |
| LESSON-FORMAT.md | 145 | "The probe: what to run and what output would support each claim." | "The probe: what to run and what output would support each claim, or `none: document claims` and, per claim, the entry and the passage that supports it." |
| LESSON-FORMAT.md | 149 | "Write the probe against the claim lines." | "Write the probe, or choose the passages, against the claim lines." |
| docs/REFERENCE.md | 32 | "probed evidence" | "evidence probed or read from stored sources" |

No other file changes. LESSON-FORMAT.md line 27 (`example`) and the labels are untouched (D2; the labels are Issue C, #53 per the quoted `CHANGELOG.md` line).

### D4. The one check

A test in `test/lesson.test.mjs`, on a copy of the fixture workspace: the diagnose fixture `lessons/0005-diagnose-fx.html` with its two fact `<p>` recited to `2026-01-01-fx-doc` and its snippet and experiment removed from `sources`, and `evidence/0005/PLAN.md` with its probe part replaced by `none: document claims` and one passage line, lints with no finding. It pins that none of the quoted lint rules requires a snippet or an experiment, which Issue A read from the code's shape (its What exists, quoted in the snippet); a lint rule added later that does would fail it.

### D5. Not done here

No lint rule (D1 says why). No fixture lesson: a document-claims lesson on an untaken `PATH.md` line would change the fringe, candidates and index output that tests pin (test/teach.test.mjs lines 216 and 264, test/lesson.test.mjs line 349, test/teach-serve.test.mjs line 109, quoted in the snippet), for a check D4 makes in one. The reader and claims gate on a real document-claims lesson wait for the first live mission that has one; its gate log entry closes Issue A's Done-when (3), quoted in the snippet.
