---
name: research-librarian
description: Use when you want read-only curation guidance for the research vault. Surfaces stale entries, orphans, sources lacking a distilling note, and aliasable topics without changing anything.
---
# Advisory librarian
- `research-vault advise [--json]` aggregates EXISTING signals into four sections:
  - **stale** — entries past their volatility refresh window (see `verify`).
  - **orphans** — entries with no backlinks and no outgoing edges (`related`/`contributing_ids`/`sources`).
  - **sources without notes** — `source` entries no `note` distills.
  - **aliasable topics** — entries carrying a topic that has a canonical alias.
- READ-ONLY: `advise` never writes, never adds lint rules, and leaves the vault unchanged. It is convenience, not part of the correctness floor.
- The librarian only suggests curation; the human or agent decides whether to act (capture a note, add an edge, re-verify, normalize a topic).
