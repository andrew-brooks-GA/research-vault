---
name: research-verify
description: Use when checking freshness or verifying a vault entry before citing — implements the method/result decision tree, the three change-outcomes, offline mode, and the self-confirmation rule.
---
# Verifying an entry

- CLI: `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs"`. Resolve `${CLAUDE_PLUGIN_ROOT}` to an absolute path now; it is unset in the Bash environment of the controller and of a subagent.

List stale entries with `node "${CLAUDE_PLUGIN_ROOT}/bin/research-vault.mjs" verify --stale --json`; to verify one, follow `meta/prompt-templates/verify-entry.md`, then run `verify --id <id> --method <m> --result <r>`. Pick a method; for entries about a tool with a `meta/probe-manifests/` manifest, prefer `tool-probe` (follow `meta/prompt-templates/probe-tool.md`; same-version only — a version mismatch is version succession, not outdated). Re-reading an entry is NOT verification. `inferred-stable` only for volatility=stable + durable source. The `captured` seed `capture` writes at creation time is provenance, not verification (`verify` rejects it).

`refresh --json` lists each fetched source as `{ id, result, detail?, storedBody? }`, `storedBody` present on `changed` results. `true` means the entry's body holds a line other than blanks, a lone `-`, lines starting with `#` or a bare ``` line (stored prose is such a line): fetch the page as for any verification, diff its extracted text against the stored body, write the delta in the verification's notes (`--notes`), then confirm (`changed-trivially` or `confirmed`) or supersede. `false` means there is nothing to diff against: verify from the page alone and say so in the notes. A source whose text `capture --fill` stored (a row whose note begins `filled:`) reports `changed` at every refresh on a host whose bytes differ from one fetch to the next: when the page's text matches the stored body, record `changed-trivially`.

Closing a question is not a verification: `verify --id <question> --answered-by <id> [--answer-summary "<one-line answer>"]` sets `state: answered`, writes the summary (the answering entry's `summary` when the flag is omitted), appends the id to `contributing` and adds no verification row.

Three distinct outcomes when something changed:
- **Supersession** — the entry is WRONG/obsolete → `result: outdated` → mark `status: superseded`, create a corrected new entry. (`verify --id <id> --method <m> --result outdated --superseded-by <new-id>`)
- **Update in place** — cosmetic source change, claims unaffected → `changed-trivially`/`confirmed`, bump `updated`.
- **Version succession** — a newer product version shipped but this entry is still correct for ITS version → do NOT supersede; keep it `active` and capture the new version as a sibling sharing the same `series`. (`verify --id <id> --method cross-referenced --result confirmed --succession`, then `capture` the new version.)

Offline: only `inferred-stable`, `human-spot-check`, and `tool-probe` (probes run locally) are valid.
