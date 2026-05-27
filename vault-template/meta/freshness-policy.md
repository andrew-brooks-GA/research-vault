# Freshness Policy

The vault is a cache, not a source of truth. This file specifies how agents decide whether a stored entry is current, what counts as verification, and what to do when an entry is wrong.

## 1. Why staleness matters

Cached information ages at very different rates. An algorithm from a 2018 textbook is still right; a model-pricing claim from last quarter is probably wrong. Citing stale cached entries as current is the dominant failure mode of agent-driven research. This policy makes staleness visible and actionable.

## 2. Volatility tiers

| Tier | Covers | Refresh window |
|---|---|---|
| `stable` | Algorithms, design patterns, language semantics, classic books | ~3 years (1095d) |
| `slow` | Established practices, mature frameworks | 365 days |
| `fast` | Tool APIs, framework versions, LLM capabilities, benchmarks | 90 days |
| `volatile` | Pricing, rate limits, "current best model", availability | Always re-check |

Tier definitions live in the plugin's `schema/taxonomy.json` (mirrored in `taxonomy.yaml`).

## 3. Per-tier behavior

Before citing any entry, compute `last_verified := max(verifications[].date)` (it is NOT stored).

1. `volatile` → never quote stored values as current; cite as historical context only; web-search the live value.
2. `fast` and `last_verified` >90 days → flag stale; prefer web; on re-check append a verification and either keep or supersede.
3. `slow` and `last_verified` >365 days → prefer web; supersede on contradiction.
4. `stable` → trust unless something specific cues a re-check.
5. After verification: append to `verifications[]`. A substantive contradiction → supersede (§7); otherwise update in place.

## 4. Offline mode (no web fetch)

1. Do NOT silently rely on stored values for `fast` or `volatile` entries.
2. Prefix any answer that depends on an out-of-window entry with `"unverified-offline"` and the entry id.
3. Do NOT add a `verifications[]` entry of any method other than `inferred-stable` (within its restrictions, §5) or `human-spot-check` (with explicit user confirmation).
4. `stable` and `slow` entries within their window may be used normally.

## 5. What counts as verification

Methods: `refetched-source` (re-fetched original; strong), `cross-referenced` (independent current source; strong), `existence-check` (URL resolves; weak), `human-spot-check` (human confirmed; strong), `inferred-stable` (no fetch; weakest — ONLY for `volatility: stable` AND a durable source type book/paper/talk).

Results: `confirmed` (append; no body change), `changed-trivially` (cosmetic source change, claims unaffected → update in place), `outdated` (claims no longer match → supersede), `unreachable` (404/paywall; archive if persistent), `inconclusive` (do NOT append a confirming verification).

## 6. Self-confirmation rule

An agent re-reading an entry it (or any LLM) authored, without fetching an external source, does NOT constitute verification and MUST NOT add a `verifications[]` entry. Valid verification requires (a) refetching the source, (b) an independent current source on the claim, or (c) explicit human confirmation. `inferred-stable` is the sole exception, restricted as in §5.

## 7. Mutate-vs-supersede invariant

- Update in place: `changed-trivially`, typo/whitespace fixes, broken-link repair, frontmatter corrections, appending verifications. Bump `updated:`.
- Supersede: `outdated`, or any change that alters how the entry is cited. Old entry: `status: superseded` + `superseded_by:`. New entry: new id, references old via `related:`.

If unsure, supersede. Citation integrity > convenience.

## 8. Version succession ≠ supersession

A newer product version shipping does NOT make the old entry wrong. Capture the new version as a NEW entry sharing the same `series:`; keep both `active`. Supersede only when an entry is actually incorrect.

## 9. What NOT to do

- Do NOT delete or rename entries. Always supersede.
- Do NOT overwrite an entry body after an `outdated` result.
- Do NOT append a verification after a no-op re-read.
- Do NOT abuse `inferred-stable`.
- Do NOT claim "current" for `fast`/`volatile` entries while offline.
- Do NOT store `id` or `last_verified` — both are derived.
