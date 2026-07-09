---
name: research-authoring
description: Use when authoring or editing a document that cites external facts in a repo bound to a research vault (a .research-vault.json is present) — adding a reference, pinning a tool/library/SDK version, or asserting an external API behavior in prose you are writing. For answering a research question from the vault instead, use research-vault-usage.
---
# Authoring against the research vault

The write-side counterpart to `research-vault-usage`. That skill owns answering questions *from* the vault; this one owns the moment an external citation is about to enter a document you are authoring in a bound repo. Topic-agnostic: broad area goes in `domain`, specific tech in `topics`. Applies when a `.research-vault.json` binds the repo (capture-enabled); its `defaults` supply `domain`/`topics` to `capture` when you omit those flags (an explicit flag always wins), and `references.globs` mark the citation-bearing files. No binding yet? Create one with `research-vault init --project` at the repo root.

A **citation** is any external URL or factual pin — a version number, an API default, a "canonical reference" — that you are adding to prose. The discipline below applies to each one *before it lands*, so research flows back into the vault instead of only into the document.

## 1. Consult before a citation lands
1. Search the vault first: `research-vault search --topic <tech> --domain <d>`. If an entry already covers the fact, cite it instead of re-researching.
2. If it exists, check freshness (its `volatility` window vs. `last_verified`, per the vault's `AGENTS.md`). Stale → verify before relying on it; offline → prefix `unverified-offline`.

## 2. Capture what the vault is missing
If nothing covers the fact, capture it before (or as) you write the sentence. Never let the document be the only record.
- **Versioned fact** (SDK / library / tool pin): `research-vault capture --type source --url <official> --subject-name <tool> --subject-version <ver> --volatility fast`. `subject-version` is load-bearing — it is the part that goes stale.
- **Stable reference** (a canonical doc, a classic paper): capture as a `source` with `volatility: stable` or `slow`.
- **Unresolved assumption** you are relying on but cannot confirm: capture a `question` (`state: open`), not a parenthetical hedge in the prose.

Capture fills `domain`/`topics` from the `.research-vault.json` `defaults` when you omit those flags; pass them explicitly to override. Pass `--subject-version`/`--series` for version-bearing sources so siblings stay distinct.

**Verify what you capture — do not assert from memory.** A version, date, or API claim must be confirmed by fetching the authoritative source (its docs/releases page), not recalled: training lags reality, so a remembered "latest version" is stale by construction. `capture` seeds only a `captured` provenance marker, which is *not* a verification — record a real `verify` (`refetched-source`) once you've fetched, or the entry trips `WARN_SOURCE_UNVERIFIED` and is not authoritative. If you cannot fetch, capture it as a `question`, not a `source` stated as fact.

## 3. Verify after authoring
Run `research-vault check "<file-or-reference-glob>"` to confirm the new citation reports `ok`, not `uncovered` or `stale`. A consuming repo gates CI on `research-vault check --check`, so this is the same correctness floor the vault's own `lint` provides, extended to the document.

## What this skill is not
Not a research-orchestration entry point, and not the question-answering path — that is `research-vault-usage`. It owns one thing: a citation entering a document you are writing.
