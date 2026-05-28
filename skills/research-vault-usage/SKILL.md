---
name: research-vault-usage
description: Use when answering any technical research question — software, systems/infrastructure (e.g. Kubernetes and adjacent tools), data/ML, security, or any technical topic — and a research vault is available. Covers locating the vault, navigating, applying freshness before citing, and citing versioned resources.
---
# Using the research vault
Applies to research on ANY technical topic (the vault is topic-agnostic): broad area goes in `domain`, specific tech (kubernetes, vcluster, istio, …) in freeform `topics`.

1. Locate the vault: `$RESEARCH_VAULT_PATH`, else the OS default (see the vault's `AGENTS.md`).
2. Retrieve via `.vault-manifest.json` (one row per entry + backlinks); fall back to glob/grep over the folders.
3. Before citing an entry, compute `last_verified` (max of `verifications[].date`) and compare to its `volatility` window (`meta/freshness-policy.md`). For `fast`/`volatile`, prefer live web; offline, prefix with `"unverified-offline"`.
4. For versioned resources, cite the `subject.version`. Sibling versions share a `series`.
5. If Node is available, `research-vault search`/`related` accelerate retrieval; otherwise read the manifest directly.
