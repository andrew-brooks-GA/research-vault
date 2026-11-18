---
name: research-librarian
description: Use when you want read-only curation guidance for the research vault. Surfaces stale entries, orphans, sources lacking a distilling note, and aliasable topics; in a run on a scratch vault it changed no file.
---
# Advisory librarian
<!-- evidence: 2026-11-17-advise-librarian-skill-lines-working-tree 2026-11-17-more-lines-behind-research-librarian-skill 2026-11-17-advise-scratch-vault-writes-nothing-sha256 -->
- `research-vault advise [--json]` aggregates EXISTING signals into thirteen sections:
  - **stale** — entries past their volatility refresh window (see `verify`).
  - **stale evidence** — notes/syntheses whose dependencies (`sources`/`contributing_ids`, transitively) are past their window or superseded; the dependent's own `last_verified` is not rewritten.
  - **orphans** — entries with no backlinks and no outgoing edges (any reference field).
  - **sources without notes** — `source` entries no `note` distills.
  - **unverified sources** — sources captured but never independently verified (`captured` provenance only).
  - **notes/synthesis without a summary** — missing the load-bearing `summary` field.
  - **stub bodies** — entries other than sources whose body is a scaffold or empty, with no real prose.
  - **quote residue** — frontmatter scalars carrying a literal `\"`, almost certainly baked in by the pre-0.3.0 serializer; flag for human review, since, by a comment in the code, the 0.3.0 serializer would otherwise keep it as content.
  - **aliasable topics** — entries carrying a topic that has a canonical alias; by the code, `lint --fix --topics` maps each aliased topic to its canonical topic.
  - **open questions** — active questions not yet answered, older than 60 days by their id's date, each with its state and age; close one with `verify --id <question> --answered-by <id>`.
  - **supersede suspects** — pairs of live entries of one type at one subject version (absent and empty count as equal) with the same `source_url` or the same subject name, the one whose id sorts first first (an id begins with its capture date), with the field that paired them; siblings at different versions are a succession and are not listed. Two live entries with the same `source_url` of which only one has a subject version are paired too, with the field `source_url-unversioned`.
  - **near duplicates** — pairs of live sources at different normalised URLs, either on one host sharing more than half of the longer path's segments, or whose titles share at least two terms, more than half of the longer title's terms; the one whose id sorts first first, with the signal.
  - **usage** — per entry how often the pre-web hook or `search` surfaced it and how often the post-tool-use hook recorded a file citing it, per `--topic` value how often `search` was asked and how often it found nothing, and the cold sources (live, never cited) split by whether one of their topics was ever asked for; computed from `_index/usage.jsonl`; by the code, a vault without the log gives no events, so every live source shows as never queried.
- Judging a supersede suspect (the command only pairs): open both entries. The same claim twice → `verify --id <older> --method cross-referenced --result outdated --superseded-by <newer>`. Two versions of one subject → give each its `subject.version`; by the code, `advise` pairs neither entries at two different versions nor a superseded entry, so the pair then leaves the list. One URL captured with a version and without one (`source_url-unversioned`) → when the address floats (`latest`, `main`, `stable` and the like), it has no fixed version: mark the entry with a version `outdated`, superseded by the one without. Otherwise, when the page is of one of the versions captured, mark the entry without a version `outdated`, superseded by the entry of that version; when it is of none, give it its own `subject.version`. Either way the pair leaves the list. Both current and saying different things → add each to the other's `related` and capture a `question` naming them, as the capture skill's conflict review does. A near duplicate is judged the same way; a pair that proves to be two distinct sources stays listed, since there is no dismissal mark yet.
- READ-ONLY: `advise` calls no writer and adds no lint rules, and in a run on a scratch vault every file kept its sha256.
- The librarian only suggests curation; the human or agent decides whether to act (capture a note, add an edge, re-verify, normalize a topic).
