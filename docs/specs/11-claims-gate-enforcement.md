# Spec 11: claims gate enforcement

Round 3 (2026-10-26). The `claims-reviewer` agent and the teach skill's §5 carry the reviewer design from the vcluster support lab (fresh subagent, no model override on the spawn, no investigation summary in the prompt, merit decision after round two). What they lack is the enforcement layer that makes the gate run without being asked, and three evidence-handling rules that lab learned from drafts that passed while wrong. Evidence for the design is that lab's `.claude/skills/claims-gate`, `.claude/hooks/draft-gate-check.mjs` and `.claude/hooks/lib/domain-citation.mjs`.

## Problems

1. The verdict is self-attested and not keyed to content. `<!-- claims-gate: PASS <date> -->` lives inside the draft; edit the lesson afterwards and the marker still says PASS.
2. The agent file pins no model or effort, so the reviewer inherits whatever the drafting session runs.
3. The evidence list is typed by the drafter. The entry that contradicts the draft can be left out, which is the bias the "no summary" rule removes, moved one step.
4. A `source` captured without `--store-body` has only a summary. The reviewer is asked to quote the evidence line, and there is none, so "the docs say X" resolves to a title.
5. The gate is reachable only from `research-teach`. `research-orchestrate` syntheses and `research-authoring` citations never meet the reviewer.
6. Merit decisions land in `NOTES.md` with learner preferences.
7. No test covers the agent file or the gate.
8. The pre-web hook guards inbound; nothing warns when a citation lands in a document outside the vault with no entry (`check` exists but nothing runs it at write time).
9. A failing probe `run.sh` can be re-run until green with no record of why it failed.
10. Spacing (old learning records, reference docs whose notes went stale) is remembered by the model, not surfaced.

## Design

### Ledger and Stop hook (1, 6)

- `bin/lib/gate.mjs`: `contentHash`, `recordVerdict`, `gateStatus`. The ledger is `<repo root>/.research-vault-ledger.jsonl`, repo root being the directory holding `.research-vault.json`. One JSON row per line: `{ "ts", "event": "claims", "file": <repo-relative>, "sha256", "verdict": "PASS" | "FAIL-as-sent" | "MERIT", "note"? }`. The hash is over the file's raw bytes. The in-draft marker is retired; the skill stops writing it and old markers are ignored.
- `research-vault gate record <file> <verdict> [note]`, `gate status <file> [--check]`, `gate evidence <draft> [--extra <ids>] [--json]`.
- `hooks/stop-gate.mjs` on `Stop`: gated files modified since the transcript was created with no `PASS` or `MERIT` row for their current hash block the turn once (`stop_hook_active` ends the loop). Gated files are `lessons/*.html` and `reference/*.html` under every teach workspace (a directory holding `MISSION.md`) plus the project config's optional `gates.globs`. Vault syntheses are not hook-gated; the orchestrate skill calls the gate as a step.
- Merit decisions go to `GATE-LOG.md`, append-only ("do not edit earlier entries"), in the teach workspace when the draft is under one, else at the repo root. The reviewer is forbidden to read it.

### Evidence derivation (3, 4)

- `gate evidence <draft>` derives the list: every vault id and URL the draft cites (`extractCitations`) resolved through the manifest, plus `--extra` ids for the lesson's snippet and experiment. Output is one line per entry: `<id> [<type>, <status>, STALE?, no-body?]`, then `uncovered:` lines for citations with no entry. The skill pastes this output into the reviewer prompt verbatim.
- `no-body` flags a `source` or `note` whose body, after the `# title` line, is shorter than `MIN_BODY_CHARS = 200`. The agent file gains the rule: an entry flagged `no-body` supports only the claim that the document exists and concerns the subject. A behaviour claim or a "the docs say X" claim resting on it is `exceeds-evidence`. The fix is re-capturing with `--store-body --ack-data-egress`.
- The reviewer may grep the vault for the draft's subject name and URLs. An entry it finds that is not on the evidence list and contradicts the draft is reported `contradicted (not on evidence list)`.

### Agent file (2, 7)

- `agents/claims-reviewer.md` gains `model: opus` and `effort: high`.
- `test/agent.test.mjs` parses the agent frontmatter: tools are a subset of `Read, Grep, Glob`; `model` and `effort` present; the body names `no-body`, `GATE-LOG.md` and `not on evidence list`.
- `test/fixtures/gate/`: a small vault (a source with a stored body, a source without, a snippet, an experiment that probes one value), `lesson-ok.html`, `lesson-overclaim.html` (generalises the one probed value), `gold.json` with the expected verdict per draft. `docs/EVALUATION.md` gains a "Claims gate" section: run the agent on each fixture five times, record verdicts as an `experiment`, report agreement; the agent prompt changes only with a run.

### Gate as a skill (5)

- `skills/research-claims-gate/SKILL.md` and `commands/research-claims-gate.md`. Steps: `check --check <draft>` clean before dispatch; `gate evidence`; dispatch one `claims-reviewer` with draft path, vault path, evidence list; on `FAIL-as-sent` narrow, capture or probe and re-run; after round two decide each finding on merit in `GATE-LOG.md`; `gate record`.
- `research-teach` §5 becomes a pointer to the skill. `research-orchestrate` §4 runs the gate on the synthesis before presenting it (evidence: `contributing_ids` and `sources`, derived by `gate evidence`). `research-authoring` §3 runs the gate when the document matches `gates.globs`.

### Write-time citation warning (8)

- `hooks/post-tool-use.mjs`: when the edited file is inside a bound repo and matches `references.globs` or is a gated file, run `checkCitations` on it and return `additionalContext` listing each `uncovered` or `stale` citation. Never blocks.

### Probe reruns and spacing (9, 10)

- `research-teach` §3: a failed `run.sh` gets a line in `evidence/NNNN/RERUNS.md` (`harness-infra` or `hypothesis-relevant`, plus the fix) before any rerun.
- `hooks/session-start.mjs`: for each teach workspace under the cwd, one line: learning records older than `SPACING_DAYS = 21` (file mtime) and reference docs with a stale citation.

## Deferred

- Automating the fixture eval with `claude plugin eval`; the protocol is written, the runner is not.
- Hook enforcement for vault syntheses.
- A content-hash that ignores the retired marker; raw bytes are enough once the marker is gone.
