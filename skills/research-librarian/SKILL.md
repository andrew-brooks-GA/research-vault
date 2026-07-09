---
name: research-librarian
description: Use when you want read-only curation guidance for the research vault. Surfaces stale entries, orphans, sources lacking a distilling note, and aliasable topics without changing anything.
---
# Advisory librarian
- `research-vault advise [--json]` aggregates EXISTING signals into eight sections:
  - **stale** — entries past their volatility refresh window (see `verify`).
  - **orphans** — entries with no backlinks and no outgoing edges (`related`/`contributing_ids`/`sources`).
  - **sources without notes** — `source` entries no `note` distills.
  - **unverified sources** — sources captured but never independently verified (`captured` provenance only).
  - **notes/synthesis without a summary** — missing the load-bearing `summary` field.
  - **stub bodies** — scaffold or empty bodies with no real prose.
  - **quote residue** — frontmatter scalars carrying a literal `\"` baked in by the pre-0.3.0 serializer; flag for human review before re-serialization makes it permanent.
  - **aliasable topics** — entries carrying a topic that has a canonical alias.
- READ-ONLY: `advise` never writes, never adds lint rules, and leaves the vault unchanged. It is convenience, not part of the correctness floor.
- The librarian only suggests curation; the human or agent decides whether to act (capture a note, add an edge, re-verify, normalize a topic).
