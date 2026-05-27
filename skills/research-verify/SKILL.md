---
name: research-verify
description: Use when checking freshness or verifying a vault entry before citing — implements the method/result decision tree, offline mode, and the self-confirmation rule.
---
# Verifying an entry
Follow `meta/prompt-templates/verify-entry.md`. Pick a method; re-reading an entry is NOT verification. `inferred-stable` only for volatility=stable + durable source. On `outdated`, supersede (create a new entry, mark the old). `changed-trivially`/`confirmed` update in place and bump `updated`. Offline: only `inferred-stable` and `human-spot-check` are valid.
