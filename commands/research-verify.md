---
description: List stale entries and walk through verifying one.
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" verify --stale --json` to list stale entries. To verify one, follow `meta/prompt-templates/verify-entry.md`, then run `verify --id <id> --method <m> --result <r>`. Respect the offline and self-confirmation rules.
