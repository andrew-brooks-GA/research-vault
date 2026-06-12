---
description: Capture a new vault entry (source/note/synthesis/snippet/experiment/question).
argument-hint: [type] [title] [url]
---
Gather: type, title, and (for sources) url, and optional subject name/version + series for versioned resources. Optional fields:

- Sources: `--authority-tier <primary|secondary|tertiary>` and `--authority-basis <official-docs|spec|source-code|release-notes|vendor-blog|community-report|benchmark|talk|personal-experiment|unknown>`.
- Sources: `--content-file <path>` hashes `content_hash` from a local file's raw bytes (no network); `--captured-via <text>` records provenance; `--store-body` copies the content (decoded as UTF-8) into the entry body (off by default — a copyright/PII surface, so it REQUIRES `--ack-data-egress`).
- Syntheses: `--synthesis-basis <interpretive|primary-rollup>` (declare `primary-rollup` only for factual rollups that legitimately skip notes; see AGENTS.md §2.5).
- Notes/Syntheses: `--summary "<one-line claim>"` — the load-bearing claim; indexed in the manifest, scanned by `search --text`, and exported ungated. Skipping it trips the advisory `WARN_MISSING_SUMMARY`.
- Notes: `--sources <id,id>` and `--confidence <high|medium|low>`.
- Experiments: `--provider`, `--model-id`, `--task`, `--outcome <success|partial|failure|inconclusive>`.
- Questions: `--state <open|investigating|answered>`.
- Any type: `--scaffold` seeds a per-type body skeleton (headings only; default off).
- Batch mode: `--batch <plan.json>` captures an ordered JSON array of entries in one atomic call — every entry is validated first (unknown enums, missing note `sources` / synthesis `contributingIds`, unresolved references) and nothing is written if any entry fails. Later entries may reference earlier ones by their deterministic id (`YYYY-MM-DD-slug`). Duplicates are reported as `skipped`, the content-changed tripwire as an error. Spec keys are the camelCase capture opts (`subjectName`, `contributingIds`, …); list fields may be JSON arrays. Used by `research-orchestrate` to persist a capture plan; `--store-body` inside a plan still requires the CLI-level `--ack-data-egress`.

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" capture` with the matching `--` flags. If the tool reports a duplicate, surface the existing id and run `/research-verify` instead of re-capturing.
