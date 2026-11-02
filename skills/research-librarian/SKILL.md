---
name: research-librarian
description: Use when you want read-only curation guidance for the research vault. Surfaces stale entries, orphans, sources lacking a distilling note, and aliasable topics without changing anything.
---
# Advisory librarian
- `research-vault advise [--json]` aggregates EXISTING signals into thirteen sections:
  - **stale** — entries past their volatility refresh window (see `verify`).
  - **stale evidence** — notes/syntheses whose dependencies (`sources`/`contributing_ids`, transitively) are past their window or superseded; the dependent's own `last_verified` is not rewritten.
  - **orphans** — entries with no backlinks and no outgoing edges (any reference field).
  - **sources without notes** — `source` entries no `note` distills.
  - **unverified sources** — sources captured but never independently verified (`captured` provenance only).
  - **notes/synthesis without a summary** — missing the load-bearing `summary` field.
  - **stub bodies** — scaffold or empty bodies with no real prose.
  - **quote residue** — frontmatter scalars carrying a literal `\"` baked in by the pre-0.3.0 serializer; flag for human review before re-serialization makes it permanent.
  - **aliasable topics** — entries carrying a topic that has a canonical alias; `lint --fix --topics` rewrites them.
  - **open questions** — active questions not yet answered, older than 60 days by their id's date, each with its state and age; close one with `verify --id <question> --answered-by <id>`.
  - **supersede suspects** — pairs of live entries of one type at one subject version (absent and empty count as equal) with the same `source_url` or the same subject name, older first with the field that paired them; siblings at different versions are a succession and are not listed.
  - **near duplicates** — pairs of live sources at different normalised URLs, either on one host sharing more than half of the longer path's segments, or whose titles share at least two terms, more than half of the longer title's terms; older first with the signal.
  - **usage** — per entry how often the pre-web hook or `search` surfaced it and how often a watched file cited it, per `--topic` value how often `search` was asked and how often it found nothing, and the cold sources (live, never cited) split by whether one of their topics was ever asked for; computed from `_index/usage.jsonl`, so a vault without the log shows every live source as never queried.
- Judging a supersede suspect (the command only pairs): open both entries. The same claim twice → `verify --id <older> --method cross-referenced --result outdated --superseded-by <newer>`. Two versions of one subject → give each its `subject.version`; the pair then leaves the list. Both current and saying different things → add each to the other's `related` and capture a `question` naming them, as the capture skill's conflict review does. A near duplicate is judged the same way; a pair that proves to be two distinct sources stays listed, since there is no dismissal mark yet.
- READ-ONLY: `advise` never writes, never adds lint rules, and leaves the vault unchanged. It is convenience, not part of the correctness floor.
- The librarian only suggests curation; the human or agent decides whether to act (capture a note, add an edge, re-verify, normalize a topic).
