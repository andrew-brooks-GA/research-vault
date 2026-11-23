---
description: Validate the research vault; offer to auto-fix safe issues.
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" lint --json`. Summarize violations grouped by code. If any are encoding/formatting/manifest issues, offer to run `lint --fix`; if `WARN_TOPIC_ALIAS` is among the warnings, offer `lint --fix --topics`. Report `WARN_ENTRY_LINK_SKIPPED` separately from fixable entries. Lint skips linked type folders and entry files whose targets are outside the vault or cannot be resolved.
