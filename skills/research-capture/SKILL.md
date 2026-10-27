---
name: research-capture
description: Use when adding a new entry to the research vault by hand. Ensures correct frontmatter, backlinks, dedup, and supersede-don't-rename discipline.
argument-hint: "[type] [title] [url]"
---
# Capturing an entry
- Fast path: `research-vault capture --type <t> --title "..." [--url ...] [--subject-name ... --subject-version ... --series ...]`.
- For notes and syntheses, include `--summary "<one-line load-bearing claim>"` — it is indexed in the manifest and scanned by `search --text`; omitting it trips `WARN_MISSING_SUMMARY`. Sources accept `--summary` too (optional, not linted): the claim worth knowing before fetching. Syntheses accept `--confidence`; there is no default, so state it.
- **Conflict review before a note.** Before writing a note that cites source Z, run `related Z --depth 1 --direction in --rel sources` and read the notes it returns. Compare their claims and `subject.version` with yours; summaries alone do not establish a contradiction, they tell you which claims to read. If the claims conflict, capture a `question` naming both notes and add each to the other's `related`. Pairwise only.
- By hand: filename `<YYYY-MM-DD>-<slug>.md` IS the id; never store `id`/`last_verified`. Use folder-appropriate `stage`. Add an initial `verifications[]` line. Validate any `related`/`contributing_ids` resolve.
- Dedup: before capturing a source, check the manifest for the normalized url + `subject.version`. A new product version is a NEW entry sharing the `series` (not a supersession).
- **Tool-bearing claims:** if the claim concerns a tool with a `meta/probe-manifests/<tool>.md` manifest, cross-validate against the tool itself before capturing — follow `meta/prompt-templates/probe-tool.md` (run manifest probes, capture output as a `tool-output` primary source pinned to `subject.version`, reconcile; probe wins a same-version conflict with docs).
- Never rename or delete; supersede instead. If `capture` reports a duplicate, surface the existing id and verify it (`research-verify`) instead of re-capturing.

## Optional fields

- Sources: `--authority-tier <primary|secondary|tertiary>` and `--authority-basis <official-docs|spec|source-code|release-notes|vendor-blog|community-report|benchmark|talk|personal-experiment|unknown>`.
- Sources: `--content-file <path>` hashes `content_hash` from a local file's raw bytes (no network); `--captured-via <text>` records provenance; `--store-body` copies the content (decoded as UTF-8) into the entry body (off by default — a copyright/PII surface, so it REQUIRES `--ack-data-egress`).
- Syntheses: `--synthesis-basis <interpretive|primary-rollup>` (declare `primary-rollup` only for factual rollups that legitimately skip notes; see AGENTS.md §2.5).
- Notes/Syntheses: `--summary "<one-line claim>"` — the load-bearing claim; indexed in the manifest, scanned by `search --text`, and exported ungated. Skipping it trips the advisory `WARN_MISSING_SUMMARY`.
- Notes: `--sources <id,id>` and `--confidence <high|medium|low>`.
- Experiments: `--provider`, `--model-id`, `--task`, `--outcome <success|partial|failure|inconclusive>`.
- Questions: `--state <open|investigating|answered>` and `--answer-summary "<one-line answer>"` — the answered-question payload the default `export` emits; set it when marking a question `answered` (batch key `answerSummary`).
- Any type: `--scaffold` seeds a per-type body skeleton (headings only; default off).
- Any non-source type: `--body-file <path>` writes the entry body from a file (author prose, ungated — unlike `--store-body`, which copies external source text and stays egress-gated).
- Batch mode: `--batch <plan.json>` captures an ordered JSON array of entries in one atomic call — every entry is validated first (unknown enums, missing note `sources` / synthesis `contributingIds`, unresolved references) and nothing is written if any entry fails. Later entries may reference earlier ones by their deterministic id (`YYYY-MM-DD-slug`). Duplicates are reported as `skipped`, the content-changed tripwire as an error. Spec keys are the camelCase capture opts (`subjectName`, `contributingIds`, …); list fields may be JSON arrays. Authored types (note/synthesis/snippet/question/experiment) should carry a `body` key with the entry's prose; a `body` on a source is rejected (use `--store-body`). Used by `research-orchestrate` to persist a capture plan; `--store-body` inside a plan still requires the CLI-level `--ack-data-egress`.

## Before capturing a `synthesis`: self-check
Persistence is the last step, not the planning step. Primary control lives in the vault's `AGENTS.md` §2.6 (pre-synthesis checkpoint). Before invoking `capture --type synthesis`, confirm:

1. **Notes:** does each load-bearing source in `contributing_ids` have a corresponding `note` (possibly multi-source) that's already captured, OR is `synthesis_basis: primary-rollup` justified by a factual-rollup scope (release-note matrix, version diff, standards summary)?
2. **Questions:** were any ambiguities encountered? If yes, capture each as a `question` first and include their ids in `contributing_ids`.
3. **Experiments:** did any tool/model/empirical run inform a claim? Capture as `experiment` first and reference it.
4. **Snippets:** any reusable YAML/config/code you'd otherwise embed in the synthesis body? Capture as `snippet` first.

If any of the above were skipped without justification, **pause and capture them before the synthesis**. A synthesis that fails this check will trip the `WARN_SYNTHESIS_NO_NOTE_COVERAGE` lint and likely indicates monolithic-report failure mode.
