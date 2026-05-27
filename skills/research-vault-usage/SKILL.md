---
name: research-vault-usage
description: Use when answering a software-engineering, learning-SE, or LLM-assisted-development question and a research vault is available — covers locating the vault, navigating, applying freshness before citing, and citing versioned resources.
---
# Using the research vault
1. Locate the vault: `$RESEARCH_VAULT_PATH`, else the OS default (see the vault's `AGENTS.md`).
2. Prefer `.vault-manifest.json` for retrieval; fall back to glob/grep. Indexes are advisory.
3. Before citing an entry, compute `last_verified` (max of `verifications[].date`) and compare to its `volatility` window (`meta/freshness-policy.md`). For `fast`/`volatile`, prefer live web; offline, prefix with `"unverified-offline"`.
4. For versioned resources, cite the `subject.version`. Sibling versions share a `series`.
5. If Node is available, `research-vault search`/`related` accelerate retrieval; otherwise read the manifest directly.
