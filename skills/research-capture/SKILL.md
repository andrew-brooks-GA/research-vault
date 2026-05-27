---
name: research-capture
description: Use when adding a new entry to the research vault by hand — ensures correct frontmatter, backlinks, dedup, and supersede-don't-rename discipline.
---
# Capturing an entry
- Fast path: `research-vault capture --type <t> --title "..." [--url ...] [--subject-name ... --subject-version ... --series ...]`.
- By hand: filename `<YYYY-MM-DD>-<slug>.md` IS the id; never store `id`/`last_verified`. Use folder-appropriate `stage`. Add an initial `verifications[]` line. Validate any `related`/`contributing_ids` resolve.
- Dedup: before capturing a source, check the manifest for the normalized url + `subject.version`. A new product version is a NEW entry sharing the `series` (not a supersession).
- Never rename or delete; supersede instead.
