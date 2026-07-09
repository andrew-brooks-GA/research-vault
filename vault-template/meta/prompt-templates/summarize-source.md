# Prompt: Summarize a source into a note

Turn a `sources/` entry into a `notes/` entry.

1. Read the source entry. Identify its load-bearing claims.
2. `research-vault capture --type note --title "..." --summary "<one-sentence load-bearing claim>"` (fast path) — `--summary` is required, or the note trips `WARN_MISSING_SUMMARY`; or author by hand: filename `<today>-<slug>.md`, `stage: distilled`, `sources: [<source-id>]`, `summary: <claim>`, `confidence: high|medium|low`.
3. Distill — don't copy. Capture claims, caveats, and how you'd use it.
4. Back-link: list the source id in `sources:`. Append an initial `verifications[]` line.
