---
description: Validate the research vault; offer to auto-fix safe issues.
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" lint --json`. Summarize violations grouped by code. If any are encoding/formatting/manifest issues, offer to run `lint --fix`; if `WARN_TOPIC_ALIAS` is among the warnings, offer `lint --fix --topics`.
