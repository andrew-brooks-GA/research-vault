# Prompt: Promote notes into a synthesis

Combine 2+ notes (and optionally other syntheses) into a `synthesis/` entry.

1. Pick the driving `question:`.
2. First walk the AGENTS.md §2.6 capture plan: distill the load-bearing sources into `note` entries so the synthesis has note coverage. A synthesis whose `contributing_ids` reference no note trips `WARN_SYNTHESIS_NO_NOTE_COVERAGE` — unless it is honestly a primary-source factual rollup (a release-note matrix, version diff, or standards summary), in which case set `synthesis_basis: primary-rollup` and justify it in the body.
3. `research-vault capture --type synthesis --title "..."` (add `--synthesis-basis primary-rollup` for a rollup) then set `contributing_ids: [...]` (note/source/synthesis ids — recursive synthesis allowed).
4. Synthesize across sources: agreements, tensions, what would change your mind.
5. `stage: synthesized` (or `stable` once durable). Validate all `contributing_ids` resolve.
