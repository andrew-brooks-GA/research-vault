---
name: research-vault-usage
description: Use when searching the vault, citing vault entries, verifying freshness, or producing new vault artifacts (sources, notes, syntheses, questions, experiments, snippets). Not a general research entry point. Covers retrieval, freshness, pre-synthesis artifact planning, and citation discipline. See the vault's AGENTS.md §2.7 for the workflow boundary with orchestrators.
---
# Using the research vault
Topic-agnostic: broad area goes in `domain`; specific tech (kubernetes, vcluster, istio, …) goes in freeform `topics`.

## 1. Locate and retrieve
1. Vault path: `$RESEARCH_VAULT_PATH`, else the OS default (see the vault's `AGENTS.md`).
2. Retrieve via `.vault-manifest.json` (one row per entry + backlinks); fall back to glob/grep over the folders. If Node is available, `research-vault search`/`related` accelerate retrieval.

## 2. Freshness before citing
Compute `last_verified` (max of `verifications[].date`) and compare to the entry's `volatility` window (`meta/freshness-policy.md`). For `fast`/`volatile`, prefer live web; offline, prefix with `"unverified-offline"`. For versioned resources cite `subject.version`; sibling versions share a `series`.

## 3. Pre-synthesis artifact planning (load-bearing)
Before drafting a `synthesis`, produce a **capture plan** per AGENTS.md §2.6. Walk the four prompts explicitly. Do not skip the middle of the lifecycle.

- **Notes:** which load-bearing sources need distillation? One note can cover several sources. A synthesis may skip notes only for a primary-source factual rollup (release-note matrices, version diffs, standards summaries); in that case set `synthesis_basis: primary-rollup` on the synthesis and justify it in the body.
- **Questions:** what ambiguities affect a claim, recommendation, confidence, or future retrieval? Capture each as a `question` entry. **"I don't know" is a `question` entry, not a parenthetical in synthesis prose.**
- **Experiments:** any tool/model/empirical run whose output you'll cite as evidence? Capture each as an `experiment` with an explicit `outcome`. Routine source-reading does not count.
- **Snippets:** any reusable YAML/config/code block? Capture as a `snippet`. Do not bury reusable fragments inside synthesis prose.

Capture each as its own entry first, then reference them in the synthesis via `contributing_ids`. **Reports are views, not artifacts**; never let a long markdown file be the only durable output.

## 4. Chain-of-verification for synthesis bodies
When writing the synthesis prose, for each load-bearing claim:

1. State the claim in one sentence.
2. Cite its evidence via `contributing_ids` (note ids, plus source/experiment/question ids as relevant).
3. Note contradictions or open questions, with `question` ids.
4. For version-bearing claims, name `subject.version` so the reader can spot drift.
5. Assign a `confidence` on the synthesis: `high` (multiple primary sources, no contradictions, version-checked, ran an experiment if applicable), `medium` (partial coverage or minor contradictions), `low` (community-only, unresolved contradictions, or compatibility unclear).

## 5. What this skill is not
Not a general research-orchestration entry point. If you're entering a fresh research task (not yet at retrieval/citation/capture), an orchestrator skill owns the workflow; this skill owns the planning step and the persistence/citation discipline. See `docs/ORCHESTRATOR-INTEGRATION.md` in the plugin repo.
