---
description: Surface read-only curation guidance: stale entries, orphans, sources without notes, unverified sources, missing summaries, aliasable topics.
argument-hint: [--json]
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" advise` and present the signal sections as suggestions; never mutate the vault. Signals include:

- stale entries (last_verified older than the volatility window)
- orphaned entries (no backlinks and not referenced)
- sources without a distilling note
- sources verified only at capture time (never independently checked)
- notes/synthesis without a one-line `summary` (opaque to manifest-level retrieval)
- aliasable topics (near-duplicate topic strings)
