---
description: Regenerate the derived Obsidian browsing view (wikilinks + Map-of-Content).
argument-hint: [--out _obsidian]
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" obsidian` and report the summary line. `--out` must name a derived directory under the vault (not the vault root or an entry folder); it refuses otherwise so the canonical entries can't be overwritten.
