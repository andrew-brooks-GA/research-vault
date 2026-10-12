# 09 — Superseded entries excluded from `search` by default

## Problem

`search` returns superseded entries like any other, so an agent that keys on a hit can cite a retired entry. Temporal memory systems converge on a hard validity gate at retrieval (SodaMem, Zep: superseded facts excluded by default, retained for history) with the replacement visible (vault note `2026-10-12-temporal-agent-memories-converge-close-out`).

Traversal is different. `related` must keep superseded nodes: they carry provenance, and removing an intermediate node hides why evidence is invalid. Default traversal already follows `superseded_by` (`bin/lib/graph.mjs`), and spec 08 exposes `status` and `superseded_by` on every node, which is enough for the agent to skip them. No redirect field: traversal from a superseded root under `--direction in` or an evidence-only `--rel` is not guaranteed to reach the replacement, so promising one would lie.

## Change

- `search` (`bin/commands/search.mjs`, `bin/lib/*` search helper): rows with `status: superseded` are dropped from both text and JSON output unless `--include-superseded` is passed. Register `include-superseded` in `BOOL` in `bin/lib/args.mjs` (unregistered, the parser would consume the next token as its value). With the flag, the text line gains a suffix ` (superseded by <id>)`.
- `related`, `advise`, `check`, `manifest`: unchanged.
- Recording a supersession is already supported and needs documenting, not code: capture the replacement, then `verify --id OLD --method <method> --result outdated --superseded-by NEW --notes "<why>"`. `verify` requires `--superseded-by` for `outdated` (`bin/commands/verify.mjs`), appends the dated row and sets the status; `last_verified` ignores `outdated` results. The row's date records when the supersession was recorded, not when the claim became false. AGENTS.md §8 gains this recipe; no `capture --supersedes`.

## Tests

- `test/search.test.mjs`: a superseded fixture is absent by default, present with `--include-superseded`, and the suffix names the replacement; ordering of remaining rows unchanged.
- `test/args.test.mjs` (or inline): `--include-superseded --topic x` parses `topic`.

## Non-goals

Filtering `related` output; a redirect field; a world-time validity axis for claims (`volatility` approximates it, and the knowledge-update gains reported for bi-temporal systems are model-dependent).
