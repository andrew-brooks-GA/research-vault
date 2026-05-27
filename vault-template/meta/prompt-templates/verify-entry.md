# Prompt: Verify an entry

Use before citing, or when an entry is stale (`research-vault verify --stale`).

1. Compute `last_verified := max(verifications[].date)`; check `volatility`.
2. Decide if verification is needed (volatile → always; fast >90d; slow >365d; stable >3y or specific cue).
3. Pick a method: `refetched-source`, `cross-referenced`, `existence-check` (weak), `human-spot-check`, or `inferred-stable` (only stable + durable book/paper/talk).
4. Decide a result and act: `confirmed`/`changed-trivially` → update in place + bump `updated`; `outdated` → supersede (new id, mark old); `inconclusive` → do NOT append a confirming verification.
5. Fast path: `research-vault verify --id <id> --method <m> --result <r> [--by-id <model>]`.
6. Offline: only `inferred-stable` and `human-spot-check` are valid; prefix stale-dependent answers with `"unverified-offline"`.

Anti-patterns: re-reading an entry is NOT verification; never mutate the body on `outdated` (supersede); never store `last_verified`.
