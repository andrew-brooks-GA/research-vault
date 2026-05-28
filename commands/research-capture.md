---
description: Capture a new vault entry (source/note/synthesis/snippet/experiment/question).
argument-hint: [type] [title] [url]
---
Gather: type, title, and (for sources) url, and optional subject name/version + series for versioned resources. Optional fields:

- Sources: `--authority-tier <primary|secondary|tertiary>` and `--authority-basis <official-docs|spec|source-code|release-notes|vendor-blog|community-report|benchmark|talk|personal-experiment|unknown>`.
- Syntheses: `--synthesis-basis <interpretive|primary-rollup>` (declare `primary-rollup` only for factual rollups that legitimately skip notes; see AGENTS.md §2.5).
- Notes: `--sources <id,id>` and `--confidence <high|medium|low>`.
- Experiments: `--provider`, `--model-id`, `--task`, `--outcome <success|partial|failure|inconclusive>`.
- Questions: `--state <open|investigating|answered>`.

Run `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" capture` with the matching `--` flags. If the tool reports a duplicate, surface the existing id and run `/research-verify` instead of re-capturing.
