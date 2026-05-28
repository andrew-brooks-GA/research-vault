---
name: research-capture
description: Use when adding a new entry to the research vault by hand. Ensures correct frontmatter, backlinks, dedup, and supersede-don't-rename discipline.
---
# Capturing an entry
- Fast path: `research-vault capture --type <t> --title "..." [--url ...] [--subject-name ... --subject-version ... --series ...]`.
- By hand: filename `<YYYY-MM-DD>-<slug>.md` IS the id; never store `id`/`last_verified`. Use folder-appropriate `stage`. Add an initial `verifications[]` line. Validate any `related`/`contributing_ids` resolve.
- Dedup: before capturing a source, check the manifest for the normalized url + `subject.version`. A new product version is a NEW entry sharing the `series` (not a supersession).
- Never rename or delete; supersede instead.

## Before capturing a `synthesis`: self-check
Persistence is the last step, not the planning step. Primary control lives in the vault's `AGENTS.md` §2.6 (pre-synthesis checkpoint). Before invoking `capture --type synthesis`, confirm:

1. **Notes:** does each load-bearing source in `contributing_ids` have a corresponding `note` (possibly multi-source) that's already captured, OR is `synthesis_basis: primary-rollup` justified by a factual-rollup scope (release-note matrix, version diff, standards summary)?
2. **Questions:** were any ambiguities encountered? If yes, capture each as a `question` first and include their ids in `contributing_ids`.
3. **Experiments:** did any tool/model/empirical run inform a claim? Capture as `experiment` first and reference it.
4. **Snippets:** any reusable YAML/config/code you'd otherwise embed in the synthesis body? Capture as `snippet` first.

If any of the above were skipped without justification, **pause and capture them before the synthesis**. A synthesis that fails this check will trip the `WARN_SYNTHESIS_NO_NOTE_COVERAGE` lint and likely indicates monolithic-report failure mode.
