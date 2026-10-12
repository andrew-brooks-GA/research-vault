---
description: Show entries related to an id (typed forward edges + backlinks, bounded traversal).
argument-hint: [id] [--depth N] [--direction out|in|both] [--rel a,b]
---
Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" related <id>` (add `--format mermaid` for a graph) and present the result. `--depth 2 --direction out <synthesis>` walks the evidence chain (synthesis → notes → sources); `--direction in <source>` walks what depends on it; `--rel sources,contributing_ids` restricts the relations followed.
