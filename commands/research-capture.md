---
description: Capture a new vault entry (source/note/synthesis/snippet/experiment/question).
argument-hint: [type] [title] [url]
---
Gather: type, title, and (for sources) url, and optional subject name/version + series for versioned resources. Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" capture` with the matching `--` flags. If the tool reports a duplicate, surface the existing id and run `/research-verify` instead of re-capturing.
