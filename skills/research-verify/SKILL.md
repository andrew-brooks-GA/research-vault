---
name: research-verify
description: Use when checking freshness or verifying a vault entry before citing — implements the method/result decision tree, the three change-outcomes, offline mode, and the self-confirmation rule.
---
# Verifying an entry
Follow `meta/prompt-templates/verify-entry.md`. Pick a method; re-reading an entry is NOT verification. `inferred-stable` only for volatility=stable + durable source.

Three distinct outcomes when something changed:
- **Supersession** — the entry is WRONG/obsolete → `result: outdated` → mark `status: superseded`, create a corrected new entry. (`verify --id <id> --method <m> --result outdated --superseded-by <new-id>`)
- **Update in place** — cosmetic source change, claims unaffected → `changed-trivially`/`confirmed`, bump `updated`.
- **Version succession** — a newer product version shipped but this entry is still correct for ITS version → do NOT supersede; keep it `active` and capture the new version as a sibling sharing the same `series`. (`verify --id <id> --method cross-referenced --result confirmed --succession`, then `capture` the new version.)

Offline: only `inferred-stable` and `human-spot-check` are valid.
